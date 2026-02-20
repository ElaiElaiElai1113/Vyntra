import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/lib/supabase";
import type { RunRow } from "@/types/app";

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
            <pre className="max-h-60 overflow-auto rounded bg-slate-50 p-2 text-xs">{JSON.stringify(run.steps, null, 2)}</pre>
          </Card>
        ))}
      </div>
    </div>
  );
}
