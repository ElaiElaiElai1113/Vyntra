import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type ReqBody = {
  workflow_id: string;
  input_json?: Record<string, unknown>;
};

type StepResult = {
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

const CORS_ALLOW_ORIGINS = (Deno.env.get("CORS_ALLOW_ORIGINS") ?? "")
  .split(",")
  .map((v) => v.trim())
  .filter(Boolean);

function corsHeadersForOrigin(origin: string | null) {
  const allowedOrigin = origin && CORS_ALLOW_ORIGINS.length > 0
    ? (CORS_ALLOW_ORIGINS.includes(origin) ? origin : null)
    : origin ?? "*";

  return {
    "Access-Control-Allow-Origin": allowedOrigin ?? "null",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

const RUN_MODE = (Deno.env.get("RUN_MODE") ?? "simulate").toLowerCase();
const OPENAI_BASE_URL = Deno.env.get("OPENAI_BASE_URL") ?? "https://api.openai.com/v1";
const OPENAI_MODEL = Deno.env.get("OPENAI_MODEL") ?? "gpt-4.1-mini";
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
const RUN_WORKFLOW_MONTHLY_LIMIT = Number(Deno.env.get("RUN_WORKFLOW_MONTHLY_LIMIT") ?? "500");

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

function monthStartIso(d = new Date()): string {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0)).toISOString();
}

function tokenizeJsonPath(path: string): string[] {
  const normalized = path.replace(/^\$\./, "").replace(/^\$/, "");
  const tokens: string[] = [];
  const pattern = /([^[.\]]+)|\[(\d+|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\]/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(normalized))) {
    if (match[1]) tokens.push(match[1]);
    else if (match[2]) {
      const raw = match[2];
      tokens.push(/^\d+$/.test(raw) ? raw : raw.slice(1, -1));
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
  if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith("\"") && value.endsWith("\""))) return value.slice(1, -1);
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null") return null;
  const num = Number(value);
  if (!Number.isNaN(num)) return num;
  return value;
}

function resolveOperand(ctx: Record<string, unknown>, raw: string): unknown {
  const value = raw.trim();
  if (value.startsWith("$")) return resolveJsonPath(ctx, value);
  return parseLiteral(value);
}

function evaluateConditionExpression(ctx: Record<string, unknown>, expression: string): boolean {
  const match = expression.match(/^\s*(.+?)\s*(==|!=|>=|<=|>|<)\s*(.+)\s*$/);
  if (!match) return false;
  const [, leftRaw, op, rightRaw] = match;
  const left = resolveOperand(ctx, leftRaw);
  const right = resolveOperand(ctx, rightRaw);
  switch (op) {
    case "==": return left === right;
    case "!=": return left !== right;
    case ">": return Number(left) > Number(right);
    case "<": return Number(left) < Number(right);
    case ">=": return Number(left) >= Number(right);
    case "<=": return Number(left) <= Number(right);
    default: return false;
  }
}

function classifyText(input: unknown, labels: string[]): { label: string; confidence: number } {
  const text = String(typeof input === "string" ? input : JSON.stringify(input)).toLowerCase();
  const scored = labels.map((label) => ({ label, score: text.includes(label.toLowerCase()) ? 2 : 1 }));
  scored.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
  return { label: scored[0]?.label ?? "general", confidence: scored[0]?.score === 2 ? 0.92 : 0.67 };
}

async function callOpenAIText(args: { prompt: string; system?: string; forceJsonObject?: boolean }): Promise<string> {
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured");

  const res = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0.2,
      ...(args.forceJsonObject ? { response_format: { type: "json_object" } } : {}),
      messages: [
        {
          role: "system",
          content: args.system ?? "You are a concise workflow execution assistant.",
        },
        {
          role: "user",
          content: args.prompt,
        },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI error (${res.status}): ${text}`);
  }

  const json = await res.json();
  const content = json?.choices?.[0]?.message?.content;
  if (!content || typeof content !== "string") {
    throw new Error("OpenAI response missing message content");
  }

  return content.trim();
}

function parseJsonObjectFromText(content: string): Record<string, unknown> | null {
  const trimmed = content.trim();
  const candidates: string[] = [trimmed];

  // Extract fenced code block content if present.
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch?.[1]) candidates.push(fenceMatch[1].trim());

  // Extract first JSON object region.
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Try next candidate.
    }
  }

  return null;
}

async function summarizeTextLive(input: unknown, config: Record<string, unknown>): Promise<string> {
  const source = typeof input === "string" ? input : JSON.stringify(input);
  const style = typeof config.style === "string" ? config.style : "concise";
  const bullets = Boolean(config.bullets);
  const instructions = typeof config.instructions === "string" ? config.instructions : "Summarize the input.";

  const bulletHint = bullets ? "Use bullets." : "Return a short paragraph.";
  const prompt = [
    `Task: ${instructions}`,
    `Style: ${style}. ${bulletHint}`,
    "Input:",
    source,
  ].join("\n\n");

  return callOpenAIText({ prompt });
}

async function classifyTextLive(
  input: unknown,
  labels: string[],
  config: Record<string, unknown>,
): Promise<{ label: string; confidence: number }> {
  if (labels.length === 0) return classifyText(input, labels);

  const source = typeof input === "string" ? input : JSON.stringify(input);
  const instructions = typeof config.instructions === "string"
    ? config.instructions
    : "Classify the input into one label.";
  const labelsList = labels.map((l) => `- ${l}`).join("\n");

  const prompt = [
    `${instructions}`,
    "Return JSON only in this shape:",
    '{"label":"<one label from provided list>","confidence":0.0}',
    "Allowed labels:",
    labelsList,
    "Input:",
    source,
  ].join("\n\n");

  const content = await callOpenAIText({
    prompt,
    system: "Return strict JSON only.",
    forceJsonObject: true,
  });
  const parsed = parseJsonObjectFromText(content);
  if (!parsed) {
    // Fail open to deterministic classifier instead of failing entire workflow run.
    return classifyText(input, labels);
  }

  const label = typeof parsed.label === "string"
    ? parsed.label.trim()
    : "";
  const confidenceRaw = parsed.confidence;
  const confidence = typeof confidenceRaw === "number"
    ? confidenceRaw
    : Number(confidenceRaw);

  if (!labels.includes(label)) {
    return classifyText(input, labels);
  }
  if (!Number.isFinite(confidence)) {
    return classifyText(input, labels);
  }

  return { label, confidence: Math.max(0, Math.min(1, confidence)) };
}

function defaultExtractedFields(fields: unknown[]): Record<string, unknown> {
  return Object.fromEntries(fields.map((f: any) => {
    const key = f?.key ?? "field";
    if (f?.type === "number") return [key, 0];
    if (f?.type === "boolean") return [key, false];
    if (f?.type === "array") return [key, []];
    return [key, ""];
  }));
}

function coerceFieldValue(value: unknown, type: string | undefined): unknown {
  switch (type) {
    case "number": {
      const n = typeof value === "number" ? value : Number(value);
      return Number.isFinite(n) ? n : 0;
    }
    case "boolean":
      return Boolean(value);
    case "array":
      return Array.isArray(value) ? value : (value == null ? [] : [value]);
    case "string":
    default:
      return typeof value === "string" ? value : JSON.stringify(value ?? "");
  }
}

async function extractFieldsLive(
  input: unknown,
  fields: unknown[],
  config: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (fields.length === 0) return {};

  const source = typeof input === "string" ? input : JSON.stringify(input);
  const instructions = typeof config.instructions === "string"
    ? config.instructions
    : "Extract structured fields from the input.";

  const fieldSpec = fields.map((f: any) => ({
    key: String(f?.key ?? "field"),
    type: String(f?.type ?? "string"),
    required: Boolean(f?.required),
  }));

  const prompt = [
    instructions,
    "Return JSON only as an object with the requested keys.",
    "Field spec:",
    JSON.stringify(fieldSpec),
    "Input:",
    source,
  ].join("\n\n");

  const content = await callOpenAIText({
    prompt,
    system: "Return strict JSON object only.",
    forceJsonObject: true,
  });

  const parsed = parseJsonObjectFromText(content);
  if (!parsed) return defaultExtractedFields(fields);

  const out: Record<string, unknown> = {};
  for (const spec of fieldSpec) {
    out[spec.key] = coerceFieldValue(parsed[spec.key], spec.type);
  }
  return out;
}

async function generateReportLive(input: unknown, config: Record<string, unknown>): Promise<string> {
  const source = typeof input === "string" ? input : JSON.stringify(input);
  const instructions = typeof config.instructions === "string"
    ? config.instructions
    : "Generate a concise report from the input.";
  const template = typeof config.template === "string" ? config.template : "Report";
  const format = typeof config.format === "string" ? config.format : "markdown";

  const prompt = [
    `Task: ${instructions}`,
    `Template: ${template}`,
    `Output format: ${format}`,
    "Return only the report content.",
    "Input:",
    source,
  ].join("\n\n");

  return callOpenAIText({ prompt });
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
      return `"${raw.replace(/"/g, '""')}"`;
    });
    lines.push(values.join(","));
  }
  return lines.join("\n");
}

function topo(doc: any) {
  const nodesById = new Map((doc.workflow.nodes ?? []).map((n: any) => [n.id, n]));
  const indeg = new Map((doc.workflow.nodes ?? []).map((n: any) => [n.id, 0]));
  const adj = new Map<string, string[]>();
  for (const e of doc.workflow.edges ?? []) {
    indeg.set(e.target.node_id, (indeg.get(e.target.node_id) ?? 0) + 1);
    adj.set(e.source.node_id, [...(adj.get(e.source.node_id) ?? []), e.target.node_id]);
  }
  const q: string[] = [...indeg.entries()].filter(([, v]) => v === 0).map(([k]) => k);
  const ordered: any[] = [];
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

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  const corsHeaders = corsHeadersForOrigin(origin);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (origin && CORS_ALLOW_ORIGINS.length > 0 && !CORS_ALLOW_ORIGINS.includes(origin)) {
    return new Response(JSON.stringify({ ok: false, error: "Origin not allowed" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (req.method !== "POST") return new Response(JSON.stringify({ ok: false, error: "Method not allowed" }), { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnon = Deno.env.get("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !supabaseAnon) {
      return new Response(JSON.stringify({ ok: false, error: "Supabase env missing" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!bearerMatch || !bearerMatch[1]?.trim()) {
      return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const client = createClient(supabaseUrl, supabaseAnon, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userRes, error: userErr } = await client.auth.getUser();
    const user = userRes?.user;
    if (userErr || !user) {
      return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (!Number.isFinite(RUN_WORKFLOW_MONTHLY_LIMIT) || RUN_WORKFLOW_MONTHLY_LIMIT < 1) {
      return new Response(JSON.stringify({ ok: false, error: "Invalid RUN_WORKFLOW_MONTHLY_LIMIT configuration" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const periodStart = monthStartIso();
    const { count: runsCount, error: quotaErr } = await client
      .from("runs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .gte("created_at", periodStart);
    if (quotaErr) {
      return new Response(JSON.stringify({ ok: false, error: `Run quota check failed: ${quotaErr.message}` }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if ((runsCount ?? 0) >= RUN_WORKFLOW_MONTHLY_LIMIT) {
      return new Response(JSON.stringify({
        ok: false,
        error: "Monthly run limit reached",
        limit: RUN_WORKFLOW_MONTHLY_LIMIT,
        period_start: periodStart,
      }), {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = (await req.json()) as ReqBody;
    if (!body.workflow_id) {
      return new Response(JSON.stringify({ ok: false, error: "workflow_id is required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: wf, error: wfErr } = await client
      .from("workflows")
      .select("id,user_id,definition_json")
      .eq("id", body.workflow_id)
      .single();

    if (wfErr || !wf) {
      return new Response(JSON.stringify({ ok: false, error: "Workflow not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (wf.user_id !== user.id) {
      return new Response(JSON.stringify({ ok: false, error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const doc = wf.definition_json as any;
    if (!doc?.workflow?.nodes || !doc?.workflow?.edges) {
      return new Response(JSON.stringify({ ok: false, error: "Invalid workflow definition" }), { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const ordered = topo(doc);
    if (ordered.length !== doc.workflow.nodes.length) {
      return new Response(JSON.stringify({ ok: false, error: "Workflow graph is not a DAG" }), { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const trigger = doc.workflow.nodes.find((n: any) => n.id === doc.workflow.entry_node_id);
    const triggerCfg = (trigger?.config ?? {}) as Record<string, unknown>;
    const initialInput = body.input_json ?? (triggerCfg.sample_input ?? triggerCfg.sample_payload ?? triggerCfg.payload ?? {});

    const outgoingByNodeId = new Map<string, any[]>();
    for (const edge of doc.workflow.edges) {
      outgoingByNodeId.set(edge.source.node_id, [...(outgoingByNodeId.get(edge.source.node_id) ?? []), edge]);
    }

    let ctx: Record<string, unknown> = { input: clone(initialInput) };
    const activeNodeIds = new Set<string>([doc.workflow.entry_node_id]);
    const steps: StepResult[] = [];

    for (const node of ordered) {
      if (!activeNodeIds.has(node.id)) continue;
      const started = Date.now();
      const startedAt = new Date(started).toISOString();
      const inSnapshot = clone(ctx);

      try {
        const out = { ...ctx } as Record<string, unknown>;
        const config = (node.config ?? {}) as Record<string, unknown>;

        if (node.type === "ai.summarize") {
          const input = resolveJsonPath(out, (config.input_path as string | undefined) ?? "$.input");
          const summary = RUN_MODE === "live"
            ? await summarizeTextLive(input, config)
            : `Summary: ${String(typeof input === "string" ? input : JSON.stringify(input)).slice(0, 180)}`;
          out[(config.output_key as string | undefined) ?? "summary"] = summary;
        }
        if (node.type === "ai.classify") {
          const input = resolveJsonPath(out, (config.input_path as string | undefined) ?? "$.input");
          const labels = Array.isArray(config.labels) ? config.labels.filter((x): x is string => typeof x === "string") : [];
          const result = RUN_MODE === "live"
            ? await classifyTextLive(input, labels, config)
            : classifyText(input, labels);
          out[(config.output_key as string | undefined) ?? "label"] = result.label;
          out[(config.confidence_key as string | undefined) ?? "confidence"] = result.confidence;
        }
        if (node.type === "ai.extract_fields") {
          const fields = Array.isArray(config.fields) ? config.fields : [];
          const input = resolveJsonPath(out, (config.input_path as string | undefined) ?? "$.input");
          const extracted = RUN_MODE === "live"
            ? await extractFieldsLive(input, fields, config)
            : defaultExtractedFields(fields);
          out[(config.output_key as string | undefined) ?? "extracted"] = extracted;
        }
        if (node.type === "ai.generate_report") {
          const input = resolveJsonPath(out, (config.input_path as string | undefined) ?? "$.input");
          out[(config.output_key as string | undefined) ?? "report"] = RUN_MODE === "live"
            ? await generateReportLive(input, config)
            : `# Generated Report\n\n- Source: ${JSON.stringify(input).slice(0, 120)}\n- Step 1\n- Step 2`;
        }
        if (node.type === "logic.delay") out.delay_applied = config.seconds ?? 0;

        if (node.type === "output.db_save") {
          const mapping = (config.mapping ?? {}) as Record<string, unknown>;
          const tableName = typeof config.table === "string" && config.table.trim()
            ? config.table.trim()
            : "va_items";
          if (tableName !== "va_items") {
            throw new Error(`db_save unsupported table: ${tableName}`);
          }
          const payload = Object.fromEntries(
            Object.entries(mapping).map(([key, value]) => {
              if (typeof value === "string" && value.startsWith("$")) return [key, resolveJsonPath(out, value)];
              return [key, value];
            }),
          );

          const { data: saved, error: saveErr } = await client
            .from(tableName)
            .insert({
              user_id: user.id,
              workflow_id: wf.id,
              source_node_id: node.id,
              data_json: payload,
            })
            .select("id")
            .single();
          if (saveErr) throw new Error(`db_save failed: ${saveErr.message}`);

          out.db_save = {
            would_save: true,
            table: tableName,
            mode: (config.mode as string | undefined) ?? "insert",
            payload,
            inserted_id: saved?.id,
          };
        }

        if (node.type === "output.export") {
          const data = resolveJsonPath(out, (config.input_path as string | undefined) ?? "$.input");
          const rawFormat = typeof config.format === "string" ? config.format.toLowerCase().trim() : "json";
          const format = rawFormat === "csv" ? "csv" : "json";
          const filename = (config.filename as string | undefined) ?? `export.${format}`;
          const content = format === "csv" ? toCsv(data) : JSON.stringify(data, null, 2);

          const { data: exp, error: expErr } = await client
            .from("workflow_exports")
            .insert({
              user_id: user.id,
              workflow_id: wf.id,
              source_node_id: node.id,
              format,
              filename,
              content_text: content,
              payload_json: data as any,
            })
            .select("id")
            .single();
          if (expErr) throw new Error(`export failed: ${expErr.message}`);

          out.export = { format, filename, content, export_id: exp?.id };
        }

        let selectedPort: string | null = null;
        if (node.type === "logic.condition") {
          const expression = String(config.expression ?? "");
          const defaultOutput = typeof config.default_output === "string" ? config.default_output : null;
          const outputIds: string[] = (node.outputs ?? []).map((o: any) => o.id);
          const nonDefault = outputIds.find((id: string) => id !== defaultOutput) ?? outputIds[0] ?? null;
          selectedPort = evaluateConditionExpression(out, expression) ? nonDefault : defaultOutput ?? nonDefault;
        }

        const outgoing = outgoingByNodeId.get(node.id) ?? [];
        const followed = node.type === "logic.condition" && selectedPort
          ? outgoing.filter((e) => e.source.port_id === selectedPort)
          : outgoing;
        const nextIds = followed.map((e) => e.target.node_id);
        for (const nid of nextIds) activeNodeIds.add(nid);

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
          next_node_ids: nextIds,
          input: inSnapshot,
          output: clone(out),
        });

        ctx = out;
      } catch (err) {
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
          input: inSnapshot,
          output: { error: err instanceof Error ? err.message : "Unknown error" },
          error: err instanceof Error ? err.message : "Unknown error",
        });

        const { data: failedRun } = await client
          .from("runs")
          .insert({
            user_id: user.id,
            workflow_id: wf.id,
            status: "failed",
            input_json: { source: "run-live", payload: initialInput },
            output_json: ctx,
            steps,
          })
          .select("id")
          .single();

        return new Response(JSON.stringify({ ok: false, error: "Run failed", run_id: failedRun?.id, details: err instanceof Error ? err.message : "Unknown error" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const { data: run, error: runErr } = await client
      .from("runs")
      .insert({
        user_id: user.id,
        workflow_id: wf.id,
        status: "success",
        input_json: { source: "run-live", payload: initialInput },
        output_json: ctx,
        steps,
      })
      .select("id")
      .single();

    if (runErr) {
      return new Response(JSON.stringify({ ok: false, error: runErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true, run_id: run?.id, output_json: ctx, steps_count: steps.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : "Unexpected error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
