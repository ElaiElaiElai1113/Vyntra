import { create } from "zustand";
import type { WorkflowDoc, WorkflowNode } from "@shared/schema/workflow";

type WorkflowState = {
  current: WorkflowDoc | null;
  selectedNodeId: string | null;
  setWorkflow: (doc: WorkflowDoc | null) => void;
  setSelectedNodeId: (nodeId: string | null) => void;
  patchNode: (node: WorkflowNode) => void;
};

export const useWorkflowStore = create<WorkflowState>((set) => ({
  current: null,
  selectedNodeId: null,
  setWorkflow: (doc) => set({ current: doc, selectedNodeId: null }),
  setSelectedNodeId: (nodeId) => set({ selectedNodeId: nodeId }),
  patchNode: (node) =>
    set((state) => {
      if (!state.current) return state;
      return {
        ...state,
        current: {
          ...state.current,
          workflow: {
            ...state.current.workflow,
            nodes: state.current.workflow.nodes.map((n) => (n.id === node.id ? node : n)),
          },
        },
      };
    }),
}));
