/**
 * Edge Function: chat
 *
 * POST / — Stream AI response for a visitor message via SSE.
 * This is the most complex function: validates token, builds context,
 * streams OpenAI response, saves message, generates quick replies,
 * and triggers data extraction.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { getServiceClient } from "../_shared/supabase.ts";
import { requireVisitor } from "../_shared/auth.ts";
import { encryptPii } from "../_shared/encryption.ts";
import {
  getAIConfig,
  buildChatMessages,
  streamChatResponse,
  generateQuickReplies,
} from "../_shared/openai.ts";
import { triggerExtraction } from "../_shared/extraction.ts";

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
    // Validate visitor token
    const auth = await requireVisitor(req);
    if (auth instanceof Response) return auth;

    const conversationId = auth.conversationId;
    const db = getServiceClient();

    // Get AI config
    const config = await getAIConfig();

    // Get moderation settings
    const { data: modSetting } = await db
      .from("agent_settings")
      .select("value")
      .eq("key", "moderation_mode")
      .single();
    const { data: autoReplySetting } = await db
      .from("agent_settings")
      .select("value")
      .eq("key", "auto_reply")
      .single();

    const moderationMode = modSetting?.value === true;
    const autoReply = autoReplySetting?.value !== false;
    const isPending = moderationMode && !autoReply;

    // Get conversation messages for context
    const { data: dbMessages } = await db
      .from("messages")
      .select("sender_type, content")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .limit(config.contextMessages);

    if (!dbMessages || dbMessages.length === 0) {
      return new Response(
        JSON.stringify({ error: "No messages in conversation" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Build OpenAI messages
    const chatMessages = buildChatMessages(config.systemPrompt, dbMessages);

    // Stream the response
    const { stream: openaiStream, fullTextPromise } =
      await streamChatResponse(chatMessages, config);

    // Create a TransformStream that forwards tokens and handles completion
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();

    // Process the stream in the background
    (async () => {
      const reader = openaiStream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          await writer.write(value);
        }

        // Stream complete — save message to DB
        const fullText = await fullTextPromise;
        const contentEnc = await encryptPii(fullText);

        const { data: savedMsg } = await db
          .from("messages")
          .insert({
            conversation_id: conversationId,
            sender_type: "ai",
            content: fullText,
            content_encrypted: contentEnc,
            is_pending_mod: isPending,
          })
          .select("id")
          .single();

        const msgId = savedMsg?.id;

        // Send the done event with msg_id
        await writer.write(
          encoder.encode(
            `data: ${JSON.stringify({ done: true, msg_id: msgId })}\n\n`
          )
        );

        // Generate quick replies (only if not pending moderation)
        if (!isPending && msgId && dbMessages) {
          try {
            const allMessages = [
              ...dbMessages,
              { sender_type: "ai", content: fullText },
            ];
            const quickReplies = await generateQuickReplies(allMessages);
            if (quickReplies.length > 0) {
              await db
                .from("messages")
                .update({ quick_replies: quickReplies })
                .eq("id", msgId);

              // Send quick replies as a final SSE event
              await writer.write(
                encoder.encode(
                  `data: ${JSON.stringify({ quick_replies: quickReplies })}\n\n`
                )
              );
            }
          } catch (e) {
            console.error("Quick replies failed:", e);
          }
        }

        // Update conversation timestamp
        await db
          .from("conversations")
          .update({ last_message_at: new Date().toISOString() })
          .eq("id", conversationId);

        // Trigger data extraction (fire and forget)
        triggerExtraction(conversationId).catch((e) =>
          console.error("Extraction failed:", e)
        );
      } catch (err) {
        console.error("Stream processing error:", err);
        await writer.write(
          encoder.encode(
            `data: ${JSON.stringify({ error: "Stream error" })}\n\n`
          )
        );
      } finally {
        await writer.close();
      }
    })();

    return new Response(readable, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    console.error("chat error:", err);
    const message = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({ error: "Internal server error", detail: message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

