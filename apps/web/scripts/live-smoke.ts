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

function workflowDoc() {
  return {
    schema_version: "1.0",
    workflow: {
      id: "wf_live_smoke",
      name: "Live Smoke Workflow",
      description: "Manual trigger -> summarize -> db save",
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
          type: "output.db_save",
          name: "Save Result",
          position: { x: 560, y: 120 },
          inputs: [{ id: "in", label: "In", schema: "JSON" }],
          outputs: [{ id: "out", label: "Out", schema: "JSON" }],
          config: {
            table: "va_items",
            mode: "insert",
            mapping: {
              input: "$.input",
              summary: "$.summary",
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
      ],
    },
  };
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

  const { data: workflow, error: wfErr } = await authedClient
    .from("workflows")
    .insert({
      user_id: userId,
      name: `Live Smoke ${new Date().toISOString()}`,
      description: "Automated smoke verification workflow",
      prompt: "smoke test",
      tags: ["smoke", "live"],
      definition_json: workflowDoc(),
    })
    .select("id")
    .single();

  if (wfErr || !workflow?.id) {
    throw new Error(`Workflow create failed: ${wfErr?.message ?? "unknown"}`);
  }

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

  const invokeRes = await fetch(`${SUPABASE_URL}/functions/v1/run-workflow`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      workflow_id: workflow.id,
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
    .eq("workflow_id", workflow.id)
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
  if (latest.source_node_id !== "n3") {
    throw new Error(`Unexpected source_node_id: ${String(latest.source_node_id)}`);
  }
  if (typeof summary !== "string" || summary.trim().length < 5) {
    throw new Error("Expected non-empty summary in va_items.data_json.summary.");
  }

  console.log(`Smoke live run passed. workflow_id=${workflow.id} run_id=${runId}`);
}

run().catch((err) => {
  console.error(`Smoke live run failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
