/**
 * PII encryption/decryption wrappers for Edge Functions.
 * Calls the encrypt_pii() and decrypt_pii() Postgres functions.
 */

import { getServiceClient } from "./supabase.ts";

/**
 * Encrypt a PII value. Returns the encrypted bytea as a base64 string
 * that Supabase returns from bytea columns.
 */
export async function encryptPii(plaintext: string): Promise<string | null> {
  if (!plaintext) return null;

  const db = getServiceClient();
  const { data, error } = await db.rpc("encrypt_pii", {
    plaintext,
  });

  if (error) {
    console.error("encrypt_pii error:", error);
    return null;
  }

  return data;
}

/**
 * Decrypt a PII value from its encrypted form.
 */
export async function decryptPii(
  ciphertext: string | null
): Promise<string | null> {
  if (!ciphertext) return null;

  const db = getServiceClient();
  const { data, error } = await db.rpc("decrypt_pii", {
    ciphertext,
  });

  if (error) {
    console.error("decrypt_pii error:", error);
    return null;
  }

  return data;
}

/**
 * Encrypt multiple PII fields at once.
 * Returns a map of field name → encrypted value.
 */
export async function encryptFields(
  fields: Record<string, string>
): Promise<Record<string, string | null>> {
  const results: Record<string, string | null> = {};
  const promises = Object.entries(fields).map(async ([key, value]) => {
    results[key] = await encryptPii(value);
  });
  await Promise.all(promises);
  return results;
}

/**
 * Decrypt multiple PII fields at once.
 */
export async function decryptFields(
  fields: Record<string, string | null>
): Promise<Record<string, string | null>> {
  const results: Record<string, string | null> = {};
  const promises = Object.entries(fields).map(async ([key, value]) => {
    results[key] = await decryptPii(value);
  });
  await Promise.all(promises);
  return results;
}
