/**
 * CORS headers for cross-origin widget requests.
 * All Edge Functions should use these for preflight and response headers.
 */

export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-chat-token",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
};

/**
 * Handle CORS preflight (OPTIONS) request.
 * Returns a 204 response if it's a preflight, otherwise null.
 */
export function handleCors(req: Request): Response | null {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  return null;
}
