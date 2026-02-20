import type { WorkflowDoc, WorkflowNode } from "@shared/schema/workflow";

export type StepResult = {
  node_id: string;
  node_type: string;
  status: "success" | "failed";
  input: unknown;
  output: unknown;
};

function resolveInput(ctx: Record<string, unknown>, path: string | undefined) {
  if (!path) return ctx;
  const key = path.replace(/^\$\./, "");
  return ctx[key];
}

function runNode(node: WorkflowNode, ctx: Record<string, unknown>): Record<string, unknown> {
  const out = { ...ctx };

  if (node.type === "ai.summarize") out[(node.config as any).output_key || "summary"] = "Stub summary";
  if (node.type === "ai.classify") {
    out[(node.config as any).output_key || "label"] = ((node.config as any).labels?.[0] ?? "general");
    out[(node.config as any).confidence_key || "confidence"] = 0.9;
  }
  if (node.type === "ai.extract_fields") {
    const fields = (node.config as any).fields ?? [];
    const extracted = Object.fromEntries(fields.map((f: any) => [f.key, f.type === "number" ? 0 : ""]));
    out[(node.config as any).output_key || "extracted"] = extracted;
  }
  if (node.type === "ai.generate_report") out[(node.config as any).output_key || "report"] = "# Generated SOP\n- Step 1\n- Step 2";

  if (node.type === "logic.delay") out.delay_applied = (node.config as any).seconds ?? 0;
  if (node.type === "output.db_save") out.db_save = { would_save: true, table: (node.config as any).table ?? "va_items" };
  if (node.type === "output.export") {
    const data = resolveInput(out, (node.config as any).input_path as string | undefined);
    out.export = { format: (node.config as any).format ?? "json", data };
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

export function simulateWorkflow(doc: WorkflowDoc, inputOverride?: Record<string, unknown>) {
  const trigger = doc.workflow.nodes.find((n) => n.id === doc.workflow.entry_node_id);
  const initialInput =
    inputOverride ??
    ((trigger?.config as any)?.sample_input ?? (trigger?.config as any)?.sample_payload ?? (trigger?.config as any)?.payload ?? {});

  let ctx: Record<string, unknown> = { input: initialInput };
  const steps: StepResult[] = [];

  for (const node of topo(doc)) {
    try {
      const output = runNode(node, ctx);
      steps.push({ node_id: node.id, node_type: node.type, status: "success", input: ctx, output });
      ctx = output;
    } catch (error) {
      steps.push({
        node_id: node.id,
        node_type: node.type,
        status: "failed",
        input: ctx,
        output: { error: error instanceof Error ? error.message : "Unknown error" },
      });
      return { status: "failed" as const, steps, output: ctx };
    }
  }

  return { status: "success" as const, steps, output: ctx };
}
