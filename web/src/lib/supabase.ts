import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export const supabaseConfigured = Boolean(url && anonKey);

// Browser client. Session is kept in localStorage; every page that needs
// data is a client component, and Row Level Security in Postgres decides
// what each user is allowed to see.
export const supabase = createClient(url || "http://localhost:54321", anonKey || "missing-anon-key", {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

export const functionsUrl = `${url}/functions/v1`;

/** Turn a Supabase/Postgres error into a sentence a student can read. */
export function errorMessage(err: unknown): string {
  if (!err) return "Something went wrong";
  if (typeof err === "string") return err;
  const e = err as { message?: string };
  return e.message ?? "Something went wrong";
}
