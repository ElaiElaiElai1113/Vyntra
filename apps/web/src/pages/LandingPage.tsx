import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const TRY_PROMPTS = [
  "Summarize my inbound client emails and prepare a daily checklist.",
  "When I upload meeting notes, extract action items and export tasks.",
  "Classify incoming leads and flag high-priority follow-up.",
];

export function LandingPage() {
  const [prompt, setPrompt] = useState("");
  const [placeholderIdx, setPlaceholderIdx] = useState(0);
  const navigate = useNavigate();

  useEffect(() => {
    const timer = setInterval(() => {
      setPlaceholderIdx((idx) => (idx + 1) % TRY_PROMPTS.length);
    }, 2200);
    return () => clearInterval(timer);
  }, []);

  function startFromPrompt() {
    if (!prompt.trim()) return;
    localStorage.setItem("vyntra_draft_prompt", prompt.trim());
    navigate("/app/workflows/new");
  }

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-5xl px-6 py-20">
        <p className="text-sm uppercase tracking-[0.2em] text-cyan-300">From Idea to Automation</p>
        <h1 className="mt-4 text-5xl font-bold leading-tight text-slate-100">Vyntra — From Idea to Automation</h1>
        <p className="mt-6 max-w-2xl text-lg text-slate-300">
          Traditional automation tools help you build workflows. Vyntra generates them for you using AI.
        </p>
        <div className="mt-10 rounded-2xl border border-violet-400/35 bg-[#1A1F2B]/85 p-5 shadow-[0_0_45px_rgba(124,58,237,0.3)]">
          <p className="mb-3 text-xs uppercase tracking-[0.18em] text-slate-400">Describe your workflow in plain English</p>
          <div className="flex gap-3">
            <Input
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={`Try: "${TRY_PROMPTS[placeholderIdx]}"`}
              className="h-14 text-[15px]"
            />
            <Button className="h-14 px-6" onClick={startFromPrompt}>
              Generate
            </Button>
          </div>
        </div>
        <div className="mt-6 flex gap-3">
          <Button asChild variant="outline">
            <Link to="/auth">Sign In</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/app/templates">View Templates</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
