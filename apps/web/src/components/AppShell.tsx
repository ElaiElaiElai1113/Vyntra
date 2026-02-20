import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";

export function AppShell() {
  const navigate = useNavigate();

  async function onSignOut() {
    await supabase.auth.signOut();
    navigate("/auth", { replace: true });
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
          <Link to="/app" className="text-lg font-semibold">Vyntra</Link>
          <nav className="flex items-center gap-4 text-sm">
            <NavLink to="/app" end>Dashboard</NavLink>
            <NavLink to="/app/templates">Templates</NavLink>
            <NavLink to="/app/runs">Runs</NavLink>
            <NavLink to="/app/workflows/new">New Workflow</NavLink>
            <Button variant="outline" onClick={onSignOut}>Sign out</Button>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-6 py-6">
        <Outlet />
      </main>
    </div>
  );
}
