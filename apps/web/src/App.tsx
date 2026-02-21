import { Suspense, lazy, useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

const AppShell = lazy(() => import("@/components/AppShell").then((m) => ({ default: m.AppShell })));
const LandingPage = lazy(() => import("@/pages/LandingPage").then((m) => ({ default: m.LandingPage })));
const AuthPage = lazy(() => import("@/pages/AuthPage").then((m) => ({ default: m.AuthPage })));
const DashboardPage = lazy(() => import("@/pages/DashboardPage").then((m) => ({ default: m.DashboardPage })));
const WorkflowNewPage = lazy(() => import("@/pages/WorkflowNewPage").then((m) => ({ default: m.WorkflowNewPage })));
const WorkflowDetailPage = lazy(() => import("@/pages/WorkflowDetailPage").then((m) => ({ default: m.WorkflowDetailPage })));
const TemplatesPage = lazy(() => import("@/pages/TemplatesPage").then((m) => ({ default: m.TemplatesPage })));
const RunsPage = lazy(() => import("@/pages/RunsPage").then((m) => ({ default: m.RunsPage })));

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
    <Suspense fallback={<div className="p-8 text-sm text-slate-600">Loading...</div>}>
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
    </Suspense>
  );
}
