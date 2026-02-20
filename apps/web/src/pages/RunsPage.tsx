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
};

function asSteps(input: unknown): StepView[] {
  if (!Array.isArray(input)) return [];
  return input as StepView[];
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
      <h1 className="text-2xl font-semibold">Simulation Runs</h1>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="space-y-3">
        {rows.map((run) => (
          <Card key={run.id} className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-sm text-slate-600">{new Date(run.created_at).toLocaleString()}</div>
              <Badge className={run.status === "success" ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"}>
                {run.status}
              </Badge>
            </div>
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
