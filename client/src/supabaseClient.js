import { createClient } from "@supabase/supabase-js";

const SUPABASE_ENABLED = String(import.meta.env.VITE_SUPABASE_ENABLED || "").toLowerCase() === "true";
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "";

let supabase = null;

if (SUPABASE_ENABLED && SUPABASE_URL && SUPABASE_ANON_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
    },
  });
}

export function isSupabaseEnabled() {
  return Boolean(supabase);
}

export function getSupabaseClient() {
  return supabase;
}

export async function getSession() {
  if (!supabase) return { data: { session: null }, error: null };
  return supabase.auth.getSession();
}

export async function getAccessToken() {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data?.session?.access_token ?? null;
}

export function onAuthStateChange(callback) {
  if (!supabase) {
    return { data: { subscription: { unsubscribe() {} } } };
  }
  return supabase.auth.onAuthStateChange(callback);
}

export async function signInWithGoogle() {
  if (!supabase) return { data: null, error: new Error("Supabase auth is not enabled.") };
  return supabase.auth.signInWithOAuth({ provider: "google" });
}

export async function signOut() {
  if (!supabase) return { error: null };
  return supabase.auth.signOut();
}
