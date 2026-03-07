/**
 * Edge Function: generate-pdf
 *
 * GET /?conversation_id=X&template=Y — Generate print-ready HTML document (admin only).
 * Populates template with extracted data, includes letterhead.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { getServiceClient } from "../_shared/supabase.ts";
import { requireAdmin } from "../_shared/auth.ts";
import { decryptPii } from "../_shared/encryption.ts";

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
    const auth = await requireAdmin(req);
    if (auth instanceof Response) return auth;

    const url = new URL(req.url);
    const conversationId = parseInt(
      url.searchParams.get("conversation_id") || "0",
      10
    );
    const templateIdx = parseInt(
      url.searchParams.get("template") || "0",
      10
    );

    if (!conversationId) {
      return new Response(JSON.stringify({ error: "Missing conversation_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const db = getServiceClient();

    // Get document templates and letterhead from settings
    const { data: settingsData } = await db
      .from("agent_settings")
      .select("key, value")
      .in("key", ["document_templates", "letterhead_url"]);

    const settingsMap: Record<string, unknown> = {};
    for (const s of settingsData || []) {
      settingsMap[s.key] = s.value;
    }

    const templates = settingsMap.document_templates as Array<{
      name: string;
      content: string;
    }>;
    if (!Array.isArray(templates) || !templates[templateIdx]) {
      return new Response(
        JSON.stringify({ error: "Template not found" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const template = templates[templateIdx];
    const letterheadUrl = (settingsMap.letterhead_url as string) || "";

    // Get extracted data for this conversation
    const { data: extractedData } = await db
      .from("extracted_data")
      .select("property_key, property_value_encrypted")
      .eq("conversation_id", conversationId);

    // Build variable map from extracted data
    const variables: Record<string, string> = {
      date: new Date().toLocaleDateString("en-CA"),
    };

    for (const ed of extractedData || []) {
      const value = await decryptPii(ed.property_value_encrypted);
      if (value) {
        variables[ed.property_key] = value;
      }
    }

    // Get conversation info
    const { data: conv } = await db
      .from("conversations")
      .select("visitor_name, visitor_name_encrypted, visitor_email_encrypted")
      .eq("id", conversationId)
      .single();

    if (conv) {
      const name = await decryptPii(conv.visitor_name_encrypted);
      const email = await decryptPii(conv.visitor_email_encrypted);
      if (name) variables.visitor_name = name;
      if (email) variables.visitor_email = email;
    }

    // Replace {{handlebars}} in template content
    let content = template.content;
    content = content.replace(
      /\{\{(\w+)\}\}/g,
      (_: string, key: string) => variables[key] || `{{${key}}}`
    );

    // Escape HTML in content, preserve newlines
    const escapeHtml = (str: string) =>
      str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");

    const htmlContent = escapeHtml(content).replace(/\n/g, "<br>");

    // Build print-ready HTML
    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(template.name)}</title>
<style>
  @page { margin: 20mm; }
  body { font-family: 'Georgia', serif; font-size: 14px; line-height: 1.8; color: #1e293b; max-width: 800px; margin: 0 auto; padding: 40px; }
  .letterhead { text-align: center; margin-bottom: 30px; }
  .letterhead img { max-width: 300px; max-height: 100px; }
  .document-content { white-space: pre-wrap; }
  .print-bar { background: #2563eb; color: #fff; padding: 10px 20px; display: flex; justify-content: space-between; align-items: center; position: fixed; top: 0; left: 0; right: 0; z-index: 1000; }
  .print-bar button { background: #fff; color: #2563eb; border: none; padding: 8px 16px; border-radius: 4px; font-size: 14px; cursor: pointer; font-weight: 600; }
  .print-bar button:hover { background: #f1f5f9; }
  @media print { .print-bar { display: none; } body { padding: 0; } }
</style>
</head>
<body>
<div class="print-bar">
  <span>${escapeHtml(template.name)}</span>
  <button onclick="window.print()">Print / Save as PDF</button>
</div>
<div style="margin-top: 60px;">
${letterheadUrl ? `<div class="letterhead"><img src="${escapeHtml(letterheadUrl)}" alt="Letterhead"></div>` : ""}
<div class="document-content">${htmlContent}</div>
</div>
</body>
</html>`;

    return new Response(html, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/html; charset=utf-8",
      },
    });
  } catch (err) {
    console.error("generate-pdf error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
