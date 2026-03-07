/**
 * Shared data extraction logic.
 * Called after AI responses (chat) and after any message (messages).
 */

import { getServiceClient } from "./supabase.ts";
import { encryptPii, decryptPii } from "./encryption.ts";
import { generateResponse } from "./openai.ts";

/**
 * Run data extraction on a conversation's messages.
 * Checks if extraction is enabled and has properties configured,
 * then uses OpenAI to extract structured data from the conversation.
 */
export async function triggerExtraction(
  conversationId: number
): Promise<void> {
  const db = getServiceClient();

  // Check if extraction is enabled
  const { data: setting } = await db
    .from("agent_settings")
    .select("value")
    .eq("key", "extraction_enabled")
    .single();

  if (setting?.value !== true) return;

  // Get extraction properties
  const { data: propsSetting } = await db
    .from("agent_settings")
    .select("value")
    .eq("key", "extraction_properties")
    .single();

  const properties = propsSetting?.value;
  if (!Array.isArray(properties) || properties.length === 0) return;

  // Get conversation messages
  const { data: messages } = await db
    .from("messages")
    .select("sender_type, content")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(10);

  if (!messages || messages.length === 0) return;

  const systemPrompt = `You are a data extraction assistant. Analyze the conversation and extract the requested properties.
Return a JSON object with the property keys as keys and extracted values as values.
If a property cannot be determined from the conversation, omit it from the result.
Return ONLY valid JSON, no other text.

Properties to extract:
${properties.map((p: { key: string; label: string; prompt: string }) => `- "${p.key}" (${p.label}): ${p.prompt}`).join("\n")}`;

  const chatMessages = [
    { role: "system" as const, content: systemPrompt },
    ...messages.map((m) => ({
      role: (m.sender_type === "visitor" ? "user" : "assistant") as
        | "user"
        | "assistant",
      content: m.content,
    })),
  ];

  try {
    const result = await generateResponse(chatMessages, { temperature: 0.1 });
    const extracted = JSON.parse(result);

    for (const [key, value] of Object.entries(extracted)) {
      if (typeof value !== "string" || !value.trim()) continue;

      const valueEnc = await encryptPii(value);

      await db.from("extracted_data").upsert(
        {
          conversation_id: conversationId,
          property_key: key,
          property_value: "",
          property_value_encrypted: valueEnc,
          extracted_at: new Date().toISOString(),
        },
        { onConflict: "conversation_id,property_key" }
      );

      // Update visitor name if first/last name extracted
      if (key === "first_name" || key === "last_name") {
        const { data: allExtracted } = await db
          .from("extracted_data")
          .select("property_key, property_value_encrypted")
          .eq("conversation_id", conversationId)
          .in("property_key", ["first_name", "last_name"]);

        if (allExtracted) {
          const parts: string[] = [];
          for (const ed of allExtracted) {
            const val = await decryptPii(ed.property_value_encrypted);
            if (val) parts.push(val);
          }
          const fullName = parts.join(" ").trim();
          if (fullName) {
            const nameEnc = await encryptPii(fullName);
            await db
              .from("conversations")
              .update({
                visitor_name: fullName,
                visitor_name_encrypted: nameEnc,
              })
              .eq("id", conversationId);
          }
        }
      }
    }
  } catch (e) {
    console.error("Extraction parse error:", e);
  }
}
