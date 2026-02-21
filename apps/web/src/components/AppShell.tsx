import { useEffect, useMemo, useState } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";

export function AppShell() {
  const navigate = useNavigate();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [runCount, setRunCount] = useState(0);

  useEffect(() => {
    supabase.from("runs").select("id", { count: "exact", head: true }).then(({ count }) => {
      setRunCount(count ?? 0);
    });
  }, []);

  useEffect(() => {
    function onKeydown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
      if (e.key === "Escape") setPaletteOpen(false);
    }
    window.addEventListener("keydown", onKeydown);
    return () => window.removeEventListener("keydown", onKeydown);
  }, []);

  async function onSignOut() {
    await supabase.auth.signOut();
    navigate("/auth", { replace: true });
  }

  const estimatedHours = useMemo(() => (runCount * 0.35).toFixed(1), [runCount]);

  function runCommand(path: string) {
    setPaletteOpen(false);
    navigate(path);
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-white/10 bg-[#0B0E14]/70 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-5">
            <Link to="/app" className="text-lg font-semibold text-slate-100">Vyntra</Link>
            <div className="hidden rounded-md border border-cyan-300/30 bg-cyan-300/10 px-3 py-1 text-xs text-cyan-200 md:block">
              Flow Streak: {runCount} successful runs
            </div>
            <div className="hidden rounded-md border border-violet-300/30 bg-violet-300/10 px-3 py-1 text-xs text-violet-100 md:block">
              Estimated {estimatedHours} hours saved
            </div>
          </div>
          <nav className="flex items-center gap-4 text-sm">
            <NavLink to="/app" end className="text-slate-300 hover:text-white">Dashboard</NavLink>
            <NavLink to="/app/templates" className="text-slate-300 hover:text-white">Templates</NavLink>
            <NavLink to="/app/runs" className="text-slate-300 hover:text-white">Runs</NavLink>
            <NavLink to="/app/system" className="text-slate-300 hover:text-white">System</NavLink>
            <NavLink to="/app/workflows/new" className="text-slate-300 hover:text-white">New Workflow</NavLink>
            <Button variant="ghost" onClick={() => setPaletteOpen(true)} className="text-xs text-slate-300">Cmd+K</Button>
            <Button variant="outline" onClick={onSignOut}>Sign out</Button>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-6 py-6">
        <Outlet />
      </main>
      {paletteOpen && (
        <div className="fixed inset-0 z-50 grid place-items-start bg-black/50 p-6 pt-24" onClick={() => setPaletteOpen(false)}>
          <div className="glass-panel w-full max-w-xl rounded-xl p-3" onClick={(e) => e.stopPropagation()}>
            <p className="mb-2 text-xs uppercase tracking-[0.15em] text-slate-400">Command Palette</p>
            <div className="space-y-2">
              <button className="w-full rounded bg-white/5 p-3 text-left text-sm hover:bg-white/10" onClick={() => runCommand("/app/workflows/new")}>Create new workflow</button>
              <button className="w-full rounded bg-white/5 p-3 text-left text-sm hover:bg-white/10" onClick={() => runCommand("/app/templates")}>Browse templates</button>
              <button className="w-full rounded bg-white/5 p-3 text-left text-sm hover:bg-white/10" onClick={() => runCommand("/app/runs")}>Open run history</button>
              <button className="w-full rounded bg-white/5 p-3 text-left text-sm hover:bg-white/10" onClick={() => runCommand("/app/system")}>Open system health</button>
              <button className="w-full rounded bg-white/5 p-3 text-left text-sm hover:bg-white/10" onClick={() => runCommand("/app")}>Go to dashboard</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
