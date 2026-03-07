/**
 * Authentication helpers for Edge Functions.
 *
 * - Visitors: validated via X-Chat-Token header (session_token lookup)
 * - Admins: validated via Authorization Bearer JWT + admin_users table
 */

import { getServiceClient } from "./supabase.ts";

export interface VisitorAuth {
  conversationId: number;
  token: string;
}

export interface AdminAuth {
  userId: string;
  email: string;
}

/**
 * Validate a visitor's chat token.
 * Returns the conversation ID if valid, or null.
 */
export async function validateVisitorToken(
  req: Request
): Promise<VisitorAuth | null> {
  const token =
    req.headers.get("x-chat-token") ||
    new URL(req.url).searchParams.get("token");

  if (!token) return null;

  const db = getServiceClient();
  const { data, error } = await db
    .from("conversations")
    .select("id")
    .eq("session_token", token)
    .single();

  if (error || !data) return null;

  return { conversationId: data.id, token };
}

/**
 * Validate an admin JWT or service_role key.
 * Accepts:
 *   - Authorization: Bearer <supabase_jwt> (dashboard users)
 *   - X-Service-Role-Key: <key> (WordPress PHP proxy)
 * Returns admin info if valid, or null.
 */
export async function validateAdmin(
  req: Request
): Promise<AdminAuth | null> {
  // Check for admin proxy authentication from WordPress.
  // On hosted Supabase, SUPABASE_SERVICE_ROLE_KEY is a short internal key
  // that differs from the JWT-format key used externally. We use a custom
  // ADMIN_PROXY_KEY secret that matches the service_role JWT the WP proxy sends.
  const proxyKey = Deno.env.get("ADMIN_PROXY_KEY") ||
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

  // Check x-service-role-key header, Authorization Bearer, and apikey header
  const serviceKey = req.headers.get("x-service-role-key");
  if (serviceKey && proxyKey && serviceKey === proxyKey) {
    return { userId: "wp-proxy", email: "admin@wordpress" };
  }

  const authHeader = req.headers.get("authorization");
  const bearerToken = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7)
    : null;

  if (bearerToken && proxyKey && bearerToken === proxyKey) {
    return { userId: "wp-proxy", email: "admin@wordpress" };
  }

  const apiKey = req.headers.get("apikey");
  if (apiKey && proxyKey && apiKey === proxyKey) {
    return { userId: "wp-proxy", email: "admin@wordpress" };
  }

  // Fall back to JWT-based admin auth
  if (!bearerToken) return null;

  const jwt = bearerToken;
  const db = getServiceClient();

  // Verify the JWT and get user
  const {
    data: { user },
    error,
  } = await db.auth.getUser(jwt);

  if (error || !user) return null;

  // Check admin_users table
  const { data: admin } = await db
    .from("admin_users")
    .select("email, role")
    .eq("id", user.id)
    .single();

  if (!admin) return null;

  return { userId: user.id, email: admin.email };
}

/**
 * Require visitor auth or return 401 response.
 */
export async function requireVisitor(
  req: Request
): Promise<VisitorAuth | Response> {
  const auth = await validateVisitorToken(req);
  if (!auth) {
    return new Response(JSON.stringify({ error: "Invalid or missing token" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  return auth;
}

/**
 * Require admin auth or return 403 response.
 */
export async function requireAdmin(
  req: Request
): Promise<AdminAuth | Response> {
  const auth = await validateAdmin(req);
  if (!auth) {
    return new Response(JSON.stringify({ error: "Admin access required" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }
  return auth;
}
