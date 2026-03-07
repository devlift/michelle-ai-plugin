/**
 * Edge Function: conversations
 *
 * POST / — Create a new conversation (visitor)
 * GET  / — List conversations (admin)
 * PATCH /:id — Update conversation status (admin)
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { getServiceClient } from "../_shared/supabase.ts";
import { requireAdmin } from "../_shared/auth.ts";
import { encryptPii, decryptPii } from "../_shared/encryption.ts";

Deno.serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;

  const url = new URL(req.url);
  const method = req.method;

  try {
    // POST / — Create new conversation (public)
    if (method === "POST") {
      return await createConversation(req);
    }

    // GET / — List conversations (admin)
    if (method === "GET" && !url.searchParams.has("id")) {
      return await listConversations(req, url);
    }

    // PATCH /?id=X — Update conversation (admin)
    if (method === "PATCH") {
      return await updateConversation(req, url);
    }

    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("conversations error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

/**
 * Create a new conversation. Returns session_token for visitor auth.
 */
async function createConversation(req: Request): Promise<Response> {
  const body = await req.json().catch(() => ({}));
  const name = (body.name || "").trim();
  const email = (body.email || "").trim();

  const db = getServiceClient();

  // Encrypt PII
  const nameEnc = await encryptPii(name);
  const emailEnc = await encryptPii(email);
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "";
  const ipEnc = await encryptPii(ip);

  const { data, error } = await db
    .from("conversations")
    .insert({
      visitor_name: name,
      visitor_email: "",
      visitor_ip: "",
      visitor_name_encrypted: nameEnc,
      visitor_email_encrypted: emailEnc,
      visitor_ip_encrypted: ipEnc,
    })
    .select("id, session_token")
    .single();

  if (error) {
    console.error("create conversation error:", error);
    return new Response(JSON.stringify({ error: "Failed to create conversation" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Insert welcome message if configured
  const { data: welcomeSetting } = await db
    .from("agent_settings")
    .select("value")
    .eq("key", "welcome_message")
    .single();

  const welcomeMsg = welcomeSetting?.value;
  if (welcomeMsg && typeof welcomeMsg === "string" && welcomeMsg.trim()) {
    const contentEnc = await encryptPii(welcomeMsg);
    await db.from("messages").insert({
      conversation_id: data.id,
      sender_type: "ai",
      content: welcomeMsg,
      content_encrypted: contentEnc,
    });
  }

  return new Response(
    JSON.stringify({
      conversation_id: data.id,
      token: data.session_token,
    }),
    {
      status: 201,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    }
  );
}

/**
 * List conversations (admin only).
 */
async function listConversations(
  req: Request,
  url: URL
): Promise<Response> {
  const auth = await requireAdmin(req);
  if (auth instanceof Response) return auth;

  const limit = parseInt(url.searchParams.get("limit") || "50", 10);
  const offset = parseInt(url.searchParams.get("offset") || "0", 10);
  const status = url.searchParams.get("status");

  const db = getServiceClient();
  let query = db
    .from("conversations")
    .select(
      "id, visitor_name, status, unread_admin, last_message_at, created_at, visitor_name_encrypted, visitor_email_encrypted"
    )
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .range(offset, offset + limit - 1);

  if (status) {
    query = query.eq("status", status);
  }

  const { data, error } = await query;
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Decrypt PII for admin view
  const conversations = await Promise.all(
    (data || []).map(async (c) => ({
      id: c.id,
      visitor_name: (await decryptPii(c.visitor_name_encrypted)) || c.visitor_name,
      visitor_email: (await decryptPii(c.visitor_email_encrypted)) || "",
      status: c.status,
      unread_admin: c.unread_admin,
      last_message_at: c.last_message_at,
      created_at: c.created_at,
    }))
  );

  return new Response(JSON.stringify(conversations), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Update conversation (admin only). Currently supports status changes.
 */
async function updateConversation(
  req: Request,
  url: URL
): Promise<Response> {
  const auth = await requireAdmin(req);
  if (auth instanceof Response) return auth;

  const id = url.searchParams.get("id");
  if (!id) {
    return new Response(JSON.stringify({ error: "Missing id" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const body = await req.json().catch(() => ({}));
  const updates: Record<string, unknown> = {};

  if (body.status && ["active", "closed", "archived"].includes(body.status)) {
    updates.status = body.status;
  }

  if (Object.keys(updates).length === 0) {
    return new Response(JSON.stringify({ error: "No valid fields to update" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const db = getServiceClient();
  const { error } = await db
    .from("conversations")
    .update(updates)
    .eq("id", parseInt(id, 10));

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
