import { memo, useEffect, useMemo, useState } from "react";
import ReactFlow, {
  Background,
  Controls,
  Handle,
  Position,
  applyNodeChanges,
  type NodeChange,
  type Edge,
  type Node,
  type NodeProps,
  type NodeTypes,
} from "reactflow";
import type { WorkflowDoc } from "@shared/schema/workflow";

type Props = {
  doc: WorkflowDoc;
  onSelectNode: (nodeId: string | null) => void;
  onMoveNode?: (nodeId: string, position: { x: number; y: number }) => void;
};

type CanvasNodeData = {
  id: string;
  name: string;
  type: string;
  inputs: Array<{ id: string; label: string; schema: string }>;
  outputs: Array<{ id: string; label: string; schema: string }>;
};

function toneForNodeType(type: string) {
  if (type.startsWith("trigger.")) return "trigger";
  if (type.startsWith("ai.")) return "ai";
  if (type.startsWith("logic.")) return "logic";
  return "output";
}

function WorkflowNodeCard({ data, selected }: NodeProps<CanvasNodeData>) {
  const tone = toneForNodeType(data.type);
  const toneClass =
    tone === "ai"
      ? "border-amber-300/45 shadow-[0_0_0_1px_rgba(251,191,36,0.24)]"
      : "border-cyan-300/45 shadow-[0_0_0_1px_rgba(34,211,238,0.3)]";

  return (
    <div
      className={`group relative min-w-[206px] rounded-xl border bg-[#141B2B]/95 px-4 py-3 text-slate-100 ${toneClass} ${
        selected ? "ring-2 ring-violet-400/70" : ""
      }`}
    >
      <div className="absolute -top-[5px] left-1/2 h-2 w-2 -translate-x-1/2 rounded-full border border-white/70 bg-[#0B0E14]" />
      <div className="absolute -bottom-[5px] left-1/2 h-2 w-2 -translate-x-1/2 rounded-full border border-white/70 bg-[#0B0E14]" />

      {data.inputs.map((port, idx) => (
        <Handle
          key={`in-${port.id}`}
          type="target"
          id={port.id}
          position={Position.Left}
          style={{
            top: `${((idx + 1) * 100) / (data.inputs.length + 1)}%`,
            width: 8,
            height: 8,
            border: "1px solid rgba(255,255,255,0.85)",
            background: "#0B0E14",
          }}
        />
      ))}

      {data.outputs.map((port, idx) => (
        <Handle
          key={`out-${port.id}`}
          type="source"
          id={port.id}
          position={Position.Right}
          style={{
            top: `${((idx + 1) * 100) / (data.outputs.length + 1)}%`,
            width: 8,
            height: 8,
            border: "1px solid rgba(255,255,255,0.85)",
            background: "#0B0E14",
          }}
        />
      ))}

      <div className="text-[10px] uppercase tracking-[0.13em] text-slate-400">{data.id}</div>
      <div className="mt-0.5 text-[15px] font-semibold leading-tight">{data.name}</div>
      <div className="mt-1 text-[11px] text-slate-300">({data.type})</div>
    </div>
  );
}

const nodeTypes: NodeTypes = {
  workflowNode: memo(WorkflowNodeCard),
};

function toFlowNodes(doc: WorkflowDoc): Node[] {
  return doc.workflow.nodes.map((n) => ({
    id: n.id,
    position: n.position,
    data: {
      id: n.id,
      name: n.name,
      type: n.type,
      inputs: n.inputs,
      outputs: n.outputs,
    },
    type: "workflowNode",
  }));
}

function toFlowEdges(doc: WorkflowDoc): Edge[] {
  return doc.workflow.edges.map((e) => ({
    id: e.id,
    source: e.source.node_id,
    target: e.target.node_id,
    sourceHandle: e.source.port_id,
    targetHandle: e.target.port_id,
    label: e.label ?? undefined,
    type: "smoothstep",
    animated: e.source.node_id === doc.workflow.entry_node_id,
    style: {
      stroke: "rgba(241,245,249,0.8)",
      strokeWidth: 1.5,
      strokeDasharray: e.condition ? "4 4" : undefined,
    },
    labelStyle: {
      fill: "#E5E7EB",
      fontSize: 11,
      fontWeight: 500,
    },
    labelBgStyle: {
      fill: "rgba(15,23,42,0.92)",
      stroke: "rgba(226,232,240,0.5)",
      strokeWidth: 1,
      rx: 4,
      ry: 4,
    },
    labelShowBg: Boolean(e.label || e.condition),
  }));
}

export function WorkflowCanvas({ doc, onSelectNode, onMoveNode }: Props) {
  const nodes = useMemo(() => toFlowNodes(doc), [doc]);
  const edges = useMemo(() => toFlowEdges(doc), [doc]);
  const [localNodes, setLocalNodes] = useState<Node[]>(nodes);
  const [localEdges, setLocalEdges] = useState<Edge[]>(edges);

  useEffect(() => {
    setLocalNodes(nodes);
  }, [nodes]);

  useEffect(() => {
    setLocalEdges(edges);
  }, [edges]);

  const onNodesChange = (changes: NodeChange[]) => {
    setLocalNodes((prev) => applyNodeChanges(changes, prev));
  };

  const handleNodeDragStop = (_evt: unknown, node: Node) => {
    onMoveNode?.(node.id, { x: node.position.x, y: node.position.y });
  };

  return (
    <div className="relative h-[600px] rounded-lg border border-white/15 bg-[#111623]">
      <ReactFlow
        nodes={localNodes}
        edges={localEdges}
        nodeTypes={nodeTypes}
        fitView
        onlyRenderVisibleElements
        snapToGrid
        snapGrid={[20, 20]}
        minZoom={0.4}
        maxZoom={1.6}
        panOnScroll
        selectionOnDrag
        onNodesChange={onNodesChange}
        onNodeClick={(_, node) => onSelectNode(node.id)}
        onNodeDragStop={handleNodeDragStop}
        onPaneClick={() => onSelectNode(null)}
      >
        <Background color="rgba(249,250,251,0.12)" gap={24} />
        <Controls />
      </ReactFlow>
      <div className="pointer-events-none absolute m-3 rounded bg-black/35 px-2 py-1 text-[11px] text-slate-300">
        Glow Legend: <span className="text-cyan-300">Cyan = high confidence</span>, <span className="text-amber-300">Amber = verify AI guess</span>
      </div>
    </div>
  );
}
