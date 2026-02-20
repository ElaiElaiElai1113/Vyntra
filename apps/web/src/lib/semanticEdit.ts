import type { WorkflowDoc, WorkflowNode, WorkflowEdge } from "@shared/schema/workflow";
import { validateWorkflowDoc } from "@/lib/workflow";

type EditResult = {
  ok: boolean;
  message: string;
  workflow?: WorkflowDoc;
  errors?: string[];
};

const nodeTypeAliases: Array<{ match: RegExp; type: WorkflowNode["type"] }> = [
  { match: /summarize|summary/i, type: "ai.summarize" },
  { match: /classify|classification|tag/i, type: "ai.classify" },
  { match: /extract|parse fields/i, type: "ai.extract_fields" },
  { match: /report|checklist|sop/i, type: "ai.generate_report" },
  { match: /condition|branch|if/i, type: "logic.condition" },
  { match: /delay|wait|pause/i, type: "logic.delay" },
  { match: /db save|database|save to db|save/i, type: "output.db_save" },
  { match: /export|csv|json|notify|slack/i, type: "output.export" },
];

function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

function nextNodeId(doc: WorkflowDoc): string {
  const nums = doc.workflow.nodes
    .map((n) => Number(n.id.replace(/^n/, "")))
    .filter((n) => Number.isFinite(n));
  const max = nums.length ? Math.max(...nums) : 0;
  return `n${max + 1}`;
}

function nextEdgeId(doc: WorkflowDoc): string {
  const nums = doc.workflow.edges
    .map((e) => Number(e.id.replace(/^e/, "")))
    .filter((n) => Number.isFinite(n));
  const max = nums.length ? Math.max(...nums) : 0;
  return `e${max + 1}`;
}

function createNode(type: WorkflowNode["type"], id: string, position: { x: number; y: number }): WorkflowNode {
  const base: WorkflowNode = {
    id,
    type,
    name: type,
    position,
    inputs: [{ id: "in", label: "In", schema: "JSON" }],
    outputs: [{ id: "out", label: "Out", schema: "JSON" }],
    config: {},
    ui: { icon: "sparkles", color: "neutral" },
  };

  switch (type) {
    case "ai.summarize":
      return { ...base, name: "Summarize", config: { input_path: "$.input", style: "concise", bullets: true, output_key: "summary", instructions: "Summarize the input." } };
    case "ai.classify":
      return { ...base, name: "Classify", config: { input_path: "$.input", labels: ["high", "medium", "low"], output_key: "label", confidence_key: "confidence", instructions: "Classify the input." } };
    case "ai.extract_fields":
      return { ...base, name: "Extract Fields", config: { input_path: "$.input", fields: [{ key: "field_1", type: "string", required: false }], output_key: "extracted", instructions: "Extract structured fields." } };
    case "ai.generate_report":
      return { ...base, name: "Generate Report", config: { template: "Checklist", input_path: "$.input", format: "markdown", output_key: "report", instructions: "Generate a concise checklist." } };
    case "logic.condition":
      return {
        ...base,
        name: "Condition",
        outputs: [
          { id: "true", label: "True", schema: "JSON" },
          { id: "false", label: "False", schema: "JSON" },
        ],
        config: { expression: "$.score > 0.8", default_output: "false" },
      };
    case "logic.delay":
      return { ...base, name: "Delay", config: { seconds: 30, reason: "Rate limiting" } };
    case "output.db_save":
      return { ...base, name: "Save to DB", config: { table: "va_items", mode: "insert", mapping: { payload: "$.input" } } };
    case "output.export":
      return { ...base, name: "Export", config: { format: "json", input_path: "$.input", filename: "export.json" } };
    case "trigger.manual":
      return { ...base, name: "Manual Trigger", inputs: [], config: { sample_input: {} } };
    case "trigger.webhook":
      return { ...base, name: "Webhook Trigger", inputs: [], config: { path: "/inbound", method: "POST", secret_required: true, sample_payload: {} } };
    case "trigger.schedule":
      return { ...base, name: "Schedule Trigger", inputs: [], config: { timezone: "UTC", cron: "0 9 * * *", payload: {} } };
    case "trigger.file_upload":
      return { ...base, name: "File Upload Trigger", inputs: [], config: { accepted_types: ["application/pdf", "text/plain"], max_size_mb: 10, purpose: "automation-input" } };
    default:
      return { ...base, name: "Node", config: {} };
  }
}

function findTypeFromCommand(command: string): WorkflowNode["type"] | null {
  for (const alias of nodeTypeAliases) {
    if (alias.match.test(command)) return alias.type;
  }
  return null;
}

function terminalNodes(doc: WorkflowDoc): WorkflowNode[] {
  const outgoing = new Set(doc.workflow.edges.map((e) => e.source.node_id));
  return doc.workflow.nodes.filter((n) => !outgoing.has(n.id));
}

function addNodeAtEnd(doc: WorkflowDoc, type: WorkflowNode["type"]): WorkflowDoc {
  const copy = deepClone(doc);
  const source = terminalNodes(copy)[0] ?? copy.workflow.nodes[copy.workflow.nodes.length - 1];
  const id = nextNodeId(copy);
  const position = { x: source.position.x + 240, y: source.position.y };
  const newNode = createNode(type, id, position);
  copy.workflow.nodes.push(newNode);

  if (source && source.outputs[0] && newNode.inputs[0]) {
    copy.workflow.edges.push({
      id: nextEdgeId(copy),
      source: { node_id: source.id, port_id: source.outputs[0].id },
      target: { node_id: newNode.id, port_id: newNode.inputs[0].id },
      label: null,
      condition: null,
    } as WorkflowEdge);
  }

  return copy;
}

function renameNode(doc: WorkflowDoc, nodeRef: string, nextName: string): WorkflowDoc | null {
  const copy = deepClone(doc);
  const target = copy.workflow.nodes.find((n) => n.id.toLowerCase() === nodeRef.toLowerCase() || n.name.toLowerCase() === nodeRef.toLowerCase());
  if (!target) return null;
  target.name = nextName;
  return copy;
}

function deleteNode(doc: WorkflowDoc, nodeRef: string): WorkflowDoc | null {
  const copy = deepClone(doc);
  const target = copy.workflow.nodes.find((n) => n.id.toLowerCase() === nodeRef.toLowerCase() || n.name.toLowerCase() === nodeRef.toLowerCase());
  if (!target) return null;
  if (target.id === copy.workflow.entry_node_id) return null;

  copy.workflow.nodes = copy.workflow.nodes.filter((n) => n.id !== target.id);
  copy.workflow.edges = copy.workflow.edges.filter((e) => e.source.node_id !== target.id && e.target.node_id !== target.id);
  return copy;
}

function connectNodes(doc: WorkflowDoc, sourceRef: string, targetRef: string): WorkflowDoc | null {
  const copy = deepClone(doc);
  const source = copy.workflow.nodes.find((n) => n.id.toLowerCase() === sourceRef.toLowerCase() || n.name.toLowerCase() === sourceRef.toLowerCase());
  const target = copy.workflow.nodes.find((n) => n.id.toLowerCase() === targetRef.toLowerCase() || n.name.toLowerCase() === targetRef.toLowerCase());
  if (!source || !target || !source.outputs[0] || !target.inputs[0]) return null;

  copy.workflow.edges.push({
    id: nextEdgeId(copy),
    source: { node_id: source.id, port_id: source.outputs[0].id },
    target: { node_id: target.id, port_id: target.inputs[0].id },
    label: null,
    condition: null,
  } as WorkflowEdge);
  return copy;
}

export function applySemanticCommand(doc: WorkflowDoc, command: string): EditResult {
  const raw = command.trim();
  const lowered = raw.toLowerCase();
  if (!raw) return { ok: false, message: "Type a command first." };

  let candidate: WorkflowDoc | null = null;
  let message = "Command applied.";

  const renameMatch = raw.match(/^rename\s+(.+?)\s+to\s+(.+)$/i);
  const deleteMatch = raw.match(/^delete\s+(.+)$/i);
  const connectMatch = raw.match(/^connect\s+(.+?)\s+to\s+(.+)$/i);
  const delayMatch = raw.match(/^add\s+delay\s+(\d+)\s*seconds?$/i);

  if (renameMatch) {
    candidate = renameNode(doc, renameMatch[1].trim(), renameMatch[2].trim());
    message = candidate ? `Renamed ${renameMatch[1].trim()} to ${renameMatch[2].trim()}.` : "Node to rename not found.";
  } else if (deleteMatch) {
    candidate = deleteNode(doc, deleteMatch[1].trim());
    message = candidate ? `Deleted ${deleteMatch[1].trim()}.` : "Node could not be deleted (not found or is trigger).";
  } else if (connectMatch) {
    candidate = connectNodes(doc, connectMatch[1].trim(), connectMatch[2].trim());
    message = candidate ? `Connected ${connectMatch[1].trim()} to ${connectMatch[2].trim()}.` : "Could not connect nodes.";
  } else if (delayMatch) {
    candidate = addNodeAtEnd(doc, "logic.delay");
    const added = candidate.workflow.nodes[candidate.workflow.nodes.length - 1];
    (added.config as Record<string, unknown>).seconds = Number(delayMatch[1]);
    message = `Added delay node (${delayMatch[1]}s) at end.`;
  } else if (lowered.startsWith("add ")) {
    const type = findTypeFromCommand(raw);
    if (!type) return { ok: false, message: "I couldn't map that request to a supported node type yet." };
    candidate = addNodeAtEnd(doc, type);
    message = `Added ${type} at the end of the flow.`;
  } else {
    return {
      ok: false,
      message: "Try commands like: 'add classify at end', 'add delay 30 seconds', 'rename n2 to Score Lead', 'connect n2 to n4'.",
    };
  }

  if (!candidate) return { ok: false, message };

  const check = validateWorkflowDoc(candidate);
  if (!check.ok) {
    return { ok: false, message: "Edit rejected by workflow validator.", errors: check.errors };
  }

  return { ok: true, message, workflow: check.data };
}
