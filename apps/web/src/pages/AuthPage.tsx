import { useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { Navigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { supabase } from "@/lib/supabase";

type Props = { session: Session | null };

export function AuthPage({ session }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  if (session) return <Navigate to="/app" replace />;

  async function signup() {
    const { error } = await supabase.auth.signUp({ email, password });
    setMessage(error?.message ?? "Account created. Check your email if confirmation is enabled.");
  }

  async function signin() {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setMessage(error?.message ?? "Signed in.");
  }

  return (
    <div className="mx-auto max-w-md px-6 py-16">
      <Card className="space-y-4">
        <h1 className="text-xl font-semibold">Sign in to Vyntra</h1>
        <Input placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <Input placeholder="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <div className="flex gap-2">
          <Button onClick={signin}>Sign In</Button>
          <Button onClick={signup} variant="outline">Sign Up</Button>
        </div>
        {message && <p className="text-sm text-slate-600">{message}</p>}
      </Card>
    </div>
  );
}
