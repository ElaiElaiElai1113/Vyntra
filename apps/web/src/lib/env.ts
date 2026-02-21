/// <reference types="vite/client" />

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

const missingEnv = !SUPABASE_URL || !SUPABASE_ANON_KEY;
if (missingEnv && import.meta.env.DEV) {
  console.warn("Missing Supabase env vars: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY");
}
if (missingEnv && !import.meta.env.DEV) {
  throw new Error("Missing required Supabase env vars: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY");
}
