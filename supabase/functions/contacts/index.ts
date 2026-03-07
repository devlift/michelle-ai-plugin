/**
 * Edge Function: contacts
 *
 * POST / — Submit contact form (public, rate-limited)
 * GET  / — List contacts (admin)
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { getServiceClient } from "../_shared/supabase.ts";
import { requireAdmin } from "../_shared/auth.ts";
import { encryptPii, decryptPii } from "../_shared/encryption.ts";

// Simple in-memory rate limit (resets on function cold start)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

Deno.serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    if (req.method === "POST") {
      return await submitContact(req);
    }
    if (req.method === "GET") {
      return await listContacts(req);
    }

    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("contacts error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function submitContact(req: Request): Promise<Response> {
  // Rate limit: 6 per hour per IP
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (entry && entry.resetAt > now && entry.count >= 6) {
    return new Response(
      JSON.stringify({ error: "Too many submissions. Please try again later." }),
      {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  if (!entry || entry.resetAt <= now) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + 3600000 });
  } else {
    entry.count++;
  }

  const body = await req.json().catch(() => ({}));
  const name = (body.name || "").trim();
  const email = (body.email || "").trim();
  const address = (body.address || "").trim();
  const message = (body.message || "").trim();

  if (!name || !email || !message) {
    return new Response(
      JSON.stringify({ error: "Name, email, and message are required" }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  const db = getServiceClient();

  // Encrypt PII
  const [nameEnc, emailEnc, addressEnc, messageEnc] = await Promise.all([
    encryptPii(name),
    encryptPii(email),
    encryptPii(address),
    encryptPii(message),
  ]);

  const { error } = await db.from("contacts").insert({
    name: "",
    email: "",
    address: "",
    message: "",
    name_encrypted: nameEnc,
    email_encrypted: emailEnc,
    address_encrypted: addressEnc,
    message_encrypted: messageEnc,
  });

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Get success message from settings
  const { data: setting } = await db
    .from("agent_settings")
    .select("value")
    .eq("key", "form_success_msg")
    .single();

  const successMsg =
    (setting?.value as string) || "Thanks! We'll be in touch soon.";

  return new Response(
    JSON.stringify({ ok: true, message: successMsg }),
    {
      status: 201,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    }
  );
}

async function listContacts(req: Request): Promise<Response> {
  const auth = await requireAdmin(req);
  if (auth instanceof Response) return auth;

  const db = getServiceClient();
  const { data, error } = await db
    .from("contacts")
    .select(
      "id, name_encrypted, email_encrypted, address_encrypted, message_encrypted, submitted_at"
    )
    .order("submitted_at", { ascending: false })
    .limit(100);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const contacts = await Promise.all(
    (data || []).map(async (c) => ({
      id: c.id,
      name: (await decryptPii(c.name_encrypted)) || "",
      email: (await decryptPii(c.email_encrypted)) || "",
      address: (await decryptPii(c.address_encrypted)) || "",
      message: (await decryptPii(c.message_encrypted)) || "",
      submitted_at: c.submitted_at,
    }))
  );

  return new Response(JSON.stringify(contacts), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
