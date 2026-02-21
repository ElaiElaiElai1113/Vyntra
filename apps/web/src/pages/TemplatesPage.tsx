import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { trackEvent } from "@/lib/analytics";
import { validateWorkflowDoc } from "@/lib/workflow";
import { simulateWorkflow } from "@/lib/simulate";
import type { TemplateRow } from "@/types/app";

export function TemplatesPage() {
  const [rows, setRows] = useState<TemplateRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const nav = useNavigate();

  useEffect(() => {
    supabase
      .from("templates")
      .select("*")
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (error) return setError(error.message);
        setRows((data as TemplateRow[]) ?? []);
      });
  }, []);

  async function useTemplate(t: TemplateRow) {
    const { data: userRes } = await supabase.auth.getUser();
    const userId = userRes.user?.id;
    if (!userId) return;

    const { data, error } = await supabase
      .from("workflows")
      .insert({
        user_id: userId,
        name: `${t.name} (Copy)`,
        description: t.description,
        prompt: "Created from template",
        tags: t.tags,
        definition_json: t.definition_json,
      })
      .select("id")
      .single();

    if (error) return setError(error.message);
    void trackEvent("template_used", {
      template_id: t.id,
      template_name: t.name,
      category: t.category,
      created_workflow_id: data.id,
    });
    nav(`/app/workflows/${data.id}`);
  }

  async function runTemplateDemo(t: TemplateRow) {
    setError(null);
    const { data: userRes } = await supabase.auth.getUser();
    const userId = userRes.user?.id;
    if (!userId) return setError("Please sign in first.");

    const parsed = validateWorkflowDoc(t.definition_json);
    if (!parsed.ok) return setError(parsed.errors.join("\n"));

    const { data, error } = await supabase
      .from("workflows")
      .insert({
        user_id: userId,
        name: `${t.name} (Demo)`,
        description: t.description,
        prompt: "Created from template demo run",
        tags: t.tags,
        definition_json: parsed.data,
      })
      .select("id")
      .single();

    if (error) return setError(error.message);

    const result = simulateWorkflow(parsed.data);
    const { error: runErr } = await supabase.from("runs").insert({
      user_id: userId,
      workflow_id: data.id,
      status: result.status,
      input_json: { source: "template-demo", template_id: t.id },
      output_json: result.output,
      steps: result.steps,
    });
    if (runErr) return setError(runErr.message);

    void trackEvent("template_used", {
      template_id: t.id,
      template_name: t.name,
      category: t.category,
      created_workflow_id: data.id,
      demo_run: true,
    });

    nav("/app/runs");
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Templates</h1>
        <Button asChild variant="outline">
          <Link to="/app/workflows/new">Create with Prompt</Link>
        </Button>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="grid gap-3 md:grid-cols-2">
        {rows.map((tpl) => (
          <Card key={tpl.id} className="space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="font-medium">{tpl.name}</h3>
                <p className="text-sm text-slate-600">{tpl.description}</p>
                <p className="text-xs text-slate-500">{tpl.category}</p>
              </div>
              <div className="flex gap-2">
                <Button onClick={() => useTemplate(tpl)}>Use Template</Button>
                <Button variant="outline" onClick={() => runTemplateDemo(tpl)}>Run Demo</Button>
              </div>
            </div>
            <div className="flex gap-1">
              {tpl.tags.map((tag) => (
                <Badge key={tag}>{tag}</Badge>
              ))}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
