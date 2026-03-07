/**
 * OpenAI integration for Edge Functions.
 * Retrieves API key from private.encryption_keys via get_secret().
 * Supports both streaming and blocking responses.
 */

import { getServiceClient } from "./supabase.ts";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface OpenAIConfig {
  model: string;
  temperature: number;
  systemPrompt: string;
  contextMessages: number;
}

/**
 * Get the OpenAI API key from the secrets store.
 */
async function getApiKey(): Promise<string> {
  const db = getServiceClient();
  const { data, error } = await db.rpc("get_secret", {
    secret_name: "openai_api_key",
  });
  if (error || !data) {
    throw new Error("OpenAI API key not configured");
  }
  return data as string;
}

/**
 * Get AI-related settings from agent_settings.
 */
export async function getAIConfig(): Promise<OpenAIConfig> {
  const db = getServiceClient();
  const { data } = await db
    .from("agent_settings")
    .select("key, value")
    .in("key", [
      "openai_model",
      "temperature",
      "system_prompt",
      "context_messages",
    ]);

  const settings: Record<string, unknown> = {};
  for (const row of data || []) {
    settings[row.key] = row.value;
  }

  return {
    model: (settings.openai_model as string) || "gpt-4o-mini",
    temperature: Number(settings.temperature) || 0.7,
    systemPrompt:
      (settings.system_prompt as string) ||
      "You are a helpful and friendly customer support assistant.",
    contextMessages: Number(settings.context_messages) || 10,
  };
}

/**
 * Convert DB messages to OpenAI chat format.
 */
export function buildChatMessages(
  systemPrompt: string,
  dbMessages: Array<{ sender_type: string; content: string }>
): ChatMessage[] {
  const messages: ChatMessage[] = [];

  if (systemPrompt) {
    messages.push({ role: "system", content: systemPrompt });
  }

  for (const msg of dbMessages) {
    messages.push({
      role: msg.sender_type === "visitor" ? "user" : "assistant",
      content: msg.content,
    });
  }

  return messages;
}

/**
 * Generate a streaming response from OpenAI.
 * Returns a ReadableStream that yields SSE-formatted data.
 */
export async function streamChatResponse(
  messages: ChatMessage[],
  config: OpenAIConfig
): Promise<{ stream: ReadableStream; fullTextPromise: Promise<string> }> {
  const apiKey = await getApiKey();

  const response = await fetch(
    "https://api.openai.com/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature: config.temperature,
        stream: true,
      }),
    }
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenAI API error: ${response.status} ${err}`);
  }

  let fullText = "";
  let resolveFullText: (value: string) => void;
  const fullTextPromise = new Promise<string>((resolve) => {
    resolveFullText = resolve;
  });

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();

  const stream = new ReadableStream({
    async pull(controller) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          resolveFullText!(fullText);
          controller.close();
          return;
        }

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]") {
            resolveFullText!(fullText);
            controller.close();
            return;
          }

          try {
            const parsed = JSON.parse(data);
            const token = parsed.choices?.[0]?.delta?.content;
            if (token) {
              fullText += token;
              controller.enqueue(
                new TextEncoder().encode(`data: ${JSON.stringify({ token })}\n\n`)
              );
            }
          } catch {
            // Skip malformed chunks
          }
        }
      }
    },
  });

  return { stream, fullTextPromise };
}

/**
 * Generate a non-streaming response from OpenAI (for suggestions, extraction).
 */
export async function generateResponse(
  messages: ChatMessage[],
  config: Partial<OpenAIConfig> & { model?: string; temperature?: number } = {}
): Promise<string> {
  const apiKey = await getApiKey();
  const aiConfig = await getAIConfig();

  const response = await fetch(
    "https://api.openai.com/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.model || aiConfig.model,
        messages,
        temperature: config.temperature ?? aiConfig.temperature,
      }),
    }
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenAI API error: ${response.status} ${err}`);
  }

  const json = await response.json();
  return json.choices?.[0]?.message?.content || "";
}

/**
 * Generate quick reply suggestions (2-3 options).
 */
export async function generateQuickReplies(
  dbMessages: Array<{ sender_type: string; content: string }>
): Promise<string[]> {
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: `You generate 2-3 short quick-reply options for a chat visitor to tap.
Rules:
- Only generate replies when the AI asked a multiple-choice style question or when there are clear options
- If the AI asked for free-text input (name, email, details), return an empty array []
- Each reply should be 1-5 words
- Return a JSON array of strings, e.g. ["Yes", "No", "Tell me more"]
- Return ONLY the JSON array, no other text`,
    },
  ];

  for (const msg of dbMessages.slice(-6)) {
    messages.push({
      role: msg.sender_type === "visitor" ? "user" : "assistant",
      content: msg.content,
    });
  }

  try {
    const result = await generateResponse(messages, { temperature: 0.3 });
    const parsed = JSON.parse(result);
    if (Array.isArray(parsed) && parsed.length <= 3) {
      return parsed.map(String);
    }
    return [];
  } catch {
    return [];
  }
}
