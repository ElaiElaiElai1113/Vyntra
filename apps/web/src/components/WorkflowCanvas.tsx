import ReactFlow, { Background, Controls, type Edge, type Node } from "reactflow";
import type { WorkflowDoc } from "@shared/schema/workflow";

type Props = {
  doc: WorkflowDoc;
  onSelectNode: (nodeId: string | null) => void;
};

function toFlowNodes(doc: WorkflowDoc): Node[] {
  return doc.workflow.nodes.map((n) => ({
    id: n.id,
    position: n.position,
    data: { label: `${n.name} (${n.type})` },
    type: "default",
  }));
}

function toFlowEdges(doc: WorkflowDoc): Edge[] {
  return doc.workflow.edges.map((e) => ({
    id: e.id,
    source: e.source.node_id,
    target: e.target.node_id,
    label: e.label ?? undefined,
    animated: e.source.node_id === doc.workflow.entry_node_id,
  }));
}

export function WorkflowCanvas({ doc, onSelectNode }: Props) {
  const nodes = toFlowNodes(doc);
  const edges = toFlowEdges(doc);

  return (
    <div className="h-[600px] rounded-lg border bg-white">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView
        onNodeClick={(_, node) => onSelectNode(node.id)}
        onPaneClick={() => onSelectNode(null)}
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}
