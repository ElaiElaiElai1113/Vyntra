import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useWorkflowStore } from "@/stores/workflowStore";
import { applySemanticCommand } from "@/lib/semanticEdit";

type Message = {
  role: "user" | "assistant";
  text: string;
};

const SUGGESTIONS = [
  "add classify at end",
  "add delay 30 seconds",
  "rename n2 to Score Lead",
  "connect n2 to n4",
  "delete n5",
];

export function SemanticEditorRail() {
  const [command, setCommand] = useState("");
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      text: "Ask me to edit this workflow. Example: 'add classify at end'",
    },
  ]);

  const { current, setWorkflow } = useWorkflowStore();
  const canRun = useMemo(() => Boolean(current), [current]);

  function append(role: Message["role"], text: string) {
    setMessages((prev) => [...prev, { role, text }]);
  }

  function runCommand(input: string) {
    const raw = input.trim();
    if (!raw || !current) return;

    append("user", raw);
    const result = applySemanticCommand(current, raw);
    if (result.ok && result.workflow) {
      setWorkflow(result.workflow);
      append("assistant", result.message);
    } else {
      append("assistant", result.errors?.length ? `${result.message}\n${result.errors.join("\n")}` : result.message);
    }
    setCommand("");
  }

  return (
    <Card className="glass-panel h-full space-y-3">
      <div>
        <p className="text-xs uppercase tracking-[0.14em] text-slate-400">Semantic Chat-to-Edit</p>
        <h3 className="font-semibold text-slate-100">Edit with natural language</h3>
      </div>
      <div className="max-h-60 space-y-2 overflow-auto rounded border border-white/10 bg-black/20 p-2">
        {messages.map((m, idx) => (
          <div key={idx} className={m.role === "user" ? "text-right" : "text-left"}>
            <div
              className={
                m.role === "user"
                  ? "inline-block rounded bg-violet-500/20 px-2 py-1 text-xs text-violet-100"
                  : "inline-block whitespace-pre-wrap rounded bg-white/10 px-2 py-1 text-xs text-slate-200"
              }
            >
              {m.text}
            </div>
          </div>
        ))}
      </div>
      <div className="space-y-2">
        <div className="flex gap-2">
          <Input
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            disabled={!canRun}
            placeholder="e.g., add export at end"
            onKeyDown={(e) => {
              if (e.key === "Enter") runCommand(command);
            }}
          />
          <Button onClick={() => runCommand(command)} disabled={!canRun}>Apply</Button>
        </div>
        <div className="flex flex-wrap gap-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              className="rounded border border-white/20 bg-white/5 px-2 py-1 text-[11px] text-slate-300 hover:bg-white/10"
              onClick={() => runCommand(s)}
              disabled={!canRun}
            >
              {s}
            </button>
          ))}
        </div>
      </div>
    </Card>
  );
}
