/**
 * Edge Function: retrain
 *
 * POST / — Regenerate the system prompt from selected conversation examples.
 *
 * Body: {
 *   conversation_ids: number[],
 *   current_prompt: string,
 *   instructions?: string
 * }
 *
 * Returns: { prompt: string }
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { getServiceClient } from "../_shared/supabase.ts";
import { requireAdmin } from "../_shared/auth.ts";
import { generateResponse } from "../_shared/openai.ts";

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
    const conversationIds: number[] = body.conversation_ids || [];
    const currentPrompt: string = body.current_prompt || "";
    const instructions: string = body.instructions || "";

    if (!conversationIds.length) {
      return new Response(
        JSON.stringify({ error: "No conversations selected" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (conversationIds.length > 20) {
      return new Response(
        JSON.stringify({ error: "Maximum 20 conversations allowed" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const db = getServiceClient();

    // Fetch messages for all selected conversations
    const conversationSummaries: string[] = [];

    for (const convId of conversationIds) {
      // Get conversation metadata
      const { data: conv } = await db
        .from("conversations")
        .select("visitor_name, status")
        .eq("id", convId)
        .single();

      // Get messages (up to 50 per conversation to keep context manageable)
      const { data: messages } = await db
        .from("messages")
        .select("sender_type, content")
        .eq("conversation_id", convId)
        .order("created_at", { ascending: true })
        .limit(50);

      if (!messages || messages.length === 0) continue;

      const visitorName = conv?.visitor_name || "Visitor";
      let transcript = `--- Conversation with ${visitorName} (${conv?.status || "unknown"}) ---\n`;
      for (const msg of messages) {
        const role =
          msg.sender_type === "visitor"
            ? visitorName
            : msg.sender_type === "ai"
              ? "AI Assistant"
              : "Admin";
        transcript += `${role}: ${msg.content}\n`;
      }

      conversationSummaries.push(transcript);
    }

    if (conversationSummaries.length === 0) {
      return new Response(
        JSON.stringify({
          error: "No messages found in the selected conversations",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Build the meta-prompt for generating the system prompt
    const metaPrompt = buildMetaPrompt(
      currentPrompt,
      conversationSummaries,
      instructions
    );

    const result = await generateResponse(
      [{ role: "system", content: metaPrompt }],
      { temperature: 0.7 }
    );

    return new Response(JSON.stringify({ prompt: result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("retrain error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function buildMetaPrompt(
  currentPrompt: string,
  conversations: string[],
  instructions: string
): string {
  const conversationBlock = conversations.join("\n\n");

  return `You are an expert at writing system prompts for AI customer support assistants.

Your task: Analyze the real conversation transcripts below and generate an improved system prompt that will help the AI assistant handle these types of conversations more effectively.

## Current System Prompt
${currentPrompt || "(No current prompt)"}

## Real Conversation Transcripts
These are actual conversations that have taken place. Study the patterns, tone, types of questions asked, information collected, and how successful interactions flow.

${conversationBlock}

## Analysis Instructions
1. Identify the common patterns in how the AI should respond
2. Note what information the AI should collect from visitors
3. Observe the tone and communication style that works well
4. Identify any areas where the AI could improve based on admin corrections
5. Preserve the core personality and role from the current prompt if one exists
6. Include specific guidance for handling the types of conversations seen in the transcripts
7. Add guardrails for handling off-topic or inappropriate requests

${instructions ? `## Additional Instructions from Admin\n${instructions}\n` : ""}

## Output Format
Write ONLY the new system prompt. Do not include any meta-commentary, explanations, or markdown formatting around it. The output should be ready to use directly as a system prompt. Keep the same general structure and sections as the current prompt if it has them, but improve and expand based on the conversation evidence.`;
}
