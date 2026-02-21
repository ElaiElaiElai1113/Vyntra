import assert from "node:assert/strict";
import type { WorkflowDoc } from "../../../../shared/schema/workflow.ts";
import { validateWorkflowDoc } from "./workflow.ts";
import { applySemanticCommand } from "./semanticEdit.ts";

function baseDoc(): WorkflowDoc {
  return {
    schema_version: "1.0" as const,
    workflow: {
      id: "wf_test",
      name: "Smoke Test Workflow",
      description: "Validator and semantic edit smoke tests",
      tags: ["va"],
      entry_node_id: "n1",
      variables: {},
      nodes: [
        {
          id: "n1",
          type: "trigger.manual",
          name: "Start",
          position: { x: 80, y: 120 },
          inputs: [],
          outputs: [{ id: "out", label: "Out", schema: "JSON" }],
          config: { sample_input: {} },
          ui: { icon: "play", color: "neutral" },
        },
        {
          id: "n2",
          type: "ai.summarize",
          name: "Summarize",
          position: { x: 320, y: 120 },
          inputs: [{ id: "in", label: "In", schema: "JSON" }],
          outputs: [{ id: "out", label: "Out", schema: "JSON" }],
          config: { input_path: "$.input", output_key: "summary" },
          ui: { icon: "sparkles", color: "neutral" },
        },
        {
          id: "n3",
          type: "output.export",
          name: "Export",
          position: { x: 560, y: 120 },
          inputs: [{ id: "in", label: "In", schema: "JSON" }],
          outputs: [{ id: "out", label: "Out", schema: "JSON" }],
          config: { format: "json", input_path: "$.summary", filename: "export.json" },
          ui: { icon: "download", color: "neutral" },
        },
      ],
      edges: [
        {
          id: "e1",
          source: { node_id: "n1", port_id: "out" },
          target: { node_id: "n2", port_id: "in" },
          label: null,
          condition: null,
        },
        {
          id: "e2",
          source: { node_id: "n2", port_id: "out" },
          target: { node_id: "n3", port_id: "in" },
          label: null,
          condition: null,
        },
      ],
    },
  };
}

function runSmokeTests() {
  const valid = validateWorkflowDoc(baseDoc());
  assert.equal(valid.ok, true, "Valid workflow must pass schema");

  const cyc = baseDoc();
  cyc.workflow.edges.push({
    id: "e3",
    source: { node_id: "n3", port_id: "out" },
    target: { node_id: "n2", port_id: "in" },
    label: null,
    condition: null,
  });
  const cycleResult = validateWorkflowDoc(cyc);
  assert.equal(cycleResult.ok, false, "Cyclic workflow must fail");
  if (!cycleResult.ok) {
    assert.ok(cycleResult.errors.some((e) => e.includes("Workflow graph must be a DAG")), "Cycle error not found");
  }

  const badExport = baseDoc();
  badExport.workflow.nodes[2].config = { format: "xml", input_path: "$.summary", filename: "export.xml" };
  const exportResult = validateWorkflowDoc(badExport);
  assert.equal(exportResult.ok, false, "Invalid export format must fail");

  const addClassify = applySemanticCommand(baseDoc(), "add classify at end");
  assert.equal(addClassify.ok, true, "Semantic add classify should succeed");
  if (addClassify.workflow) {
    assert.ok(addClassify.workflow.workflow.nodes.some((n) => n.type === "ai.classify"), "Classify node missing");
  }

  const cycleConnect = applySemanticCommand(baseDoc(), "connect n3 to n2");
  assert.equal(cycleConnect.ok, false, "Cycle-producing connect should be rejected");
  assert.equal(cycleConnect.message, "Edit rejected by workflow validator.");
}

runSmokeTests();
console.log("Smoke tests passed.");
