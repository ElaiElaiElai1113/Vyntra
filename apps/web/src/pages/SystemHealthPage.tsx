import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/lib/supabase";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/env";

type CheckStatus = "pending" | "pass" | "fail";
type HealthCheck = { key: string; label: string; status: CheckStatus; detail: string };

function badgeClass(status: CheckStatus) {
  if (status === "pass") return "bg-emerald-100 text-emerald-800";
  if (status === "fail") return "bg-red-100 text-red-800";
  return "bg-slate-200 text-slate-800";
}

const CORE_TABLES = [
  "profiles",
  "workflows",
  "runs",
  "va_items",
  "workflow_exports",
  "analytics_events",
  "ai_generation_events",
] as const;

export function SystemHealthPage() {
  const [loading, setLoading] = useState(false);
  const [lastRunAt, setLastRunAt] = useState<string | null>(null);
  const [checks, setChecks] = useState<HealthCheck[]>([
    { key: "auth", label: "Auth Session", status: "pending", detail: "Waiting..." },
    { key: "tables", label: "Core Tables", status: "pending", detail: "Waiting..." },
    { key: "run_fn", label: "run-workflow Function", status: "pending", detail: "Waiting..." },
  ]);

  async function runChecks() {
    setLoading(true);
    setChecks([
      { key: "auth", label: "Auth Session", status: "pending", detail: "Checking..." },
      { key: "tables", label: "Core Tables", status: "pending", detail: "Checking..." },
      { key: "run_fn", label: "run-workflow Function", status: "pending", detail: "Checking..." },
    ]);

    const next = new Map<string, HealthCheck>();
    const put = (c: HealthCheck) => next.set(c.key, c);

    const { data: sessionRes, error: sessionErr } = await supabase.auth.getSession();
    const accessToken = sessionRes.session?.access_token;
    const userId = sessionRes.session?.user?.id;
    if (sessionErr || !accessToken || !userId) {
      put({
        key: "auth",
        label: "Auth Session",
        status: "fail",
        detail: sessionErr?.message ?? "No active user session.",
      });
      put({
        key: "tables",
        label: "Core Tables",
        status: "fail",
        detail: "Skipped because auth session failed.",
      });
      put({
        key: "run_fn",
        label: "run-workflow Function",
        status: "fail",
        detail: "Skipped because auth session failed.",
      });
      setChecks(Array.from(next.values()));
      setLastRunAt(new Date().toLocaleString());
      setLoading(false);
      return;
    }
    put({ key: "auth", label: "Auth Session", status: "pass", detail: `Authenticated as ${userId.slice(0, 8)}...` });

    const missingTables: string[] = [];
    for (const table of CORE_TABLES) {
      const { error } = await supabase.from(table).select("id", { head: true, count: "exact" }).limit(1);
      if (error) missingTables.push(`${table}: ${error.message}`);
    }
    if (missingTables.length) {
      put({
        key: "tables",
        label: "Core Tables",
        status: "fail",
        detail: missingTables.join(" | "),
      });
    } else {
      put({ key: "tables", label: "Core Tables", status: "pass", detail: "All required tables are reachable." });
    }

    const runRes = await fetch(`${SUPABASE_URL}/functions/v1/run-workflow`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ workflow_id: "00000000-0000-0000-0000-000000000000", input_json: {} }),
    });
    const runText = await runRes.text();
    const reachable = runRes.status !== 401 && runRes.status !== 404;
    if (reachable) {
      put({
        key: "run_fn",
        label: "run-workflow Function",
        status: "pass",
        detail: `Function reachable. status=${runRes.status}`,
      });
    } else {
      put({
        key: "run_fn",
        label: "run-workflow Function",
        status: "fail",
        detail: `status=${runRes.status} body=${runText}`,
      });
    }

    setChecks(Array.from(next.values()));
    setLastRunAt(new Date().toLocaleString());
    setLoading(false);
  }

  useEffect(() => {
    void runChecks();
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">System Health</h1>
        <Button variant="outline" onClick={runChecks} disabled={loading}>
          {loading ? "Checking..." : "Run Checks"}
        </Button>
      </div>
      {lastRunAt && <p className="text-xs text-slate-400">Last checked: {lastRunAt}</p>}
      <div className="grid gap-3 md:grid-cols-2">
        {checks.map((c) => (
          <Card key={c.key} className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="font-medium text-slate-100">{c.label}</h3>
              <Badge className={badgeClass(c.status)}>{c.status}</Badge>
            </div>
            <p className="text-xs text-slate-300">{c.detail}</p>
          </Card>
        ))}
      </div>
    </div>
  );
}
