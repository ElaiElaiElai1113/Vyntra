import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/lib/supabase";
import type { RunRow } from "@/types/app";

type StepView = {
  node_id?: string;
  node_name?: string;
  node_type?: string;
  status?: string;
  duration_ms?: number;
  selected_output_port?: string | null;
  next_node_ids?: string[];
  error?: string;
  output?: {
    export?: {
      format?: string;
      filename?: string;
      content?: string;
      data?: unknown;
    };
    db_save?: {
      table?: string;
      payload?: Record<string, unknown>;
    };
    [key: string]: unknown;
  };
};

function asSteps(input: unknown): StepView[] {
  if (!Array.isArray(input)) return [];
  return input as StepView[];
}

function summarizeRun(run: RunRow) {
  const steps = asSteps(run.steps);
  const total = steps.length;
  const success = steps.filter((s) => s.status === "success").length;
  const failed = steps.filter((s) => s.status === "failed").length;
  const duration = steps.reduce((acc, s) => acc + (typeof s.duration_ms === "number" ? s.duration_ms : 0), 0);
  return { total, success, failed, duration };
}

function runSource(run: RunRow): string {
  const source = run.input_json?.source;
  return typeof source === "string" ? source : "unknown";
}

export function RunsPage() {
  const [rows, setRows] = useState<RunRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from("runs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100)
      .then(({ data, error }) => {
        if (error) return setError(error.message);
        setRows((data as RunRow[]) ?? []);
      });
  }, []);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Workflow Runs</h1>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="space-y-3">
        {rows.map((run) => (
          <Card key={run.id} className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-sm text-slate-600">{new Date(run.created_at).toLocaleString()}</div>
              <div className="flex items-center gap-2">
                <Badge className={runSource(run) === "run-live" ? "bg-cyan-100 text-cyan-800" : "bg-slate-200 text-slate-800"}>
                  {runSource(run) === "run-live" ? "live" : "simulation"}
                </Badge>
                <Badge className={run.status === "success" ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"}>
                  {run.status}
                </Badge>
              </div>
            </div>
            <div className="grid gap-2 rounded border border-white/10 bg-black/20 p-2 text-xs md:grid-cols-4">
              <div className="rounded bg-white/5 p-2">
                <div className="text-[11px] text-slate-400">Steps</div>
                <div className="text-sm font-semibold text-slate-100">{summarizeRun(run).total}</div>
              </div>
              <div className="rounded bg-emerald-500/10 p-2">
                <div className="text-[11px] text-slate-400">Successful</div>
                <div className="text-sm font-semibold text-emerald-300">{summarizeRun(run).success}</div>
              </div>
              <div className="rounded bg-red-500/10 p-2">
                <div className="text-[11px] text-slate-400">Failed</div>
                <div className="text-sm font-semibold text-red-300">{summarizeRun(run).failed}</div>
              </div>
              <div className="rounded bg-cyan-500/10 p-2">
                <div className="text-[11px] text-slate-400">Duration</div>
                <div className="text-sm font-semibold text-cyan-200">{summarizeRun(run).duration} ms</div>
              </div>
            </div>
            <details className="rounded border border-white/10 bg-black/20 p-2 text-xs">
              <summary className="cursor-pointer text-slate-200">Run Confirmation (Input + Final Output)</summary>
              <div className="mt-2 grid gap-2 md:grid-cols-2">
                <div>
                  <div className="mb-1 text-[11px] text-slate-400">Input JSON</div>
                  <pre className="max-h-48 overflow-auto rounded bg-black/40 p-2 text-[10px] text-slate-200">
                    {JSON.stringify(run.input_json, null, 2)}
                  </pre>
                </div>
                <div>
                  <div className="mb-1 text-[11px] text-slate-400">Final Output JSON</div>
                  <pre className="max-h-48 overflow-auto rounded bg-black/40 p-2 text-[10px] text-slate-200">
                    {JSON.stringify(run.output_json, null, 2)}
                  </pre>
                </div>
              </div>
            </details>
            <div className="space-y-2 rounded bg-slate-50 p-2">
              {asSteps(run.steps).length === 0 ? (
                <p className="text-xs text-slate-500">No step details available.</p>
              ) : (
                asSteps(run.steps).map((step, idx) => (
                  <div key={`${run.id}-step-${idx}`} className="rounded border border-slate-200 bg-white p-2 text-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{step.node_name ?? step.node_id ?? `Step ${idx + 1}`}</span>
                      <Badge className={step.status === "success" ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"}>
                        {step.status ?? "unknown"}
                      </Badge>
                      {typeof step.duration_ms === "number" && (
                        <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] text-slate-700">
                          {step.duration_ms} ms
                        </span>
                      )}
                    </div>
                    <div className="mt-1 grid gap-1 text-[11px] text-slate-600">
                      <div>Type: {step.node_type ?? "n/a"}</div>
                      <div>Selected Output: {step.selected_output_port ?? "n/a"}</div>
                      <div>Next Nodes: {(step.next_node_ids ?? []).join(", ") || "none"}</div>
                      {step.error && <div className="text-red-700">Error: {step.error}</div>}
                      {step.output?.db_save && (
                        <div className="rounded border border-white/10 bg-black/20 p-2">
                          <div className="text-[11px] text-cyan-200">DB Save Preview ({step.output.db_save.table ?? "table"})</div>
                          <pre className="mt-1 max-h-28 overflow-auto text-[10px] text-slate-300">
                            {JSON.stringify(step.output.db_save.payload ?? {}, null, 2)}
                          </pre>
                        </div>
                      )}
                      {step.output?.export && (
                        <div className="rounded border border-white/10 bg-black/20 p-2">
                          <div className="text-[11px] text-violet-200">
                            Export Preview ({step.output.export.format ?? "json"}) {step.output.export.filename ? `- ${step.output.export.filename}` : ""}
                          </div>
                          <pre className="mt-1 max-h-28 overflow-auto text-[10px] text-slate-300">
                            {typeof step.output.export.content === "string"
                              ? step.output.export.content
                              : JSON.stringify(step.output.export.data ?? {}, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
