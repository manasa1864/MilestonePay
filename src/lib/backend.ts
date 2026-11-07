import { LocalBackend } from "./localBackend";
import { SupabaseBackend } from "./supabaseBackend";
import type { Backend } from "./types";

const url = (import.meta.env.VITE_SUPABASE_URL ?? "").trim();
const key = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? "").trim();

/** True once real Supabase values are in .env (the placeholders are ignored). */
export const supabaseConfigured =
  /^https?:\/\/[^\s]+$/.test(url) && !url.includes("your-project-ref") && key.length > 20 && !key.startsWith("your-");

export const backend: Backend = supabaseConfigured ? new SupabaseBackend(url, key) : new LocalBackend();
