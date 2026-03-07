/**
 * Edge Function: suggest
 *
 * POST / — Generate AI suggested reply for admin (admin only).
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { getServiceClient } from "../_shared/supabase.ts";
import { requireAdmin } from "../_shared/auth.ts";
import { getAIConfig, generateResponse } from "../_shared/openai.ts";

Deno.serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const auth = await requireAdmin(req);
    if (auth instanceof Response) return auth;

    const body = await req.json().catch(() => ({}));
    const conversationId = body.conversation_id;

    if (!conversationId) {
      return new Response(
        JSON.stringify({ error: "Missing conversation_id" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const db = getServiceClient();
    const config = await getAIConfig();

    // Get conversation messages
    const { data: messages } = await db
      .from("messages")
      .select("sender_type, content")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .limit(config.contextMessages);

    if (!messages || messages.length === 0) {
      return new Response(
        JSON.stringify({ suggestion: "" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const chatMessages = [
      {
        role: "system" as const,
        content: `${config.systemPrompt}\n\nYou are drafting a suggested reply for a human admin to send to the visitor. Write a helpful, professional response that the admin can edit or send as-is. Do not include any meta-commentary — just write the reply itself.`,
      },
      ...messages.map((m) => ({
        role: (m.sender_type === "visitor" ? "user" : "assistant") as
          | "user"
          | "assistant",
        content: m.content,
      })),
    ];

    const suggestion = await generateResponse(chatMessages, {
      temperature: 0.7,
    });

    return new Response(JSON.stringify({ suggestion }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("suggest error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
