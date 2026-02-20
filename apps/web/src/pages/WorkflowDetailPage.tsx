import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { WorkflowCanvas } from "@/components/WorkflowCanvas";
import { NodeInspector } from "@/components/NodeInspector";
import { SemanticEditorRail } from "@/components/SemanticEditorRail";
import { supabase } from "@/lib/supabase";
import { trackEvent } from "@/lib/analytics";
import { validateWorkflowDoc } from "@/lib/workflow";
import { simulateWorkflow } from "@/lib/simulate";
import { useWorkflowStore } from "@/stores/workflowStore";
import type { WorkflowRow } from "@/types/app";

export function WorkflowDetailPage() {
  const { id } = useParams();
  const nav = useNavigate();

  const { current, setWorkflow, setSelectedNodeId, selectedNodeId, patchNode } = useWorkflowStore();
  const [row, setRow] = useState<WorkflowRow | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [showJson, setShowJson] = useState(false);

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
    void trackEvent("workflow_saved", {
      source: "workflow_detail",
      workflow_id: id,
      node_count: parsed.data.workflow.nodes.length,
      edge_count: parsed.data.workflow.edges.length,
    });
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
    void trackEvent("simulation_run", {
      source: "workflow_detail",
      workflow_id: id,
      status: result.status,
      step_count: result.steps.length,
      saved: true,
    });
  }

  async function copyJson() {
    if (!current) return;
    await navigator.clipboard.writeText(JSON.stringify(current, null, 2));
    setStatus("Workflow JSON copied.");
  }

  function downloadJson() {
    if (!current) return;
    const blob = new Blob([JSON.stringify(current, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${current.workflow.id || "workflow"}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function onMoveNode(nodeId: string, position: { x: number; y: number }) {
    if (!current) return;
    const node = current.workflow.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    patchNode({ ...node, position });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{row?.name ?? "Workflow"}</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={simulate}>Test Workflow</Button>
          <Button onClick={save}>Save</Button>
          <Button variant="outline" onClick={() => setShowJson((v) => !v)}>
            {showJson ? "Hide JSON" : "View JSON"}
          </Button>
          <Button variant="outline" onClick={copyJson}>Copy JSON</Button>
          <Button variant="outline" onClick={downloadJson}>Download JSON</Button>
          <Button variant="outline" onClick={duplicate}>Duplicate</Button>
          <Button variant="outline" onClick={remove}>Delete</Button>
        </div>
      </div>

      {errors.length > 0 && <pre className="overflow-auto text-xs text-red-700">{errors.join("\n")}</pre>}
      {status && <p className="text-sm text-slate-600">{status}</p>}
      {showJson && current && (
        <Card>
          <pre className="max-h-80 overflow-auto rounded bg-slate-50 p-2 text-xs">{JSON.stringify(current, null, 2)}</pre>
        </Card>
      )}

      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <div>{current ? <WorkflowCanvas doc={current} onSelectNode={setSelectedNodeId} onMoveNode={onMoveNode} /> : <Card>Loading...</Card>}</div>
        <div className="grid h-[600px] gap-4 grid-rows-[1fr_1fr]">
          <NodeInspector key={selectedNodeId ?? "none"} />
          <SemanticEditorRail />
        </div>
      </div>
    </div>
  );
}
