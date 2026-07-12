import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

export const SUPABASE_URL = "INSIRA_SUPABASE_URL_AQUI";
export const SUPABASE_PUBLISHABLE_KEY = "INSIRA_SUPABASE_PUBLISHABLE_KEY_AQUI";

const configuredUrl = window.SOO_SUPABASE_URL || SUPABASE_URL;
const configuredKey = window.SOO_SUPABASE_PUBLISHABLE_KEY || SUPABASE_PUBLISHABLE_KEY;

export const isSupabaseConfigured =
  configuredUrl &&
  configuredKey &&
  !configuredUrl.includes("INSIRA_") &&
  !configuredKey.includes("INSIRA_");

export const supabase = isSupabaseConfigured
  ? createClient(configuredUrl, configuredKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    })
  : null;

export function requireSupabase() {
  if (!supabase) {
    throw new Error(
      "Configure SUPABASE_URL e SUPABASE_PUBLISHABLE_KEY em js/supabase-client.js antes de usar o SOO."
    );
  }
  return supabase;
}
