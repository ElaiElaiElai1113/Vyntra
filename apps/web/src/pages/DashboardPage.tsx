import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import type { WorkflowRow } from "@/types/app";

export function DashboardPage() {
  const [rows, setRows] = useState<WorkflowRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from("workflows")
      .select("*")
      .order("updated_at", { ascending: false })
      .then(({ data, error }) => {
        if (error) return setError(error.message);
        setRows((data as WorkflowRow[]) ?? []);
      });
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Workflows</h1>
        <Button asChild>
          <Link to="/app/workflows/new">New Workflow</Link>
        </Button>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="grid gap-3 md:grid-cols-2">
        {rows.map((wf) => (
          <Card key={wf.id} className="space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-medium">{wf.name}</h3>
                <p className="text-sm text-slate-600">{wf.description}</p>
              </div>
              <Button asChild variant="outline">
                <Link to={`/app/workflows/${wf.id}`}>Open</Link>
              </Button>
            </div>
            <div className="flex gap-1">
              {(wf.tags || []).map((tag) => (
                <Badge key={tag}>{tag}</Badge>
              ))}
            </div>
          </Card>
        ))}
      </div>
      <Card>
        <p className="text-sm text-slate-600">Need a starting point? Browse curated templates.</p>
        <Button asChild className="mt-2">
          <Link to="/app/templates">Open Template Library</Link>
        </Button>
      </Card>
    </div>
  );
}
