import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

type Json = Record<string, unknown>;

function loadEnvFile(filePath: string) {
  if (!existsSync(filePath)) return;
  const content = readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvFile(path.resolve(process.cwd(), ".env"));
loadEnvFile(path.resolve(process.cwd(), ".env.local"));

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const TEST_EMAIL = process.env.SMOKE_TEST_EMAIL;
const TEST_PASSWORD = process.env.SMOKE_TEST_PASSWORD;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !TEST_EMAIL || !TEST_PASSWORD) {
  console.error(
    "Missing required env. Set SUPABASE_URL, SUPABASE_ANON_KEY, SMOKE_TEST_EMAIL, SMOKE_TEST_PASSWORD.",
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const json = Buffer.from(padded, "base64").toString("utf8");
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function successWorkflowDoc() {
  return {
    schema_version: "1.0",
    workflow: {
      id: "wf_live_smoke_success",
      name: "Live Smoke Workflow Success",
      description: "Manual trigger -> summarize -> classify -> db save",
      tags: ["smoke", "live"],
      entry_node_id: "n1",
      variables: {},
      nodes: [
        {
          id: "n1",
          type: "trigger.manual",
          name: "Manual Trigger",
          position: { x: 80, y: 120 },
          inputs: [],
          outputs: [{ id: "out", label: "Out", schema: "JSON" }],
          config: {
            sample_input: {
              text: "Client asks for weekly reporting and lead triage support.",
              source: "smoke-script",
            },
          },
          ui: { icon: "play", color: "neutral" },
        },
        {
          id: "n2",
          type: "ai.summarize",
          name: "Summarize Request",
          position: { x: 320, y: 120 },
          inputs: [{ id: "in", label: "In", schema: "JSON" }],
          outputs: [{ id: "out", label: "Out", schema: "JSON" }],
          config: {
            input_path: "$.input",
            style: "concise",
            bullets: true,
            output_key: "summary",
            instructions: "Summarize the VA work requested by the client.",
          },
          ui: { icon: "sparkles", color: "neutral" },
        },
        {
          id: "n3",
          type: "ai.classify",
          name: "Classify Request",
          position: { x: 560, y: 120 },
          inputs: [{ id: "in", label: "In", schema: "JSON" }],
          outputs: [{ id: "out", label: "Out", schema: "JSON" }],
          config: {
            input_path: "$.summary",
            labels: ["lead", "operations", "admin", "other"],
            output_key: "category",
            confidence_key: "category_confidence",
            instructions: "Classify into one of the provided labels.",
          },
          ui: { icon: "tag", color: "neutral" },
        },
        {
          id: "n4",
          type: "output.db_save",
          name: "Save Result",
          position: { x: 800, y: 120 },
          inputs: [{ id: "in", label: "In", schema: "JSON" }],
          outputs: [{ id: "out", label: "Out", schema: "JSON" }],
          config: {
            table: "va_items",
            mode: "insert",
            mapping: {
              input: "$.input",
              summary: "$.summary",
              category: "$.category",
              category_confidence: "$.category_confidence",
            },
          },
          ui: { icon: "database", color: "neutral" },
        },
      ],
      edges: [
        {
          id: "e1",
          source: { node_id: "n1", port_id: "out" },
          target: { node_id: "n2", port_id: "in" },
          label: null,
          condition: null,
        },
        {
          id: "e2",
          source: { node_id: "n2", port_id: "out" },
          target: { node_id: "n3", port_id: "in" },
          label: null,
          condition: null,
        },
        {
          id: "e3",
          source: { node_id: "n3", port_id: "out" },
          target: { node_id: "n4", port_id: "in" },
          label: null,
          condition: null,
        },
      ],
    },
  };
}

function failureWorkflowDoc() {
  return {
    schema_version: "1.0",
    workflow: {
      id: "wf_live_smoke_failure",
      name: "Live Smoke Workflow Failure",
      description: "Intentional failure path for run status validation",
      tags: ["smoke", "live", "failure"],
      entry_node_id: "n1",
      variables: {},
      nodes: [
        {
          id: "n1",
          type: "trigger.manual",
          name: "Manual Trigger",
          position: { x: 80, y: 120 },
          inputs: [],
          outputs: [{ id: "out", label: "Out", schema: "JSON" }],
          config: { sample_input: { text: "force failure" } },
          ui: { icon: "play", color: "neutral" },
        },
        {
          id: "n2",
          type: "output.db_save",
          name: "Broken Save",
          position: { x: 320, y: 120 },
          inputs: [{ id: "in", label: "In", schema: "JSON" }],
          outputs: [{ id: "out", label: "Out", schema: "JSON" }],
          config: {
            table: "definitely_missing_table",
            mode: "insert",
            mapping: { input: "$.input" },
          },
          ui: { icon: "database", color: "neutral" },
        },
      ],
      edges: [
        {
          id: "e1",
          source: { node_id: "n1", port_id: "out" },
          target: { node_id: "n2", port_id: "in" },
          label: null,
          condition: null,
        },
      ],
    },
  };
}

async function createWorkflow(
  authedClient: ReturnType<typeof createClient>,
  userId: string,
  args: { name: string; tags: string[]; definition_json: Record<string, unknown> },
) {
  const { data: workflow, error: wfErr } = await authedClient
    .from("workflows")
    .insert({
      user_id: userId,
      name: `${args.name} ${new Date().toISOString()}`,
      description: "Automated smoke verification workflow",
      prompt: "smoke test",
      tags: args.tags,
      definition_json: args.definition_json,
    })
    .select("id")
    .single();
  if (wfErr || !workflow?.id) {
    throw new Error(`Workflow create failed: ${wfErr?.message ?? "unknown"}`);
  }
  return workflow.id as string;
}

async function invokeRun(workflowId: string, accessToken: string) {
  const invokeRes = await fetch(`${SUPABASE_URL}/functions/v1/run-workflow`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      workflow_id: workflowId,
      input_json: {
        text: "Client wants inbox cleanup, task triage, and weekly reporting.",
        source: "live-smoke",
      },
    }),
  });
  const invokeText = await invokeRes.text();
  let invokeData: Record<string, unknown> = {};
  try {
    invokeData = invokeText ? (JSON.parse(invokeText) as Record<string, unknown>) : {};
  } catch {
    invokeData = { error: invokeText || `Function failed (${invokeRes.status})` };
  }
  return { invokeRes, invokeData };
}

async function run() {
  const startedAtIso = new Date().toISOString();
  const { data: signinRes, error: signinErr } = await supabase.auth.signInWithPassword({
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
  });
  if (signinErr || !signinRes.user || !signinRes.session) {
    throw new Error(`Auth failed: ${signinErr?.message ?? "no session"}`);
  }
  const userId = signinRes.user.id;
  const accessToken = signinRes.session.access_token;
  const claims = decodeJwtPayload(accessToken);
  console.log(
    `Signed in. token_ref=${String(claims?.ref ?? "n/a")} token_exp=${String(claims?.exp ?? "n/a")}`,
  );
  const authedClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });

  const successWorkflowId = await createWorkflow(authedClient, userId, {
    name: "Live Smoke Success",
    tags: ["smoke", "live", "success"],
    definition_json: successWorkflowDoc(),
  });

  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!userRes.ok) {
    const txt = await userRes.text();
    throw new Error(`Auth preflight failed: status=${userRes.status} body=${txt}`);
  }
  console.log("Auth preflight passed.");

  const { invokeRes, invokeData } = await invokeRun(successWorkflowId, accessToken);
  if (!invokeRes.ok) {
    throw new Error(
      `Function invoke failed: status=${invokeRes.status} body=${JSON.stringify(invokeData)}`,
    );
  }
  if (!invokeData?.ok || !invokeData?.run_id) {
    throw new Error(`Run failed: ${JSON.stringify(invokeData)}`);
  }

  const runId = String(invokeData.run_id);
  const { data: runRow, error: runErr } = await authedClient
    .from("runs")
    .select("id,status,steps,output_json,created_at")
    .eq("id", runId)
    .single();
  if (runErr || !runRow) {
    throw new Error(`Run fetch failed: ${runErr?.message ?? "not found"}`);
  }
  if (runRow.status !== "success") {
    throw new Error(`Expected success run, got: ${runRow.status}`);
  }

  const { data: vaItems, error: itemsErr } = await authedClient
    .from("va_items")
    .select("id,workflow_id,source_node_id,created_at,data_json")
    .eq("workflow_id", successWorkflowId)
    .gte("created_at", startedAtIso)
    .order("created_at", { ascending: false })
    .limit(1);
  if (itemsErr) {
    throw new Error(`va_items query failed: ${itemsErr.message}`);
  }
  if (!vaItems || vaItems.length === 0) {
    throw new Error("Expected at least one va_items row for smoke workflow run.");
  }

  const latest = vaItems[0] as { data_json?: Json; source_node_id?: string | null };
  const summary = latest.data_json?.summary;
  const category = latest.data_json?.category;
  const categoryConfidence = latest.data_json?.category_confidence;
  if (latest.source_node_id !== "n4") {
    throw new Error(`Unexpected source_node_id: ${String(latest.source_node_id)}`);
  }
  if (typeof summary !== "string" || summary.trim().length < 5) {
    throw new Error("Expected non-empty summary in va_items.data_json.summary.");
  }
  if (typeof category !== "string" || category.trim().length < 2) {
    throw new Error("Expected non-empty category in va_items.data_json.category.");
  }
  if (typeof categoryConfidence !== "number" || categoryConfidence < 0 || categoryConfidence > 1) {
    throw new Error("Expected category_confidence to be a number between 0 and 1.");
  }

  const failureWorkflowId = await createWorkflow(authedClient, userId, {
    name: "Live Smoke Failure",
    tags: ["smoke", "live", "failure"],
    definition_json: failureWorkflowDoc(),
  });
  const { invokeRes: failRes, invokeData: failData } = await invokeRun(failureWorkflowId, accessToken);
  if (failRes.status !== 500) {
    throw new Error(
      `Expected failure run HTTP 500, got ${failRes.status}. ` +
      `Response=${JSON.stringify(failData)}. ` +
      "If this is 200, your hosted run-workflow is likely running an older deployment.",
    );
  }
  const failedRunId = typeof failData.run_id === "string" ? failData.run_id : "";
  if (!failedRunId) {
    throw new Error(`Expected failed run id in response, got ${JSON.stringify(failData)}`);
  }
  const { data: failedRun, error: failedRunErr } = await authedClient
    .from("runs")
    .select("id,status")
    .eq("id", failedRunId)
    .single();
  if (failedRunErr || !failedRun) {
    throw new Error(`Failed run fetch failed: ${failedRunErr?.message ?? "not found"}`);
  }
  if (failedRun.status !== "failed") {
    throw new Error(`Expected failed run status, got ${failedRun.status}`);
  }

  console.log(
    `Smoke live run passed. success_workflow_id=${successWorkflowId} success_run_id=${runId} failed_workflow_id=${failureWorkflowId} failed_run_id=${failedRunId}`,
  );
}

run().catch((err) => {
  console.error(`Smoke live run failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
