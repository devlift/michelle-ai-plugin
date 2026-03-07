/**
 * Edge Function: audio-signed-url
 *
 * GET / — Get ElevenLabs signed URL or agent ID (public, rate-limited).
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { getServiceClient } from "../_shared/supabase.ts";

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

Deno.serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    // Rate limit: 10 per minute per IP
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const now = Date.now();
    const entry = rateLimitMap.get(ip);

    if (entry && entry.resetAt > now && entry.count >= 10) {
      return new Response(
        JSON.stringify({ error: "Rate limit exceeded" }),
        {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!entry || entry.resetAt <= now) {
      rateLimitMap.set(ip, { count: 1, resetAt: now + 60000 });
    } else {
      entry.count++;
    }

    const db = getServiceClient();

    // Get audio settings
    const { data: settings } = await db
      .from("agent_settings")
      .select("key, value")
      .in("key", ["audio_enabled", "audio_agent_id"]);

    const settingsMap: Record<string, unknown> = {};
    for (const s of settings || []) {
      settingsMap[s.key] = s.value;
    }

    if (!settingsMap.audio_enabled) {
      return new Response(
        JSON.stringify({ error: "Audio is not enabled" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Try to get API key from secrets
    const { data: apiKey } = await db.rpc("get_secret", {
      secret_name: "elevenlabs_api_key",
    });

    const agentId = settingsMap.audio_agent_id as string;

    if (apiKey && typeof apiKey === "string" && apiKey.trim()) {
      // Generate signed URL
      const response = await fetch(
        `https://api.elevenlabs.io/v1/convai/conversation/get_signed_url?agent_id=${agentId}`,
        {
          headers: { "xi-api-key": apiKey },
        }
      );

      if (response.ok) {
        const data = await response.json();
        return new Response(
          JSON.stringify({ signed_url: data.signed_url }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
    }

    // Fallback: return agent ID for public widget
    if (agentId) {
      return new Response(JSON.stringify({ agent_id: agentId }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({ error: "Audio not configured" }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("audio-signed-url error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
