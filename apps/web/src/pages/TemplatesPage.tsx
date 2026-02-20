import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { trackEvent } from "@/lib/analytics";
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
              <Button onClick={() => useTemplate(tpl)}>Use Template</Button>
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
