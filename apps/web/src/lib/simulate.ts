import type { WorkflowDoc, WorkflowNode } from "@shared/schema/workflow";

export type StepResult = {
  node_id: string;
  node_name: string;
  node_type: string;
  status: "success" | "failed";
  started_at: string;
  finished_at: string;
  duration_ms: number;
  selected_output_port: string | null;
  next_node_ids: string[];
  input: unknown;
  output: unknown;
  error?: string;
};

type SimContext = Record<string, unknown>;

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function tokenizeJsonPath(path: string): string[] {
  // Supports $.a.b, $.a[0], $.a["x"] and $.a['x'].
  const normalized = path.replace(/^\$\./, "").replace(/^\$/, "");
  const tokens: string[] = [];
  const pattern = /([^[.\]]+)|\[(\d+|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\]/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(normalized))) {
    if (match[1]) {
      tokens.push(match[1]);
      continue;
    }
    if (!match[2]) continue;
    const raw = match[2];
    if (/^\d+$/.test(raw)) {
      tokens.push(raw);
    } else {
      tokens.push(raw.slice(1, -1));
    }
  }

  return tokens;
}

function resolveJsonPath(input: unknown, path?: string): unknown {
  if (!path || path === "$") return input;
  if (!path.startsWith("$")) return undefined;

  const tokens = tokenizeJsonPath(path);
  let current: unknown = input;
  for (const token of tokens) {
    if (Array.isArray(current) && /^\d+$/.test(token)) {
      current = current[Number(token)];
      continue;
    }
    if (current && typeof current === "object" && token in (current as Record<string, unknown>)) {
      current = (current as Record<string, unknown>)[token];
      continue;
    }
    return undefined;
  }

  return current;
}

function parseLiteral(raw: string): unknown {
  const value = raw.trim();
  if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith("\"") && value.endsWith("\""))) {
    return value.slice(1, -1);
  }
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null") return null;
  const num = Number(value);
  if (!Number.isNaN(num)) return num;
  return value;
}

function resolveOperand(ctx: SimContext, raw: string): unknown {
  const value = raw.trim();
  if (value.startsWith("$")) return resolveJsonPath(ctx, value);
  return parseLiteral(value);
}

function evaluateConditionExpression(ctx: SimContext, expression: string): boolean {
  const match = expression.match(/^\s*(.+?)\s*(==|!=|>=|<=|>|<)\s*(.+)\s*$/);
  if (!match) return false;

  const [, leftRaw, op, rightRaw] = match;
  const left = resolveOperand(ctx, leftRaw);
  const right = resolveOperand(ctx, rightRaw);

  switch (op) {
    case "==":
      return left === right;
    case "!=":
      return left !== right;
    case ">":
      return Number(left) > Number(right);
    case "<":
      return Number(left) < Number(right);
    case ">=":
      return Number(left) >= Number(right);
    case "<=":
      return Number(left) <= Number(right);
    default:
      return false;
  }
}

function toCsv(data: unknown): string {
  if (!Array.isArray(data)) return JSON.stringify(data, null, 2);
  const rows = data as Array<Record<string, unknown>>;
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(",")];
  for (const row of rows) {
    const values = headers.map((h) => {
      const value = row[h];
      const raw = typeof value === "string" ? value : JSON.stringify(value ?? "");
      return `"${raw.replace(/"/g, "\"\"")}"`;
    });
    lines.push(values.join(","));
  }
  return lines.join("\n");
}

function summarizeText(input: unknown): string {
  const text = typeof input === "string" ? input : JSON.stringify(input);
  return `Summary: ${text.slice(0, 180)}`;
}

function classifyText(input: unknown, labels: string[]): { label: string; confidence: number } {
  const text = String(typeof input === "string" ? input : JSON.stringify(input)).toLowerCase();
  const scored = labels.map((label) => ({
    label,
    score: text.includes(label.toLowerCase()) ? 2 : 1,
  }));
  scored.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
  return { label: scored[0]?.label ?? "general", confidence: scored[0]?.score === 2 ? 0.92 : 0.67 };
}

function resolveDbMapping(mapping: unknown, ctx: SimContext): Record<string, unknown> {
  if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) return {};
  const entries = Object.entries(mapping as Record<string, unknown>);
  return Object.fromEntries(
    entries.map(([key, value]) => {
      if (typeof value === "string" && value.startsWith("$")) {
        return [key, resolveJsonPath(ctx, value)];
      }
      return [key, value];
    }),
  );
}

function runNode(node: WorkflowNode, ctx: SimContext): SimContext {
  const out = { ...ctx };
  const config = node.config as Record<string, unknown>;

  if (node.type === "ai.summarize") {
    const input = resolveJsonPath(out, (config.input_path as string | undefined) ?? "$.input");
    out[(config.output_key as string | undefined) ?? "summary"] = summarizeText(input);
  }
  if (node.type === "ai.classify") {
    const input = resolveJsonPath(out, (config.input_path as string | undefined) ?? "$.input");
    const labels = Array.isArray(config.labels) ? config.labels.filter((x): x is string => typeof x === "string") : [];
    const result = classifyText(input, labels);
    out[(config.output_key as string | undefined) ?? "label"] = result.label;
    out[(config.confidence_key as string | undefined) ?? "confidence"] = result.confidence;
  }
  if (node.type === "ai.extract_fields") {
    const fields = Array.isArray(config.fields) ? config.fields : [];
    const extracted = Object.fromEntries(
      fields.map((f) => {
        const field = (f ?? {}) as { key?: string; type?: string };
        const key = field.key ?? "field";
        if (field.type === "number") return [key, 0];
        if (field.type === "boolean") return [key, false];
        if (field.type === "array") return [key, []];
        return [key, ""];
      }),
    );
    out[(config.output_key as string | undefined) ?? "extracted"] = extracted;
  }
  if (node.type === "ai.generate_report") {
    const input = resolveJsonPath(out, (config.input_path as string | undefined) ?? "$.input");
    out[(config.output_key as string | undefined) ?? "report"] =
      `# Generated SOP\n\n- Source: ${JSON.stringify(input).slice(0, 100)}\n- Step 1\n- Step 2`;
  }

  if (node.type === "logic.delay") out.delay_applied = config.seconds ?? 0;
  if (node.type === "output.db_save") {
    out.db_save = {
      would_save: true,
      table: (config.table as string | undefined) ?? "va_items",
      mode: (config.mode as string | undefined) ?? "insert",
      payload: resolveDbMapping(config.mapping, out),
    };
  }
  if (node.type === "output.export") {
    const data = resolveJsonPath(out, (config.input_path as string | undefined) ?? "$.input");
    const format = (config.format as string | undefined) ?? "json";
    out.export = {
      format,
      filename: (config.filename as string | undefined) ?? `export.${format}`,
      data,
      content: format === "csv" ? toCsv(data) : JSON.stringify(data, null, 2),
    };
  }

  return out;
}

function topo(doc: WorkflowDoc): WorkflowNode[] {
  const nodesById = new Map(doc.workflow.nodes.map((n) => [n.id, n]));
  const indeg = new Map(doc.workflow.nodes.map((n) => [n.id, 0]));
  const adj = new Map<string, string[]>();

  for (const e of doc.workflow.edges) {
    indeg.set(e.target.node_id, (indeg.get(e.target.node_id) ?? 0) + 1);
    adj.set(e.source.node_id, [...(adj.get(e.source.node_id) ?? []), e.target.node_id]);
  }

  const q: string[] = [...indeg.entries()].filter(([, v]) => v === 0).map(([k]) => k);
  const ordered: WorkflowNode[] = [];

  while (q.length) {
    const id = q.shift()!;
    const node = nodesById.get(id);
    if (node) ordered.push(node);
    for (const nxt of adj.get(id) ?? []) {
      indeg.set(nxt, (indeg.get(nxt) ?? 0) - 1);
      if ((indeg.get(nxt) ?? 0) === 0) q.push(nxt);
    }
  }

  return ordered;
}

function selectConditionOutput(node: WorkflowNode, ctx: SimContext): string | null {
  const config = node.config as Record<string, unknown>;
  const expression = String(config.expression ?? "");
  const defaultOutput = typeof config.default_output === "string" ? config.default_output : null;
  const outputIds = node.outputs.map((o) => o.id);
  const nonDefault = outputIds.find((id) => id !== defaultOutput) ?? outputIds[0] ?? null;
  const isTrue = evaluateConditionExpression(ctx, expression);
  return isTrue ? nonDefault : defaultOutput ?? nonDefault;
}

export function simulateWorkflow(doc: WorkflowDoc, inputOverride?: Record<string, unknown>) {
  const trigger = doc.workflow.nodes.find((n) => n.id === doc.workflow.entry_node_id);
  const initialInput =
    inputOverride ??
    (((trigger?.config as Record<string, unknown> | undefined)?.sample_input as Record<string, unknown> | undefined) ??
      ((trigger?.config as Record<string, unknown> | undefined)?.sample_payload as Record<string, unknown> | undefined) ??
      ((trigger?.config as Record<string, unknown> | undefined)?.payload as Record<string, unknown> | undefined) ??
      {});

  const ordered = topo(doc);
  if (ordered.length !== doc.workflow.nodes.length) {
    return {
      status: "failed" as const,
      steps: [] as StepResult[],
      output: { error: "Cycle detected or graph is not a DAG." },
    };
  }

  const outgoingByNodeId = new Map<string, typeof doc.workflow.edges>();
  for (const edge of doc.workflow.edges) {
    outgoingByNodeId.set(edge.source.node_id, [...(outgoingByNodeId.get(edge.source.node_id) ?? []), edge]);
  }

  let ctx: SimContext = { input: deepClone(initialInput) };
  const steps: StepResult[] = [];
  const activeNodeIds = new Set<string>([doc.workflow.entry_node_id]);

  for (const node of ordered) {
    if (!activeNodeIds.has(node.id)) continue;

    const started = Date.now();
    const startedAt = new Date(started).toISOString();
    const inputSnapshot = deepClone(ctx);
    try {
      const output = runNode(node, ctx);
      const selectedPort = node.type === "logic.condition" ? selectConditionOutput(node, output) : null;
      const outgoing = outgoingByNodeId.get(node.id) ?? [];
      const followedEdges =
        node.type === "logic.condition" && selectedPort
          ? outgoing.filter((e) => e.source.port_id === selectedPort)
          : outgoing;

      const nextNodeIds = followedEdges.map((e) => e.target.node_id);
      for (const nextId of nextNodeIds) activeNodeIds.add(nextId);

      const finished = Date.now();
      steps.push({
        node_id: node.id,
        node_name: node.name,
        node_type: node.type,
        status: "success",
        started_at: startedAt,
        finished_at: new Date(finished).toISOString(),
        duration_ms: finished - started,
        selected_output_port: selectedPort,
        next_node_ids: nextNodeIds,
        input: inputSnapshot,
        output: deepClone(output),
      });
      ctx = output;
    } catch (error) {
      const finished = Date.now();
      steps.push({
        node_id: node.id,
        node_name: node.name,
        node_type: node.type,
        status: "failed",
        started_at: startedAt,
        finished_at: new Date(finished).toISOString(),
        duration_ms: finished - started,
        selected_output_port: null,
        next_node_ids: [],
        input: inputSnapshot,
        output: { error: error instanceof Error ? error.message : "Unknown error" },
        error: error instanceof Error ? error.message : "Unknown error",
      });
      return { status: "failed" as const, steps, output: ctx };
    }
  }

  return { status: "success" as const, steps, output: ctx };
}
