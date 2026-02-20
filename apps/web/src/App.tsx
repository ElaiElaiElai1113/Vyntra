import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { AppShell } from "@/components/AppShell";
import { LandingPage } from "@/pages/LandingPage";
import { AuthPage } from "@/pages/AuthPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { WorkflowNewPage } from "@/pages/WorkflowNewPage";
import { WorkflowDetailPage } from "@/pages/WorkflowDetailPage";
import { TemplatesPage } from "@/pages/TemplatesPage";
import { RunsPage } from "@/pages/RunsPage";

function Protected({ session, children }: { session: Session | null; children: JSX.Element }) {
  if (!session) return <Navigate to="/auth" replace />;
  return children;
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, sessionValue) => {
      setSession(sessionValue);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  if (loading) return <div className="p-8 text-sm text-slate-600">Loading...</div>;

  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/auth" element={<AuthPage session={session} />} />

      <Route
        path="/app"
        element={
          <Protected session={session}>
            <AppShell />
          </Protected>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="workflows/new" element={<WorkflowNewPage />} />
        <Route path="workflows/:id" element={<WorkflowDetailPage />} />
        <Route path="templates" element={<TemplatesPage />} />
        <Route path="runs" element={<RunsPage />} />
      </Route>
    </Routes>
  );
}
