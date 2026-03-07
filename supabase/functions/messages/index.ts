/**
 * Edge Function: messages
 *
 * GET  /?conversation_id=X — Get messages (visitor or admin)
 * POST / — Send a message (visitor or admin)
 * POST /?action=approve&msg_id=X — Approve pending moderation (admin)
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { getServiceClient } from "../_shared/supabase.ts";
import {
  validateVisitorToken,
  requireAdmin,
  type VisitorAuth,
} from "../_shared/auth.ts";
import { encryptPii, decryptPii } from "../_shared/encryption.ts";
import { generateQuickReplies } from "../_shared/openai.ts";
import { triggerExtraction } from "../_shared/extraction.ts";

Deno.serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;

  const url = new URL(req.url);
  const method = req.method;

  try {
    if (method === "GET") {
      return await getMessages(req, url);
    }

    if (method === "POST") {
      const action = url.searchParams.get("action");
      if (action === "approve") {
        return await approveMessage(req, url);
      }
      return await sendMessage(req, url);
    }

    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("messages error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

/**
 * Get messages for a conversation.
 * Visitors: filters out pending moderation messages.
 * Admins: returns all messages.
 */
async function getMessages(req: Request, url: URL): Promise<Response> {
  const conversationId = url.searchParams.get("conversation_id");
  if (!conversationId) {
    return new Response(JSON.stringify({ error: "Missing conversation_id" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const convId = parseInt(conversationId, 10);
  const since = url.searchParams.get("since");
  const before = url.searchParams.get("before");
  const limit = parseInt(url.searchParams.get("limit") || "30", 10);
  const isAdmin = !!(await requireAdminSilent(req));
  const visitorAuth = isAdmin ? null : await validateVisitorToken(req);

  if (!isAdmin && !visitorAuth) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Verify visitor owns this conversation
  if (visitorAuth && visitorAuth.conversationId !== convId) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const db = getServiceClient();

  // Paginated (load older)
  if (before) {
    let query = db
      .from("messages")
      .select("id, conversation_id, sender_type, content, quick_replies, is_pending_mod, ai_suggestion, created_at, content_encrypted")
      .eq("conversation_id", convId)
      .lt("id", parseInt(before, 10))
      .order("id", { ascending: false })
      .limit(limit);

    if (!isAdmin) {
      query = query.eq("is_pending_mod", false);
    }

    const { data, error } = await query;
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Count total for has_older
    const { count } = await db
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", convId);

    const messages = await decryptMessages(data || [], isAdmin);

    return new Response(
      JSON.stringify({
        messages: messages.reverse(),
        total: count || 0,
        has_older: (data || []).length === limit,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Since-based (polling for new messages)
  if (since) {
    let query = db
      .from("messages")
      .select("id, conversation_id, sender_type, content, quick_replies, is_pending_mod, ai_suggestion, created_at, content_encrypted")
      .eq("conversation_id", convId)
      .gt("created_at", since)
      .order("created_at", { ascending: true });

    if (!isAdmin) {
      query = query.eq("is_pending_mod", false);
    }

    const { data, error } = await query;
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const messages = await decryptMessages(data || [], isAdmin);
    return new Response(JSON.stringify(messages), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Default: latest messages
  let query = db
    .from("messages")
    .select("id, conversation_id, sender_type, content, quick_replies, is_pending_mod, ai_suggestion, created_at, content_encrypted")
    .eq("conversation_id", convId)
    .order("id", { ascending: false })
    .limit(limit);

  if (!isAdmin) {
    query = query.eq("is_pending_mod", false);
  }

  const { data, error } = await query;
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { count } = await db
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", convId);

  const messages = await decryptMessages(data || [], isAdmin);

  // Mark conversation as read if admin
  if (isAdmin) {
    await db
      .from("conversations")
      .update({ unread_admin: false })
      .eq("id", convId);
  }

  return new Response(
    JSON.stringify({
      messages: messages.reverse(),
      total: count || 0,
      has_older: (data || []).length === limit,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

/**
 * Send a message (visitor or admin).
 */
async function sendMessage(req: Request, url: URL): Promise<Response> {
  const body = await req.json().catch(() => ({}));
  const content = (body.content || "").trim();
  const conversationId = body.conversation_id || parseInt(url.searchParams.get("conversation_id") || "0", 10);

  if (!content || !conversationId) {
    return new Response(
      JSON.stringify({ error: "Missing content or conversation_id" }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  // Determine if visitor or admin
  const visitorAuth = await validateVisitorToken(req);
  const isAdmin = visitorAuth ? false : !!(await requireAdminSilent(req));

  if (!visitorAuth && !isAdmin) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Verify visitor owns this conversation
  if (visitorAuth && visitorAuth.conversationId !== conversationId) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const db = getServiceClient();
  const contentEnc = await encryptPii(content);
  const senderType = isAdmin ? "admin" : "visitor";

  const { data, error } = await db
    .from("messages")
    .insert({
      conversation_id: conversationId,
      sender_type: senderType,
      content,
      content_encrypted: contentEnc,
    })
    .select("id")
    .single();

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Update conversation
  const convUpdate: Record<string, unknown> = {
    last_message_at: new Date().toISOString(),
  };
  if (senderType === "visitor") {
    convUpdate.unread_admin = true;
  }
  await db
    .from("conversations")
    .update(convUpdate)
    .eq("id", conversationId);

  // Trigger data extraction (fire and forget)
  triggerExtraction(conversationId).catch((e) =>
    console.error("Extraction failed:", e)
  );

  return new Response(
    JSON.stringify({ ok: true, msg_id: data.id }),
    {
      status: 201,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    }
  );
}

/**
 * Approve a pending moderation message (admin only).
 */
async function approveMessage(req: Request, url: URL): Promise<Response> {
  const auth = await requireAdmin(req);
  if (auth instanceof Response) return auth;

  const msgId = url.searchParams.get("msg_id");
  if (!msgId) {
    return new Response(JSON.stringify({ error: "Missing msg_id" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const db = getServiceClient();

  // Clear pending flag
  const { data: msg, error } = await db
    .from("messages")
    .update({ is_pending_mod: false })
    .eq("id", parseInt(msgId, 10))
    .select("conversation_id")
    .single();

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Generate quick replies now that message is approved
  const { data: allMsgs } = await db
    .from("messages")
    .select("sender_type, content")
    .eq("conversation_id", msg.conversation_id)
    .eq("is_pending_mod", false)
    .order("created_at", { ascending: true });

  if (allMsgs && allMsgs.length > 0) {
    try {
      const quickReplies = await generateQuickReplies(allMsgs);
      if (quickReplies.length > 0) {
        await db
          .from("messages")
          .update({ quick_replies: quickReplies })
          .eq("id", parseInt(msgId, 10));
      }
    } catch (e) {
      console.error("Quick replies generation failed:", e);
    }
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// =========================================================================
// Helpers
// =========================================================================

/**
 * Check if request has admin auth without returning a Response.
 */
async function requireAdminSilent(req: Request): Promise<boolean> {
  const { validateAdmin } = await import("../_shared/auth.ts");
  const admin = await validateAdmin(req);
  return admin !== null;
}

/**
 * Decrypt message content for response.
 * Admins get decrypted content; visitors get the plaintext column.
 */
async function decryptMessages(
  messages: Array<Record<string, unknown>>,
  isAdmin: boolean
): Promise<Array<Record<string, unknown>>> {
  return Promise.all(
    messages.map(async (msg) => {
      const decryptedContent = isAdmin
        ? (await decryptPii(msg.content_encrypted as string)) || msg.content
        : msg.content;

      return {
        id: msg.id,
        conversation_id: msg.conversation_id,
        sender_type: msg.sender_type,
        content: decryptedContent,
        quick_replies: msg.quick_replies,
        is_pending_mod: msg.is_pending_mod,
        ai_suggestion: msg.ai_suggestion,
        created_at: msg.created_at,
      };
    })
  );
}
