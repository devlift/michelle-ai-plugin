/**
 * Edge Function: widget-config
 *
 * GET / — Return widget branding/configuration (public, no auth).
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { getServiceClient } from "../_shared/supabase.ts";

const PUBLIC_KEYS = [
  "chat_enabled",
  "widget_visible",
  "widget_title",
  "agent_name",
  "welcome_message",
  "primary_color",
  "secondary_color",
  "logo_url",
  "fab_icon",
  "audio_enabled",
  "form_title",
  "form_label_name",
  "form_label_address",
  "form_label_email",
  "form_label_message",
  "form_submit_label",
  "form_success_msg",
];

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
    const db = getServiceClient();
    const { data, error } = await db
      .from("agent_settings")
      .select("key, value")
      .in("key", PUBLIC_KEYS);

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const config: Record<string, unknown> = {};
    for (const row of data || []) {
      config[row.key] = row.value;
    }

    return new Response(JSON.stringify(config), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
      },
    });
  } catch (err) {
    console.error("widget-config error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
