import { useMemo } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useWorkflowStore } from "@/stores/workflowStore";

export function NodeInspector() {
  const { current, selectedNodeId, patchNode } = useWorkflowStore();

  const node = useMemo(() => current?.workflow.nodes.find((n) => n.id === selectedNodeId), [current, selectedNodeId]);

  if (!node) {
    return <Card className="h-full text-sm text-slate-500">Select a node to edit its config.</Card>;
  }

  return (
    <Card className="h-full space-y-3">
      <div>
        <div className="text-xs uppercase text-slate-500">Node</div>
        <h3 className="font-semibold">{node.name}</h3>
        <p className="text-xs text-slate-500">{node.type}</p>
      </div>
      <div>
        <label className="mb-1 block text-xs uppercase text-slate-500">Config (JSON)</label>
        <Textarea
          rows={16}
          defaultValue={JSON.stringify(node.config, null, 2)}
          onBlur={(e) => {
            try {
              const config = JSON.parse(e.target.value);
              patchNode({ ...node, config });
            } catch {
              // Leave current config unchanged when JSON is invalid.
            }
          }}
        />
      </div>
      <Button
        variant="outline"
        onClick={() => patchNode({ ...node, name: `${node.name} (edited)` })}
      >
        Quick Rename
      </Button>
    </Card>
  );
}
