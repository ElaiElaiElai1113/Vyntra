import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { WorkflowCanvas } from "@/components/WorkflowCanvas";
import { NodeInspector } from "@/components/NodeInspector";
import { supabase } from "@/lib/supabase";
import { validateWorkflowDoc } from "@/lib/workflow";
import { simulateWorkflow } from "@/lib/simulate";
import { useWorkflowStore } from "@/stores/workflowStore";
import type { WorkflowRow } from "@/types/app";

export function WorkflowDetailPage() {
  const { id } = useParams();
  const nav = useNavigate();

  const { current, setWorkflow, setSelectedNodeId, selectedNodeId } = useWorkflowStore();
  const [row, setRow] = useState<WorkflowRow | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    supabase
      .from("workflows")
      .select("*")
      .eq("id", id)
      .single()
      .then(({ data, error }) => {
        if (error) return setErrors([error.message]);
        const wf = data as WorkflowRow;
        const parsed = validateWorkflowDoc(wf.definition_json);
        if (!parsed.ok) return setErrors(parsed.errors);
        setRow(wf);
        setWorkflow(parsed.data);
      });
  }, [id, setWorkflow]);

  async function save() {
    if (!id || !current || !row) return;
    const parsed = validateWorkflowDoc(current);
    if (!parsed.ok) return setErrors(parsed.errors);

    const { error } = await supabase
      .from("workflows")
      .update({ definition_json: parsed.data, updated_at: new Date().toISOString() })
      .eq("id", id);

    if (error) return setErrors([error.message]);
    setStatus("Saved");
  }

  async function duplicate() {
    if (!current || !row) return;
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) return;

    const { data, error } = await supabase
      .from("workflows")
      .insert({
        user_id: userId,
        name: `${row.name} (Copy)`,
        description: row.description,
        prompt: row.prompt,
        tags: row.tags,
        definition_json: current,
      })
      .select("id")
      .single();

    if (error) return setErrors([error.message]);
    nav(`/app/workflows/${data.id}`);
  }

  async function remove() {
    if (!id) return;
    const { error } = await supabase.from("workflows").delete().eq("id", id);
    if (error) return setErrors([error.message]);
    nav("/app");
  }

  async function simulate() {
    if (!current || !id) return;
    const parsed = validateWorkflowDoc(current);
    if (!parsed.ok) return setErrors(parsed.errors);

    const result = simulateWorkflow(parsed.data);
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) return;

    const { error } = await supabase.from("runs").insert({
      user_id: userId,
      workflow_id: id,
      status: result.status,
      input_json: { source: "manual-test" },
      output_json: result.output,
      steps: result.steps,
    });

    if (error) return setErrors([error.message]);
    setStatus(`Simulation: ${result.status}`);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{row?.name ?? "Workflow"}</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={simulate}>Test Workflow</Button>
          <Button onClick={save}>Save</Button>
          <Button variant="outline" onClick={duplicate}>Duplicate</Button>
          <Button variant="outline" onClick={remove}>Delete</Button>
        </div>
      </div>

      {errors.length > 0 && <pre className="overflow-auto text-xs text-red-700">{errors.join("\n")}</pre>}
      {status && <p className="text-sm text-slate-600">{status}</p>}

      <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
        <div>{current ? <WorkflowCanvas doc={current} onSelectNode={setSelectedNodeId} /> : <Card>Loading...</Card>}</div>
        <div><NodeInspector key={selectedNodeId ?? "none"} /></div>
      </div>
    </div>
  );
}
