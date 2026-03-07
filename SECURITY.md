# Michelle AI — Security & Compliance Documentation

This document describes the security architecture, data protection controls, and HIPAA compliance measures implemented in the Michelle AI chat platform. It is intended for security auditors, compliance officers, and technical reviewers.

**Last updated:** 2026-03-06
**Version:** 2.0 (Supabase migration)

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Data Classification](#data-classification)
3. [Encryption](#encryption)
4. [Authentication & Authorization](#authentication--authorization)
5. [Row Level Security](#row-level-security)
6. [Audit Logging](#audit-logging)
7. [Data Residency](#data-residency)
8. [Secret Management](#secret-management)
9. [Network Security](#network-security)
10. [Input Validation & Rate Limiting](#input-validation--rate-limiting)
11. [HIPAA Compliance Matrix](#hipaa-compliance-matrix)
12. [Incident Response](#incident-response)
13. [Data Retention & Deletion](#data-retention--deletion)

---

## 1. Architecture Overview

The platform consists of three layers:

| Layer | Technology | Location |
|---|---|---|
| **Frontend** | Vanilla JavaScript chat widget | Visitor's browser |
| **API** | Supabase Edge Functions (Deno runtime) | Supabase cloud (ca-central-1) |
| **Database** | PostgreSQL 17 (Supabase managed) | Supabase cloud (ca-central-1) |

A WordPress plugin serves as the admin interface only. It communicates with the same Supabase Edge Functions that the chat widget uses. WordPress does **not** store or process any Protected Health Information (PHI).

**Data flow:**

```
Visitor browser → HTTPS → Edge Functions → PostgreSQL (encrypted PII)
Admin browser   → HTTPS → Edge Functions → PostgreSQL (encrypted PII)
Edge Functions  → HTTPS → OpenAI API (message content only, no PII identifiers)
```

---

## 2. Data Classification

### Protected Health Information (PHI)

The following fields are classified as PHI and receive column-level encryption:

| Table | Field | Type | Encrypted Column |
|---|---|---|---|
| `conversations` | Visitor name | Text | `visitor_name_encrypted` |
| `conversations` | Visitor email | Text | `visitor_email_encrypted` |
| `conversations` | Visitor IP address | Text | `visitor_ip_encrypted` |
| `messages` | Message content | Text | `content_encrypted` |
| `extracted_data` | Property values (may contain names, phone numbers, etc.) | Text | `property_value_encrypted` |
| `contacts` | Name | Text | `name_encrypted` |
| `contacts` | Email | Text | `email_encrypted` |
| `contacts` | Address | Text | `address_encrypted` |
| `contacts` | Message | Text | `message_encrypted` |

### Non-PHI data

| Data | Classification | Notes |
|---|---|---|
| Conversation status | Internal | active/closed/archived |
| Timestamps | Internal | created_at, last_message_at |
| Message sender type | Internal | visitor/admin/ai |
| Quick reply suggestions | Non-sensitive | AI-generated UI labels |
| Plugin settings | Configuration | Branding, model config |
| Audit log entries | Compliance | Contains references to PHI records |

---

## 3. Encryption

### 3.1 Encryption at Rest

| Level | Method | Details |
|---|---|---|
| **Disk-level** | AES-256 | Supabase encrypts all data at rest by default (AWS EBS encryption) |
| **Column-level** | AES-256 via pgcrypto | All PHI fields are additionally encrypted using `pgp_sym_encrypt()` |
| **Backups** | AES-256 | Point-in-Time Recovery backups inherit disk encryption |

### 3.2 Column-Level Encryption Implementation

All PHI is encrypted using PostgreSQL's `pgcrypto` extension with AES-256 symmetric encryption:

```
plaintext → pgp_sym_encrypt(plaintext, key) → bytea (stored in *_encrypted column)
bytea     → pgp_sym_decrypt(ciphertext, key) → plaintext (returned to authorized users)
```

**Key management:**
- Encryption key is a 256-bit random value generated during database initialization
- Key is stored in the `private` schema (`private.encryption_keys`), which is **not exposed** by the PostgREST API
- Only `security definer` functions (`encrypt_pii`, `decrypt_pii`) can access the key
- Functions are restricted: `anon` and `public` roles have no execute permission
- Only `authenticated` and `service_role` can call encryption functions

**Plaintext columns:**
- The unencrypted columns (e.g., `visitor_name`, `content`) exist for display purposes only
- Edge Functions write masked/empty values to plaintext columns and real values to encrypted columns
- Database queries for admin views decrypt from the `*_encrypted` columns

### 3.3 Encryption in Transit

| Connection | Encryption |
|---|---|
| Browser → Edge Functions | TLS 1.2+ (HTTPS enforced) |
| Edge Functions → PostgreSQL | TLS (Supabase internal) |
| Edge Functions → OpenAI API | TLS 1.2+ (HTTPS) |
| Supabase Realtime (WebSocket) | WSS (TLS encrypted) |

### 3.4 What is sent to OpenAI

Edge Functions send **message content only** to OpenAI for AI response generation. The following is **not** sent to OpenAI:
- Visitor names, emails, or IP addresses
- Session tokens or conversation IDs
- Extracted data values
- Any data from other conversations

The system prompt and the last N messages (configurable, default 10) from the current conversation are sent.

---

## 4. Authentication & Authorization

### 4.1 Visitor Authentication

| Property | Details |
|---|---|
| **Method** | Session token (256-bit random hex string) |
| **Storage** | Browser `localStorage` |
| **Validation** | Token matched against `conversations.session_token` in database |
| **Scope** | Token grants access to a single conversation only |
| **Expiry** | Token is valid as long as the conversation exists |
| **Transport** | `X-Chat-Token` HTTP header |

Visitors cannot:
- Access other visitors' conversations
- Read messages marked as `is_pending_mod = true`
- Modify conversation status
- Access admin endpoints
- Access extracted data or audit logs

### 4.2 Admin Authentication

| Property | Details |
|---|---|
| **Method** | Supabase JWT (JSON Web Token) |
| **Validation** | JWT verified by Supabase auth + `admin_users` table lookup |
| **Scope** | Full access to all conversations and settings |
| **MFA** | Available via Supabase auth (TOTP, WebAuthn) |
| **Session** | Configurable expiry (default: 1 hour, refresh token rotation) |

Admin access requires:
1. Valid Supabase JWT in `Authorization: Bearer <token>` header
2. Corresponding record in `admin_users` table
3. Both checks must pass — a valid JWT without an `admin_users` record is rejected

### 4.3 Service Role

Edge Functions use the Supabase `service_role` key to bypass Row Level Security for internal operations (e.g., saving AI responses, running extraction). This key:
- Is never exposed to clients
- Is stored as an environment variable in the Edge Functions runtime
- Is not included in any API responses

---

## 5. Row Level Security

All tables have Row Level Security (RLS) enabled. The following policies control data access:

### `conversations`

| Policy | Applies To | Rule |
|---|---|---|
| `admins_select_conversations` | SELECT | `is_admin() = true` |
| `admins_update_conversations` | UPDATE | `is_admin() = true` |
| `service_insert_conversations` | INSERT | Service role only (Edge Functions) |

### `messages`

| Policy | Applies To | Rule |
|---|---|---|
| `admins_select_messages` | SELECT | `is_admin() = true` |
| `admins_update_messages` | UPDATE | `is_admin() = true` |
| `service_insert_messages` | INSERT | Service role only (Edge Functions) |

Visitor message access is controlled at the Edge Function level:
- Visitor token is validated against `conversations.session_token`
- Only messages from the visitor's own conversation are returned
- Messages with `is_pending_mod = true` are filtered out for visitors

### `extracted_data`

| Policy | Applies To | Rule |
|---|---|---|
| `admins_select_extracted_data` | SELECT | `is_admin() = true` |
| `admins_insert_extracted_data` | INSERT | `is_admin() = true` |
| `admins_update_extracted_data` | UPDATE | `is_admin() = true` |

### `contacts`

| Policy | Applies To | Rule |
|---|---|---|
| `anyone_insert_contacts` | INSERT | Allowed (public form submission) |
| `admins_select_contacts` | SELECT | `is_admin() = true` |

### `audit_log`

| Policy | Applies To | Rule |
|---|---|---|
| `admins_read_audit_log` | SELECT | `is_admin() = true` |
| (no INSERT/UPDATE/DELETE) | — | Only triggers and service role can write |

### `agent_settings`

| Policy | Applies To | Rule |
|---|---|---|
| `admins_all_settings` | ALL | `is_admin() = true` |

### Helper function

The `is_admin()` function is defined as `security definer` and checks:
```sql
SELECT EXISTS (
  SELECT 1 FROM public.admin_users WHERE id = auth.uid()
);
```

---

## 6. Audit Logging

### 6.1 What is logged

Every INSERT, UPDATE, and DELETE on the following tables is automatically logged:

- `conversations`
- `messages`
- `extracted_data`
- `contacts`

### 6.2 Audit log schema

| Column | Type | Description |
|---|---|---|
| `id` | bigint | Auto-incrementing primary key |
| `table_name` | text | Table that was modified |
| `record_id` | text | ID of the affected record |
| `action` | text | `INSERT`, `UPDATE`, or `DELETE` |
| `actor_id` | uuid | Supabase auth user ID (null for system/anonymous) |
| `actor_type` | text | `visitor`, `admin`, `system`, or `ai` |
| `ip_address` | text | Client IP (when available) |
| `old_data` | jsonb | Previous state of the record (UPDATE/DELETE) |
| `new_data` | jsonb | New state of the record (INSERT/UPDATE) |
| `metadata` | jsonb | Additional context |
| `created_at` | timestamptz | Timestamp of the operation |

### 6.3 Implementation

Audit logging is implemented via PostgreSQL `AFTER` triggers:

```sql
CREATE TRIGGER audit_conversations
  AFTER INSERT OR UPDATE OR DELETE ON conversations
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
```

The trigger function:
1. Determines the actor (admin, visitor, or system) from the current auth context
2. Records the full old and new data as JSONB
3. Inserts into the `audit_log` table
4. Runs inside the same transaction as the triggering operation

### 6.4 Audit log access

- Only users in the `admin_users` table can read audit logs (RLS enforced)
- Audit log records cannot be modified or deleted by any user (no UPDATE/DELETE policies)
- Only database triggers and the service role can insert audit records
- Audit logs are included in database backups (PITR)

### 6.5 Audit log retention

Audit logs are retained indefinitely by default. A data retention policy should be configured based on regulatory requirements (typically 6-7 years for HIPAA).

---

## 7. Data Residency

| Component | Region | Provider |
|---|---|---|
| PostgreSQL database | `ca-central-1` (Canada) | AWS (via Supabase) |
| Edge Functions | `ca-central-1` (Canada) | AWS (via Supabase) |
| Supabase Auth | `ca-central-1` (Canada) | AWS (via Supabase) |
| Backups (PITR) | `ca-central-1` (Canada) | AWS (via Supabase) |
| WordPress admin UI | SiteGround (varies) | SiteGround |

**Note:** The WordPress server does not store or process PHI. All PHI resides exclusively in the Supabase project in the Canadian region.

**Third-party data processing:**
- OpenAI receives message content (not PII identifiers) for AI response generation
- OpenAI's data processing agreement should be reviewed for compliance
- ElevenLabs receives audio data (if audio feature is enabled)

---

## 8. Secret Management

| Secret | Storage Location | Access |
|---|---|---|
| PII encryption key | `private.encryption_keys` table | `encrypt_pii()` / `decrypt_pii()` functions only |
| OpenAI API key | `private.encryption_keys` table | `get_secret()` function (service_role only) |
| ElevenLabs API key | `private.encryption_keys` table | `get_secret()` function (service_role only) |
| Supabase service_role key | Edge Functions env variable | Runtime only, never exposed |
| Database password | Supabase platform | Dashboard access only |

The `private` schema is:
- **Not exposed** by the PostgREST API (only `public` and `graphql_public` schemas are exposed)
- Accessible only through `security definer` functions
- Functions that access secrets have `REVOKE EXECUTE ... FROM public, anon` applied

---

## 9. Network Security

### 9.1 Supabase platform

| Control | Status |
|---|---|
| SSL/TLS enforcement | Enabled (required for HIPAA) |
| Network restrictions | Configurable IP allowlist |
| DDoS protection | AWS Shield (via Supabase infrastructure) |
| WAF | Supabase API gateway |

### 9.2 Edge Functions

- All Edge Functions are served over HTTPS
- CORS headers restrict allowed origins, methods, and headers
- Rate limiting is implemented in-function for public endpoints:
  - Contact form: 6 submissions per IP per hour
  - Audio signed URL: 10 requests per IP per minute

### 9.3 Database

- PostgreSQL is not directly accessible from the internet
- All connections go through the Supabase API gateway (PostgREST) or Edge Functions
- Database connection pooling via PgBouncer
- SSL required for all database connections

---

## 10. Input Validation & Rate Limiting

### 10.1 Input validation

| Endpoint | Validation |
|---|---|
| Conversation creation | Name/email trimmed and sanitized |
| Message sending | Content trimmed, non-empty check |
| Contact form | Name, email, message required; all trimmed |
| Settings save | Type-checked per setting key |
| Status updates | Enum validation (active/closed/archived) |
| Template index | Integer validation, bounds checking |

### 10.2 Rate limiting

| Endpoint | Limit | Window |
|---|---|---|
| Contact form (`POST /contacts`) | 6 per IP | 1 hour |
| Audio signed URL (`GET /audio-signed-url`) | 10 per IP | 1 minute |

Rate limiting is enforced in Edge Functions using in-memory maps. Rate limit state resets on function cold starts.

---

## 11. HIPAA Compliance Matrix

| HIPAA Requirement | Implementation | Status |
|---|---|---|
| **Access Controls (§164.312(a))** | RLS policies, admin_users table, token-based visitor auth | Implemented |
| **Audit Controls (§164.312(b))** | Trigger-based audit logging on all PHI tables | Implemented |
| **Integrity Controls (§164.312(c))** | Database constraints, JSONB audit trail with old/new data | Implemented |
| **Transmission Security (§164.312(e))** | TLS 1.2+ on all connections | Implemented |
| **Encryption (§164.312(a)(2)(iv))** | AES-256 at rest (disk) + AES-256 column-level (pgcrypto) | Implemented |
| **Unique User Identification (§164.312(a)(2)(i))** | Supabase auth user IDs, session tokens for visitors | Implemented |
| **Emergency Access (§164.312(a)(2)(ii))** | Supabase dashboard access with database password | Available |
| **Automatic Logoff (§164.312(a)(2)(iii))** | JWT expiry (configurable, default 1 hour) | Implemented |
| **BAA (§164.502(e))** | Supabase BAA (Team Plan required) | Required |
| **PITR / Backup (§164.308(a)(7))** | Supabase Point-in-Time Recovery | Required |
| **Workforce Training (§164.308(a)(5))** | Organization responsibility | N/A (platform) |
| **Breach Notification (§164.408)** | Supabase breach notification per BAA | Per BAA |

### Pre-production checklist

- [ ] Supabase Team Plan activated
- [ ] BAA signed via [forms.supabase.com/hipaa2](https://forms.supabase.com/hipaa2)
- [ ] Project marked as "High Compliance" in Supabase dashboard
- [ ] SSL enforcement enabled
- [ ] Point-in-Time Recovery enabled
- [ ] Network restrictions configured
- [ ] MFA enabled for all admin dashboard users
- [ ] All PHI columns verified encrypted (query `*_encrypted` columns)
- [ ] Audit log triggers verified on all PHI tables
- [ ] RLS policies tested (cross-conversation access rejected)
- [ ] OpenAI data processing agreement reviewed
- [ ] Data retention policy defined and documented

---

## 12. Incident Response

### Data breach detection

- Audit logs track all PHI access (who, what, when)
- Supabase platform audit logs track infrastructure changes
- Anomalous access patterns can be detected by querying the `audit_log` table

### Response procedure

1. **Identify**: Review `audit_log` for unauthorized access patterns
2. **Contain**: Revoke compromised tokens/sessions, rotate encryption keys
3. **Assess**: Determine scope of PHI exposure using audit trail
4. **Notify**: Follow HIPAA breach notification requirements (per BAA)
5. **Remediate**: Patch vulnerability, update access controls
6. **Document**: Record incident details and response actions

### Key rotation

If the PII encryption key is compromised:

1. Generate a new key
2. Decrypt all PHI using the old key
3. Re-encrypt all PHI using the new key
4. Update `private.encryption_keys` with the new key
5. Verify all data is accessible with the new key
6. Securely destroy the old key

---

## 13. Data Retention & Deletion

### Retention periods (recommended)

| Data | Retention | Rationale |
|---|---|---|
| Active conversations | Indefinite | Ongoing business need |
| Archived conversations | 7 years | HIPAA record retention |
| Audit logs | 7 years | HIPAA compliance |
| Contact form submissions | 3 years | Business need |
| Session tokens | Conversation lifetime | Auth purpose only |

### Data deletion

When a conversation is deleted:

1. `ON DELETE CASCADE` removes all related `messages` and `extracted_data` records
2. Audit log entries for the deleted records are **retained** (for compliance)
3. Encrypted column data is destroyed with the row
4. Backups may retain data per PITR retention period

### Right to deletion

To comply with data subject deletion requests:

```sql
-- Delete a specific conversation and all associated data
DELETE FROM conversations WHERE id = <conversation_id>;
-- Cascade deletes messages and extracted_data
-- Audit log entries are preserved
```

---

## Contact

For security questions or to report a vulnerability, contact the development team.
