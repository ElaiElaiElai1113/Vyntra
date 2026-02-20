export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  // Keep app booting so landing/auth still render.
  console.warn("Missing Supabase env vars: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY");
}
