/**
 * Edge Function: settings
 *
 * GET  / — Get all settings (admin only, masks API keys)
 * POST / — Save settings (admin only)
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { getServiceClient } from "../_shared/supabase.ts";
import { requireAdmin } from "../_shared/auth.ts";

const MASKED = "••••••••";
const SECRET_KEYS = ["openai_api_key", "elevenlabs_api_key"];

Deno.serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    if (req.method === "GET") {
      return await getSettings(req);
    }
    if (req.method === "POST") {
      return await saveSettings(req);
    }

    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("settings error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function getSettings(req: Request): Promise<Response> {
  const auth = await requireAdmin(req);
  if (auth instanceof Response) return auth;

  const db = getServiceClient();
  const { data, error } = await db
    .from("agent_settings")
    .select("key, value");

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const settings: Record<string, unknown> = {};
  for (const row of data || []) {
    settings[row.key] = row.value;
  }

  // Check if API keys are set (from private.encryption_keys)
  const { data: openaiKey } = await db.rpc("get_secret", {
    secret_name: "openai_api_key",
  });
  const { data: elevenKey } = await db.rpc("get_secret", {
    secret_name: "elevenlabs_api_key",
  });

  settings.openai_api_key = openaiKey ? MASKED : "";
  settings.audio_api_key = elevenKey ? MASKED : "";

  return new Response(JSON.stringify(settings), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function saveSettings(req: Request): Promise<Response> {
  const auth = await requireAdmin(req);
  if (auth instanceof Response) return auth;

  const body = await req.json().catch(() => ({}));
  const db = getServiceClient();

  for (const [key, value] of Object.entries(body)) {
    // Handle API keys — store in private.encryption_keys, not in settings
    if (key === "openai_api_key") {
      if (typeof value === "string" && value !== MASKED && value.trim()) {
        await db.rpc("set_secret_key", null); // won't exist yet, use raw SQL
        // Use raw SQL to update the private table
        const { error } = await db.from("agent_settings").select("key").limit(0); // dummy to ensure connection
        // Actually we need to use the postgres connection directly
        // For now, use an RPC function
        await setSecret("openai_api_key", value as string);
      }
      continue;
    }

    if (key === "audio_api_key") {
      if (typeof value === "string" && value !== MASKED && value.trim()) {
        await setSecret("elevenlabs_api_key", value as string);
      }
      continue;
    }

    // Regular settings — upsert into agent_settings
    await db.from("agent_settings").upsert(
      {
        key,
        value: value as Record<string, unknown>,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" }
    );
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Store a secret in private.encryption_keys via RPC.
 */
async function setSecret(name: string, value: string): Promise<void> {
  const db = getServiceClient();
  // Use a direct SQL call via rpc since we can't access private schema via PostgREST
  await db.rpc("set_secret", { secret_name: name, secret_value: value });
}
