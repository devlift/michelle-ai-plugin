/**
 * Edge Function: export-csv
 *
 * GET / — Export conversations with extracted data as CSV (admin only).
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

    const db = getServiceClient();

    // Get extraction properties for column headers
    const { data: propsSetting } = await db
      .from("agent_settings")
      .select("value")
      .eq("key", "extraction_properties")
      .single();

    const properties = (propsSetting?.value as Array<{
      key: string;
      label: string;
    }>) || [];

    // Get all conversations
    const { data: conversations } = await db
      .from("conversations")
      .select(
        "id, visitor_name, visitor_name_encrypted, status, created_at"
      )
      .order("created_at", { ascending: false })
      .limit(1000);

    if (!conversations || conversations.length === 0) {
      return new Response("No conversations found", {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "text/plain" },
      });
    }

    // Get all extracted data
    const convIds = conversations.map((c) => c.id);
    const { data: allExtracted } = await db
      .from("extracted_data")
      .select("conversation_id, property_key, property_value_encrypted")
      .in("conversation_id", convIds);

    // Build extracted data map: convId → { key: decryptedValue }
    const extractedMap = new Map<number, Record<string, string>>();
    for (const ed of allExtracted || []) {
      if (!extractedMap.has(ed.conversation_id)) {
        extractedMap.set(ed.conversation_id, {});
      }
      const value = await decryptPii(ed.property_value_encrypted);
      if (value) {
        extractedMap.get(ed.conversation_id)![ed.property_key] = value;
      }
    }

    // Build CSV
    const propKeys = properties.map((p) => p.key);
    const propLabels = properties.map((p) => p.label);
    const headers = [
      "Conversation ID",
      "Visitor Name",
      "Status",
      "Created At",
      ...propLabels,
    ];

    const escapeCsv = (val: string) => {
      if (val.includes(",") || val.includes('"') || val.includes("\n")) {
        return `"${val.replace(/"/g, '""')}"`;
      }
      return val;
    };

    const rows = [headers.map(escapeCsv).join(",")];

    for (const conv of conversations) {
      const extracted = extractedMap.get(conv.id) || {};

      // Skip conversations with no extracted data
      if (Object.keys(extracted).length === 0) continue;

      const name =
        (await decryptPii(conv.visitor_name_encrypted)) || conv.visitor_name;

      const row = [
        String(conv.id),
        name,
        conv.status,
        conv.created_at,
        ...propKeys.map((key) => extracted[key] || ""),
      ];

      rows.push(row.map(escapeCsv).join(","));
    }

    const csv = rows.join("\n");
    const date = new Date().toISOString().split("T")[0];

    return new Response(csv, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="michelle-ai-conversations-${date}.csv"`,
      },
    });
  } catch (err) {
    console.error("export-csv error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
