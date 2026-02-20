import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

export function LandingPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white">
      <div className="mx-auto max-w-5xl px-6 py-24">
        <p className="text-sm uppercase tracking-[0.2em] text-blue-700">From Idea to Automation</p>
        <h1 className="mt-4 text-5xl font-bold leading-tight text-slate-900">Vyntra — From Idea to Automation</h1>
        <p className="mt-6 max-w-2xl text-lg text-slate-700">
          Traditional automation tools help you build workflows. Vyntra generates them for you using AI.
        </p>
        <div className="mt-8 flex gap-3">
          <Button asChild>
            <Link to="/auth">Generate My First Workflow</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/app/templates">View Templates</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
