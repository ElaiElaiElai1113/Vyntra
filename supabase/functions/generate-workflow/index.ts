import { z } from "npm:zod@3.24.1";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedNodeTypes = [
  "trigger.manual",
  "trigger.webhook",
  "trigger.schedule",
  "trigger.file_upload",
  "ai.summarize",
  "ai.classify",
  "ai.extract_fields",
  "ai.generate_report",
  "logic.condition",
  "logic.delay",
  "output.db_save",
  "output.export",
] as const;

const triggerNodeTypes = [
  "trigger.manual",
  "trigger.webhook",
  "trigger.schedule",
  "trigger.file_upload",
] as const;

const nodePortSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  schema: z.string().min(1),
});

const nodeSchema = z.object({
  id: z.string().min(1),
  type: z.enum(allowedNodeTypes),
  name: z.string().min(1),
  position: z.object({ x: z.number(), y: z.number() }),
  inputs: z.array(nodePortSchema),
  outputs: z.array(nodePortSchema).min(1),
  config: z.record(z.string(), z.unknown()),
  ui: z.object({
    icon: z.string().min(1),
    color: z.string().min(1),
  }),
});

const edgeSchema = z.object({
  id: z.string().min(1),
  source: z.object({
    node_id: z.string().min(1),
    port_id: z.string().min(1),
  }),
  target: z.object({
    node_id: z.string().min(1),
    port_id: z.string().min(1),
  }),
  label: z.string().nullable(),
  condition: z.string().nullable(),
});

const workflowDocSchema = z
  .object({
    schema_version: z.literal("1.0"),
    workflow: z.object({
      id: z.string().regex(/^wf_[a-zA-Z0-9_-]+$/),
      name: z.string().min(1),
      description: z.string().min(1),
      tags: z.array(z.string()).default([]),
      entry_node_id: z.string().min(1),
      variables: z.record(z.string(), z.unknown()).default({}),
      nodes: z.array(nodeSchema).min(1),
      edges: z.array(edgeSchema),
    }),
  })
  .superRefine((doc, ctx) => {
    const nodes = doc.workflow.nodes;
    const edges = doc.workflow.edges;

    const triggerNodes = nodes.filter((n) => triggerNodeTypes.includes(n.type as (typeof triggerNodeTypes)[number]));
    if (triggerNodes.length !== 1) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["workflow", "nodes"], message: "Exactly one trigger node is required." });
    }
    if (triggerNodes[0] && doc.workflow.entry_node_id !== triggerNodes[0].id) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["workflow", "entry_node_id"], message: "entry_node_id must point to trigger." });
    }

    const nodeIds = new Set<string>();
    const edgeIds = new Set<string>();

    for (const n of nodes) {
      if (nodeIds.has(n.id)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["workflow", "nodes"], message: `Duplicate node id: ${n.id}` });
      }
      nodeIds.add(n.id);

      const isTrigger = triggerNodeTypes.includes(n.type as (typeof triggerNodeTypes)[number]);
      if (isTrigger && n.inputs.length !== 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["workflow", "nodes"], message: `Trigger node ${n.id} must have no inputs.` });
      }
      if (!isTrigger && n.inputs.length < 1) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["workflow", "nodes"], message: `Non-trigger node ${n.id} must have >=1 input.` });
      }
      if (n.type === "logic.condition") {
        if (n.outputs.length < 2) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["workflow", "nodes"], message: `Condition node ${n.id} must have >=2 outputs.` });
        }
        const defaultOutput = n.config.default_output;
        if (typeof defaultOutput !== "string" || !n.outputs.some((o) => o.id === defaultOutput)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["workflow", "nodes"], message: `Condition node ${n.id} has invalid default_output.` });
        }
      }
    }

    for (const e of edges) {
      if (edgeIds.has(e.id)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["workflow", "edges"], message: `Duplicate edge id: ${e.id}` });
      }
      edgeIds.add(e.id);

      const sourceNode = nodes.find((n) => n.id === e.source.node_id);
      const targetNode = nodes.find((n) => n.id === e.target.node_id);
      if (!sourceNode || !sourceNode.outputs.some((p) => p.id === e.source.port_id)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["workflow", "edges"], message: `Edge ${e.id} source must reference an output port.` });
      }
      if (!targetNode || !targetNode.inputs.some((p) => p.id === e.target.port_id)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["workflow", "edges"], message: `Edge ${e.id} target must reference an input port.` });
      }
    }
  });

type GenerateRequest = {
  prompt: string;
  name?: string;
  description?: string;
  tags?: string[];
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const OPENAI_BASE_URL = Deno.env.get("OPENAI_BASE_URL") ?? "https://api.openai.com/v1";
const OPENAI_MODEL = Deno.env.get("OPENAI_MODEL") ?? "gpt-4.1-mini";
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
const GENERATE_WORKFLOW_MONTHLY_LIMIT = Number(Deno.env.get("GENERATE_WORKFLOW_MONTHLY_LIMIT") ?? "250");

function cleanJson(input: string): string {
  return input.replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function toPort(port: unknown, fallbackId: string) {
  if (isRecord(port)) {
    return {
      id: typeof port.id === "string" && port.id ? port.id : fallbackId,
      label: typeof port.label === "string" && port.label ? port.label : fallbackId,
      schema: typeof port.schema === "string" && port.schema ? port.schema : "JSON",
    };
  }
  if (typeof port === "string" && port.trim()) {
    return {
      id: port.trim(),
      label: port.trim(),
      schema: "JSON",
    };
  }
  return {
    id: fallbackId,
    label: fallbackId,
    schema: "JSON",
  };
}

function toEndpoint(endpoint: unknown, fallbackNode = "", fallbackPort = "") {
  if (isRecord(endpoint)) {
    return {
      node_id: typeof endpoint.node_id === "string" ? endpoint.node_id : fallbackNode,
      port_id: typeof endpoint.port_id === "string" ? endpoint.port_id : fallbackPort,
    };
  }

  if (typeof endpoint === "string" && endpoint.trim()) {
    const raw = endpoint.trim();
    const byDot = raw.split(".");
    if (byDot.length === 2) return { node_id: byDot[0], port_id: byDot[1] };
    const byColon = raw.split(":");
    if (byColon.length === 2) return { node_id: byColon[0], port_id: byColon[1] };
    const bySlash = raw.split("/");
    if (bySlash.length === 2) return { node_id: bySlash[0], port_id: bySlash[1] };
  }

  return { node_id: fallbackNode, port_id: fallbackPort };
}

function normalizeNodeType(type: unknown): string {
  if (typeof type !== "string") return "";
  const normalized = type.trim().toLowerCase();
  const aliases: Record<string, string> = {
    "output.email": "output.export",
    "output.email_send": "output.export",
    "output.send_email": "output.export",
    "output.export_email": "output.export",
  };
  return aliases[normalized] ?? normalized;
}

function normalizeWorkflowDoc(parsed: unknown): unknown {
  if (!isRecord(parsed)) return parsed;
  const doc = { ...parsed };

  if (doc.schema_version !== "1.0") {
    doc.schema_version = "1.0";
  }

  if (!isRecord(doc.workflow)) return doc;
  const workflow = { ...doc.workflow };

  if (!Array.isArray(workflow.nodes)) workflow.nodes = [];
  if (!Array.isArray(workflow.edges)) workflow.edges = [];

  workflow.nodes = workflow.nodes.map((node, idx) => {
    const rawNode = isRecord(node) ? { ...node } : {};
    const rawType = normalizeNodeType(rawNode.type);
    const isTrigger = triggerNodeTypes.includes(rawType as (typeof triggerNodeTypes)[number]);

    const config = isRecord(rawNode.config) ? { ...rawNode.config } : {};
    if (rawType === "output.export") {
      const rawFormat = typeof config.format === "string" ? config.format.toLowerCase().trim() : "";
      if (rawFormat === "email" || rawFormat === "mail") {
        config.delivery_intent = "email";
        config.format = "json";
      } else if (rawFormat === "csv") {
        config.format = "csv";
      } else {
        config.format = "json";
      }
      if (typeof config.filename !== "string" || !config.filename.trim()) {
        config.filename = config.format === "csv" ? "export.csv" : "export.json";
      }
      if (typeof config.input_path !== "string" || !config.input_path.trim()) {
        config.input_path = "$";
      }
    }

    return {
      id: typeof rawNode.id === "string" && rawNode.id ? rawNode.id : `n${idx + 1}`,
      type: rawType,
      name: typeof rawNode.name === "string" && rawNode.name ? rawNode.name : `Node ${idx + 1}`,
      position: isRecord(rawNode.position) &&
          typeof rawNode.position.x === "number" &&
          typeof rawNode.position.y === "number"
        ? rawNode.position
        : { x: 80 + idx * 220, y: 120 },
      inputs: isTrigger
        ? []
        : Array.isArray(rawNode.inputs) && rawNode.inputs.length
        ? rawNode.inputs.map((p, pIdx) => toPort(p, pIdx === 0 ? "in" : `in${pIdx + 1}`))
        : [toPort("in", "in")],
      outputs: Array.isArray(rawNode.outputs) && rawNode.outputs.length
        ? rawNode.outputs.map((p, pIdx) => toPort(p, pIdx === 0 ? "out" : `out${pIdx + 1}`))
        : [toPort("out", "out")],
      config,
      ui: isRecord(rawNode.ui) && typeof rawNode.ui.icon === "string" && typeof rawNode.ui.color === "string"
        ? rawNode.ui
        : { icon: "node", color: "neutral" },
    };
  });

  workflow.edges = workflow.edges.map((edge, idx) => {
    const rawEdge = isRecord(edge) ? { ...edge } : {};
    const source = toEndpoint(rawEdge.source);
    const target = toEndpoint(rawEdge.target);
    return {
      id: typeof rawEdge.id === "string" && rawEdge.id ? rawEdge.id : `e${idx + 1}`,
      source: {
        node_id: source.node_id,
        port_id: source.port_id || "out",
      },
      target: {
        node_id: target.node_id,
        port_id: target.port_id || "in",
      },
      label: typeof rawEdge.label === "string" ? rawEdge.label : null,
      condition: typeof rawEdge.condition === "string" ? rawEdge.condition : null,
    };
  });

  doc.workflow = workflow;
  return doc;
}

function buildSystemPrompt(args: { name?: string; description?: string; tags?: string[]; retryErrors?: string[] }) {
  const base = `You generate workflow documents for Vyntra.
Return ONLY one valid JSON object. No markdown. No prose. No code fences.

STRICT REQUIRED TOP-LEVEL SHAPE:
{
  "schema_version": "1.0",
  "workflow": {
    "id": "wf_<short>",
    "name": "<string>",
    "description": "<string>",
    "tags": ["va"],
    "entry_node_id": "n1",
    "variables": {},
    "nodes": [ ... ],
    "edges": [ ... ]
  }
}

STRICT NODE SHAPE (for EVERY node):
{
  "id": "n1",
  "type": "<allowed-type>",
  "name": "Human name",
  "position": { "x": 80, "y": 120 },
  "inputs": [ { "id":"in","label":"In","schema":"JSON" } ] OR [] for trigger nodes only,
  "outputs": [ { "id":"out","label":"Out","schema":"JSON" } ],
  "config": { ... },
  "ui": { "icon":"...", "color":"neutral" }
}

STRICT EDGE SHAPE (for EVERY edge):
{
  "id": "e1",
  "source": { "node_id": "n1", "port_id": "out" },
  "target": { "node_id": "n2", "port_id": "in" },
  "label": null,
  "condition": null
}

DO NOT use shorthand:
- source/target must be objects, never strings
- inputs/outputs must be arrays of objects, never strings
- include all required fields on every node and edge

Allowed node types only:
trigger.manual, trigger.webhook, trigger.schedule, trigger.file_upload,
ai.summarize, ai.classify, ai.extract_fields, ai.generate_report,
logic.condition, logic.delay, output.db_save, output.export.

Rules:
- schema_version must be exactly "1.0"
- exactly one trigger node
- entry_node_id must equal trigger node id
- trigger nodes must have inputs: []
- non-trigger nodes must have >=1 input
- logic.condition must have >=2 outputs and config.default_output matching one output id
- all node ids and edge ids must be unique
- edge source must reference an OUTPUT port
- edge target must reference an INPUT port
- for output.export, format must be "json" or "csv" only
- if user intent mentions sending email, still use output.export with format "json" and include config.delivery_intent="email"

Use practical config values for VA workflows.`;

  const hints = {
    name: args.name ?? "Generated Workflow",
    description: args.description ?? "Generated via Vyntra",
    tags: args.tags ?? ["va"],
  };

  const retry = args.retryErrors?.length
    ? `Previous attempt failed validation. Fix these errors:\n${args.retryErrors.join("\n")}`
    : "";

  return `${base}\nDefault metadata hints: ${JSON.stringify(hints)}\n${retry}`;
}

async function callOpenAI(prompt: string, systemPrompt: string) {
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
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
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

  return content;
}

function parseAndValidate(content: string) {
  const cleaned = cleanJson(content);
  const parsed = JSON.parse(cleaned);
  const normalized = normalizeWorkflowDoc(parsed);
  return workflowDocSchema.safeParse(normalized);
}

function monthStartIso(d = new Date()): string {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0)).toISOString();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ ok: false, error: "Method not allowed" }), {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      return new Response(JSON.stringify({ ok: false, error: "Supabase env missing" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes, error: userErr } = await client.auth.getUser();
    if (userErr || !userRes.user) {
      return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = (await req.json()) as GenerateRequest;
    if (!body?.prompt || typeof body.prompt !== "string") {
      return new Response(JSON.stringify({ ok: false, error: "Invalid request body: prompt is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!Number.isFinite(GENERATE_WORKFLOW_MONTHLY_LIMIT) || GENERATE_WORKFLOW_MONTHLY_LIMIT < 1) {
      return new Response(JSON.stringify({ ok: false, error: "Invalid GENERATE_WORKFLOW_MONTHLY_LIMIT configuration" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = userRes.user.id;
    const periodStart = monthStartIso();
    const { count, error: quotaErr } = await client
      .from("ai_generation_events")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("event_name", "generate_workflow")
      .gte("created_at", periodStart);

    if (quotaErr) {
      return new Response(JSON.stringify({ ok: false, error: `Quota check failed: ${quotaErr.message}` }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if ((count ?? 0) >= GENERATE_WORKFLOW_MONTHLY_LIMIT) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "Monthly generation limit reached",
          limit: GENERATE_WORKFLOW_MONTHLY_LIMIT,
          period_start: periodStart,
        }),
        {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const { error: usageErr } = await client.from("ai_generation_events").insert({
      user_id: userId,
      event_name: "generate_workflow",
    });
    if (usageErr) {
      return new Response(JSON.stringify({ ok: false, error: `Usage write failed: ${usageErr.message}` }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const firstAttemptRaw = await callOpenAI(body.prompt, buildSystemPrompt(body));
    const firstAttempt = parseAndValidate(firstAttemptRaw);
    if (firstAttempt.success) {
      return new Response(JSON.stringify({ ok: true, workflow_doc: firstAttempt.data }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const errors = firstAttempt.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    const secondAttemptRaw = await callOpenAI(
      body.prompt,
      buildSystemPrompt({ ...body, retryErrors: errors.slice(0, 12) }),
    );
    const secondAttempt = parseAndValidate(secondAttemptRaw);

    if (!secondAttempt.success) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "Failed to generate valid workflow JSON",
          details: secondAttempt.error.issues.map((i) => ({ path: i.path, message: i.message })),
        }),
        {
          status: 422,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    return new Response(JSON.stringify({ ok: true, workflow_doc: secondAttempt.data }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : "Unexpected error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
