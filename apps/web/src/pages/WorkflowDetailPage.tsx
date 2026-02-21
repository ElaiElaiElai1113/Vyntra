import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { WorkflowCanvas } from "@/components/WorkflowCanvas";
import { NodeInspector } from "@/components/NodeInspector";
import { SemanticEditorRail } from "@/components/SemanticEditorRail";
import { supabase } from "@/lib/supabase";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/env";
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
  const [showInputPanel, setShowInputPanel] = useState(false);
  const [testInputText, setTestInputText] = useState("{}");

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
        const trigger = parsed.data.workflow.nodes.find((n) => n.id === parsed.data.workflow.entry_node_id);
        const triggerConfig = (trigger?.config ?? {}) as Record<string, unknown>;
        const sampleInput =
          triggerConfig.sample_input ??
          triggerConfig.sample_payload ??
          triggerConfig.payload ??
          {};
        setTestInputText(JSON.stringify(sampleInput, null, 2));
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

    let inputOverride: Record<string, unknown> | undefined = undefined;
    if (testInputText.trim()) {
      try {
        inputOverride = JSON.parse(testInputText) as Record<string, unknown>;
      } catch {
        return setErrors(["Test input must be valid JSON."]);
      }
    }

    const result = simulateWorkflow(parsed.data, inputOverride);
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) return;

    const { error } = await supabase.from("runs").insert({
      user_id: userId,
      workflow_id: id,
      status: result.status,
      input_json: { source: "manual-test", payload: inputOverride ?? {} },
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

  async function runLive() {
    if (!id) return;

    let inputOverride: Record<string, unknown> | undefined = undefined;
    if (testInputText.trim()) {
      try {
        inputOverride = JSON.parse(testInputText) as Record<string, unknown>;
      } catch {
        return setErrors(["Demo input must be valid JSON."]);
      }
    }

    setErrors([]);
    setStatus("Running live...");

    const { data: sessionRes, error: sessionErr } = await supabase.auth.getSession();
    const accessToken = sessionRes.session?.access_token;
    if (sessionErr || !accessToken) {
      setStatus(null);
      return setErrors(["You are not authenticated. Please sign out, sign in again, then retry Run Live."]);
    }

    const res = await fetch(`${SUPABASE_URL}/functions/v1/run-workflow`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ workflow_id: id, input_json: inputOverride }),
    });

    const rawText = await res.text();
    let data: Record<string, unknown> = {};
    try {
      data = rawText ? (JSON.parse(rawText) as Record<string, unknown>) : {};
    } catch {
      data = { error: rawText || `Function failed (${res.status})` };
    }

    if (!res.ok) {
      const message = (data.error as string | undefined) ?? `Function failed (${res.status})`;
      setStatus(null);
      return setErrors([message]);
    }

    const ok = data?.ok as boolean | undefined;
    if (!ok) {
      const message =
        (data as { error?: string; details?: string })?.details ??
        (data as { error?: string })?.error ??
        "Live run failed";
      setStatus(null);
      return setErrors([message]);
    }

    const runId = (data as { run_id?: string })?.run_id;
    setStatus(`Live run completed${runId ? ` (run ${runId.slice(0, 8)})` : ""}`);
    void trackEvent("live_run", {
      source: "workflow_detail",
      workflow_id: id,
      run_id: runId,
      success: true,
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
          <Button variant="outline" onClick={() => setShowInputPanel((v) => !v)}>
            {showInputPanel ? "Hide Demo Input" : "Demo Input"}
          </Button>
          <Button variant="outline" onClick={simulate}>Test Workflow</Button>
          <Button onClick={runLive}>Run Live</Button>
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
      {showInputPanel && (
        <Card className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-slate-100">Demo Input Payload (JSON)</p>
            <Button
              variant="outline"
              onClick={() => {
                if (!current) return;
                const trigger = current.workflow.nodes.find((n) => n.id === current.workflow.entry_node_id);
                const triggerConfig = (trigger?.config ?? {}) as Record<string, unknown>;
                const sampleInput =
                  triggerConfig.sample_input ??
                  triggerConfig.sample_payload ??
                  triggerConfig.payload ??
                  {};
                setTestInputText(JSON.stringify(sampleInput, null, 2));
              }}
            >
              Reset to Trigger Sample
            </Button>
          </div>
          <Textarea rows={10} value={testInputText} onChange={(e) => setTestInputText(e.target.value)} />
          <p className="text-xs text-slate-400">Used for both Test Workflow and Run Live. Stored in run input for reproducible demos.</p>
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
