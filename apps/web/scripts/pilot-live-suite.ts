import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

type PilotUser = { email: string; password: string };
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
const PILOT_USERS_RAW = process.env.PILOT_USERS;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !PILOT_USERS_RAW) {
  console.error("Missing env. Required: SUPABASE_URL, SUPABASE_ANON_KEY, PILOT_USERS");
  console.error("PILOT_USERS format: email1:password1,email2:password2");
  process.exit(1);
}

const pilotUsers: PilotUser[] = PILOT_USERS_RAW.split(",")
  .map((entry) => entry.trim())
  .filter(Boolean)
  .map((entry) => {
    const idx = entry.indexOf(":");
    if (idx <= 0) return null;
    return { email: entry.slice(0, idx).trim(), password: entry.slice(idx + 1).trim() };
  })
  .filter((u): u is PilotUser => Boolean(u?.email && u?.password));

if (pilotUsers.length === 0) {
  console.error("No valid PILOT_USERS parsed.");
  process.exit(1);
}

function successWorkflowDoc() {
  return {
    schema_version: "1.0",
    workflow: {
      id: "wf_pilot_suite_success",
      name: "Pilot Suite Success",
      description: "trigger -> summarize -> classify -> db save",
      tags: ["pilot", "suite", "success"],
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
          config: { sample_input: { text: "Need inbox and lead triage support." } },
          ui: { icon: "play", color: "neutral" },
        },
        {
          id: "n2",
          type: "ai.summarize",
          name: "Summarize",
          position: { x: 320, y: 120 },
          inputs: [{ id: "in", label: "In", schema: "JSON" }],
          outputs: [{ id: "out", label: "Out", schema: "JSON" }],
          config: {
            input_path: "$.input",
            style: "concise",
            bullets: true,
            output_key: "summary",
            instructions: "Summarize requested VA tasks.",
          },
          ui: { icon: "sparkles", color: "neutral" },
        },
        {
          id: "n3",
          type: "ai.classify",
          name: "Classify",
          position: { x: 560, y: 120 },
          inputs: [{ id: "in", label: "In", schema: "JSON" }],
          outputs: [{ id: "out", label: "Out", schema: "JSON" }],
          config: {
            input_path: "$.summary",
            labels: ["lead", "operations", "admin", "other"],
            output_key: "category",
            confidence_key: "category_confidence",
            instructions: "Classify into one of the labels.",
          },
          ui: { icon: "tag", color: "neutral" },
        },
        {
          id: "n4",
          type: "output.db_save",
          name: "Save",
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
        { id: "e1", source: { node_id: "n1", port_id: "out" }, target: { node_id: "n2", port_id: "in" }, label: null, condition: null },
        { id: "e2", source: { node_id: "n2", port_id: "out" }, target: { node_id: "n3", port_id: "in" }, label: null, condition: null },
        { id: "e3", source: { node_id: "n3", port_id: "out" }, target: { node_id: "n4", port_id: "in" }, label: null, condition: null },
      ],
    },
  };
}

function failureWorkflowDoc() {
  return {
    schema_version: "1.0",
    workflow: {
      id: "wf_pilot_suite_failure",
      name: "Pilot Suite Failure",
      description: "Intentional db_save failure",
      tags: ["pilot", "suite", "failure"],
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
        { id: "e1", source: { node_id: "n1", port_id: "out" }, target: { node_id: "n2", port_id: "in" }, label: null, condition: null },
      ],
    },
  };
}

async function invokeRun(workflowId: string, accessToken: string): Promise<{ status: number; data: Record<string, unknown> }> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/run-workflow`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      workflow_id: workflowId,
      input_json: { text: "Client needs inbox cleanup + reporting.", source: "pilot-suite" },
    }),
  });

  const text = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    data = { error: text || `Function failed (${res.status})` };
  }

  return { status: res.status, data };
}

async function runForUser(user: PilotUser) {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const startedAt = new Date().toISOString();

  const { data: signinRes, error: signinErr } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: user.password,
  });
  if (signinErr || !signinRes.user || !signinRes.session) {
    throw new Error(`Auth failed for ${user.email}: ${signinErr?.message ?? "no session"}`);
  }

  const userId = signinRes.user.id;
  const accessToken = signinRes.session.access_token;
  const authed = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });

  const { data: successWf, error: successWfErr } = await authed
    .from("workflows")
    .insert({
      user_id: userId,
      name: `Pilot Suite Success ${new Date().toISOString()}`,
      description: "Pilot suite success workflow",
      prompt: "pilot suite",
      tags: ["pilot", "suite", "success"],
      definition_json: successWorkflowDoc(),
    })
    .select("id")
    .single();
  if (successWfErr || !successWf?.id) {
    throw new Error(`Workflow create failed for ${user.email}: ${successWfErr?.message ?? "unknown"}`);
  }

  const successRun = await invokeRun(successWf.id as string, accessToken);
  if (successRun.status !== 200 || !successRun.data.ok || typeof successRun.data.run_id !== "string") {
    throw new Error(`Success run failed for ${user.email}: status=${successRun.status} body=${JSON.stringify(successRun.data)}`);
  }

  const { data: savedItems, error: savedItemsErr } = await authed
    .from("va_items")
    .select("id,source_node_id,data_json,created_at")
    .eq("workflow_id", successWf.id)
    .gte("created_at", startedAt)
    .order("created_at", { ascending: false })
    .limit(1);
  if (savedItemsErr || !savedItems || savedItems.length === 0) {
    throw new Error(`No va_items for success run (${user.email}): ${savedItemsErr?.message ?? "none"}`);
  }
  const latest = savedItems[0] as { source_node_id?: string | null; data_json?: Json };
  const summary = latest.data_json?.summary;
  const category = latest.data_json?.category;
  const confidence = latest.data_json?.category_confidence;
  if (latest.source_node_id !== "n4") throw new Error(`Unexpected source_node_id (${user.email}): ${String(latest.source_node_id)}`);
  if (typeof summary !== "string" || summary.trim().length < 5) throw new Error(`Missing summary (${user.email})`);
  if (typeof category !== "string" || category.trim().length < 2) throw new Error(`Missing category (${user.email})`);
  if (typeof confidence !== "number" || confidence < 0 || confidence > 1) throw new Error(`Invalid category_confidence (${user.email})`);

  const { data: failureWf, error: failureWfErr } = await authed
    .from("workflows")
    .insert({
      user_id: userId,
      name: `Pilot Suite Failure ${new Date().toISOString()}`,
      description: "Pilot suite failure workflow",
      prompt: "pilot suite",
      tags: ["pilot", "suite", "failure"],
      definition_json: failureWorkflowDoc(),
    })
    .select("id")
    .single();
  if (failureWfErr || !failureWf?.id) {
    throw new Error(`Failure workflow create failed for ${user.email}: ${failureWfErr?.message ?? "unknown"}`);
  }

  const failureRun = await invokeRun(failureWf.id as string, accessToken);
  if (failureRun.status !== 500 || typeof failureRun.data.run_id !== "string") {
    throw new Error(`Failure run did not fail as expected (${user.email}): status=${failureRun.status} body=${JSON.stringify(failureRun.data)}`);
  }

  const { data: failedRunRow, error: failedRunErr } = await authed
    .from("runs")
    .select("id,status")
    .eq("id", failureRun.data.run_id as string)
    .single();
  if (failedRunErr || !failedRunRow || failedRunRow.status !== "failed") {
    throw new Error(`Failed run not persisted correctly (${user.email}): ${failedRunErr?.message ?? "status mismatch"}`);
  }

  return {
    email: user.email,
    successRunId: successRun.data.run_id as string,
    failedRunId: failureRun.data.run_id as string,
  };
}

async function main() {
  const results: Array<{ email: string; successRunId: string; failedRunId: string }> = [];
  for (const user of pilotUsers) {
    const result = await runForUser(user);
    results.push(result);
    console.log(`PASS ${result.email} success_run=${result.successRunId} failed_run=${result.failedRunId}`);
  }
  console.log(`Pilot live suite passed for ${results.length} user(s).`);
}

main().catch((err) => {
  console.error(`Pilot live suite failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
