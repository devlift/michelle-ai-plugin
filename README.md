# Michelle AI — WordPress Chat Widget Plugin

A full-featured, real-time AI-powered live chat widget for WordPress. Visitors chat with you directly from your website via an animated floating action button. You manage all conversations from the WordPress admin dashboard. When chat is toggled off, the widget automatically becomes a contact form.

**Data layer powered by Supabase** — all conversation data is stored in a HIPAA-compliant PostgreSQL database with column-level PII encryption, audit logging, and Row Level Security. The WordPress plugin acts as a thin admin UI; the chat widget communicates directly with Supabase Edge Functions.

---

## Features

| Feature | Details |
|---|---|
| **Live chat widget** | Animated FAB (lower-right), slide-up chat window, per-brand colors |
| **Real-time messaging** | Supabase Realtime (WebSocket) with polling fallback |
| **OpenAI integration** | Token streaming via SSE through Edge Functions, configurable model & system prompt |
| **Quick reply chips** | AI auto-generates 2–3 contextual reply buttons for visitors |
| **AI suggested reply** | Admin sees a pre-generated reply they can send or override |
| **Moderation mode** | Hold AI responses for admin review before the visitor sees them |
| **Auto-reply toggle** | Turn AI replies on/off independently of the rest of chat |
| **Browser notifications** | `window.Notification` alerts for both visitors and admin |
| **Conversation management** | Admin inbox with unread badges, status (active / closed / archived) |
| **Contact form fallback** | When chat is OFF, widget shows a configurable contact form |
| **Branding controls** | Colors, logo, agent name, welcome message — all configurable |
| **HIPAA-compliant data** | Column-level PII encryption, audit logging, Canadian data residency |
| **Document templates** | Generate PDFs from conversation data with handlebar placeholders |
| **Zero build step** | Pure PHP + Vanilla JS — no npm, no bundler |

---

## Architecture

```
┌─────────────────────┐     ┌──────────────────────────────┐
│  Chat Widget (JS)   │────▶│  Supabase Edge Functions      │
│  (visitor browser)  │◀────│  (Deno runtime)               │
└─────────────────────┘     │                              │
                            │  ┌─ chat (SSE streaming)     │
┌─────────────────────┐     │  ├─ conversations (CRUD)     │
│  WordPress Admin    │────▶│  ├─ messages (CRUD + approve)│
│  (PHP thin client)  │◀────│  ├─ suggest (AI suggestion)  │
└─────────────────────┘     │  ├─ widget-config (public)   │
                            │  ├─ contacts (form submit)   │
                            │  ├─ settings (admin CRUD)    │
                            │  ├─ generate-pdf (templates) │
                            │  ├─ export-csv (data export) │
                            │  └─ audio-signed-url         │
                            └──────────┬───────────────────┘
                                       │
                            ┌──────────▼───────────────────┐
                            │  Supabase PostgreSQL          │
                            │  (ca-central-1 — Canada)      │
                            │                              │
                            │  ✓ Column-level encryption   │
                            │  ✓ Row Level Security        │
                            │  ✓ Audit logging triggers    │
                            │  ✓ Realtime subscriptions    │
                            └──────────────────────────────┘
```

---

## Prerequisites

Before you begin, make sure you have the following installed:

| Tool | Version | Install |
|---|---|---|
| **Docker Desktop** | 20+ | [docker.com/get-docker](https://docs.docker.com/get-docker/) |
| **Supabase CLI** | 2.70+ | `brew install supabase/tap/supabase` |
| **Git** | 2.30+ | `brew install git` |
| **Make** | Any | Pre-installed on macOS/Linux |

Verify your installations:

```bash
docker --version        # Docker version 28.x.x
supabase --version      # 2.75.0
git --version           # git version 2.x.x
make --version          # GNU Make 3.x or 4.x
```

---

## Local Development Setup

### Step 1: Clone the repository

```bash
git clone https://github.com/devlift/michelle-ai-plugin.git
cd michelle-ai-plugin
```

### Step 2: Configure environment variables

```bash
cp .env.example .env
```

Edit `.env` if you need to change ports. Defaults:

```dotenv
DB_ROOT_PASSWORD=rootpassword
DB_NAME=wordpress
DB_USER=wordpress
DB_PASSWORD=wordpress
WP_PORT=8080       # WordPress → http://localhost:8080
PMA_PORT=8081      # phpMyAdmin → http://localhost:8081
```

### Step 3: Start WordPress (Docker)

```bash
make up
```

This starts WordPress + MySQL + phpMyAdmin. Visit http://localhost:8080, complete the WordPress installation wizard, then activate the plugin:

```bash
make install-wpcli    # One-time: install WP-CLI in the container
make activate         # Activate the Michelle AI plugin
```

### Step 4: Start Supabase (local)

```bash
make supabase-start
```

This runs `supabase start` which:
1. Spins up a local PostgreSQL database on port **54422**
2. Starts the API gateway on port **54421**
3. Starts Supabase Studio (visual DB admin) on port **54423**
4. Starts Mailpit (email testing) on port **54424**
5. Applies all database migrations automatically
6. Seeds the database with test data

> **Note:** These ports are intentionally offset from the Supabase defaults (54321-54324) to avoid conflicts if you have other Supabase projects running locally.

**First time only — after `supabase start` completes:**

The terminal will display authentication keys. You don't need to copy them — the Edge Functions read them from environment variables automatically.

### Step 5: Start Edge Functions

```bash
make supabase-functions
```

This serves all Edge Functions locally at `http://127.0.0.1:54421/functions/v1/`. The functions hot-reload when you edit their source files.

### Step 6: Set your OpenAI API key (optional)

For AI features to work locally, store your API key in the local database:

```bash
make set-openai-key KEY="sk-your-key-here"
```

### Step 7: Verify everything is running

```bash
make status
```

You should see:

| Service | URL | Status |
|---|---|---|
| WordPress | http://localhost:8080 | Running |
| phpMyAdmin | http://localhost:8081 | Running |
| Supabase API | http://127.0.0.1:54421 | Running |
| Supabase Studio | http://127.0.0.1:54423 | Running |
| Edge Functions | http://127.0.0.1:54421/functions/v1/ | Serving |

### Quick test

```bash
# Test the widget config endpoint
curl http://127.0.0.1:54421/functions/v1/widget-config

# Create a test conversation
curl -X POST http://127.0.0.1:54421/functions/v1/conversations \
  -H "Content-Type: application/json" \
  -d '{"name":"Test User","email":"test@example.com"}'
```

---

## Development Commands

### WordPress

```bash
make up               # Start WordPress + MySQL + phpMyAdmin
make down             # Stop WordPress containers
make restart          # Restart WordPress containers
make shell            # Open bash inside the WordPress container
make db-shell         # Open MySQL shell
make logs s=wordpress # Tail logs for a specific service
make activate         # Activate the plugin via WP-CLI
make deactivate       # Deactivate the plugin
make debug-log        # Tail WordPress debug.log
make clean            # ⚠️  Stop containers AND delete volumes (destroys data)
```

### Supabase

```bash
make supabase-start       # Start local Supabase (DB + API + Studio)
make supabase-stop        # Stop local Supabase
make supabase-status      # Show Supabase status and ports
make supabase-functions   # Serve Edge Functions locally (hot-reload)
make supabase-reset       # Reset DB: re-apply all migrations + seed data
make supabase-diff        # Show schema diff (local vs migrations)
make supabase-new-migration NAME="description"  # Create a new migration file
make supabase-studio      # Open Supabase Studio in browser
make set-openai-key KEY="sk-..."  # Store OpenAI API key in local DB
```

### Full stack

```bash
make dev              # Start everything (WordPress + Supabase + Edge Functions)
make dev-down         # Stop everything
make status           # Show status of all services
```

---

## Database Schema

All tables live in Supabase PostgreSQL (not WordPress MySQL).

| Table | Purpose | PII Encrypted |
|---|---|---|
| `conversations` | Chat sessions with visitor info | name, email, IP |
| `messages` | All messages (visitor / admin / AI) | content |
| `extracted_data` | Structured data extracted from conversations | property values |
| `contacts` | Contact form submissions | name, email, address, message |
| `agent_settings` | Plugin configuration (key-value) | — |
| `admin_users` | Maps Supabase auth to admin role | — |
| `audit_log` | HIPAA audit trail of all data operations | — |

### Migrations

Migrations are in `supabase/migrations/` and run in order:

| File | Purpose |
|---|---|
| `20260306000001_core_tables.sql` | Core tables with encrypted PII columns |
| `20260306000002_rls_policies.sql` | Row Level Security policies |
| `20260306000003_audit_logging.sql` | HIPAA audit triggers on all PHI tables |
| `20260306000004_pii_encryption.sql` | `encrypt_pii()` / `decrypt_pii()` functions |
| `20260306000005_realtime.sql` | Enable Realtime on messages + conversations |
| `20260306000006_vault_secrets.sql` | Secret storage and `get_secret()` / `set_secret()` |

### Creating a new migration

```bash
make supabase-new-migration NAME="add_some_column"
# Edit the generated file in supabase/migrations/
make supabase-reset   # Apply it locally
```

---

## Edge Functions

All Edge Functions are in `supabase/functions/`. Each function has its own directory with an `index.ts` entry point. Shared utilities are in `supabase/functions/_shared/`.

| Function | Auth | Description |
|---|---|---|
| `widget-config` | Public | Widget branding and configuration |
| `conversations` | Token / Admin | Create (visitor) or list/update (admin) |
| `messages` | Token / Admin | Get/send messages, approve moderation |
| `chat` | Token | SSE streaming AI response |
| `contacts` | Public (rate-limited) | Contact form submission |
| `suggest` | Admin | Generate AI suggested reply |
| `settings` | Admin | Read/write plugin settings |
| `generate-pdf` | Admin | Document template → print-ready HTML |
| `export-csv` | Admin | Export conversations as CSV |
| `audio-signed-url` | Public (rate-limited) | ElevenLabs audio session URL |

### Shared utilities (`_shared/`)

| File | Purpose |
|---|---|
| `cors.ts` | CORS headers for cross-origin requests |
| `supabase.ts` | Supabase client factory (service role) |
| `auth.ts` | Visitor token + admin JWT validation |
| `openai.ts` | OpenAI API client (streaming + blocking) |
| `encryption.ts` | PII encrypt/decrypt wrappers |

---

## HIPAA Compliance

The Supabase data layer implements the following HIPAA safeguards:

| Control | Implementation |
|---|---|
| **Encryption at rest** | AES-256 (Supabase default) + column-level pgcrypto encryption for all PII |
| **Encryption in transit** | TLS/SSL for all connections |
| **Access control** | Row Level Security — visitors only see their own data |
| **Audit logging** | Triggers on all PHI tables log every INSERT/UPDATE/DELETE |
| **Data residency** | Supabase project hosted in `ca-central-1` (Canada) |
| **Secret management** | API keys stored in `private.encryption_keys`, not in settings |
| **Role separation** | Visitors (token auth) vs Admins (JWT + admin_users table) |

### PII fields and encryption

Every PII field has a corresponding `*_encrypted` bytea column. Edge Functions:
1. **On write**: call `encrypt_pii()` and store in encrypted column; plaintext column is left empty
2. **On read (admin)**: call `decrypt_pii()` to return real values
3. **On read (visitor)**: only returns their own data from the plaintext column

---

## CI/CD Pipeline

The project uses GitHub Actions for automated deployment. On push to `main`:

### 1. Supabase deployment (migrations + Edge Functions)

File: `.github/workflows/deploy-supabase.yml`

- Links to the production Supabase project
- Runs `supabase db push` to apply any new migrations
- Runs `supabase functions deploy` to deploy all Edge Functions
- Secrets stored securely in Supabase (not in environment variables)

### 2. WordPress plugin deployment

File: `.github/workflows/deploy.yml`

- Rsyncs the plugin directory to SiteGround
- Activates the plugin via WP-CLI
- Purges SiteGround cache

### Required GitHub Secrets

For the CI/CD pipelines to work, the following secrets must be configured in the GitHub repository settings (**Settings → Secrets and variables → Actions**):

#### Supabase deployment

| Secret | Description | How to get it |
|---|---|---|
| `SUPABASE_ACCESS_TOKEN` | Supabase CLI personal access token | [supabase.com/dashboard/account/tokens](https://supabase.com/dashboard/account/tokens) |
| `SUPABASE_PROJECT_ID` | Production project reference ID | Supabase dashboard → Project Settings → General |
| `SUPABASE_DB_PASSWORD` | Production database password | Supabase dashboard → Project Settings → Database |

#### SiteGround deployment (existing)

| Secret | Description |
|---|---|
| `SG_SSH_KEY` | SSH private key for SiteGround |
| `SG_SSH_HOST` | SiteGround SSH hostname |
| `SG_SSH_USER` | SiteGround SSH username |
| `SG_SSH_PORT` | SiteGround SSH port (usually 18765) |
| `SG_DEPLOY_PATH` | Path to `wp-content/plugins/` on the server |

---

## Project Structure

```
michelle-ai-plugin/
├── supabase/                          # Supabase project (data layer)
│   ├── config.toml                    # Local dev config (custom ports)
│   ├── seed.sql                       # Test data for local development
│   ├── migrations/
│   │   ├── 20260306000001_core_tables.sql
│   │   ├── 20260306000002_rls_policies.sql
│   │   ├── 20260306000003_audit_logging.sql
│   │   ├── 20260306000004_pii_encryption.sql
│   │   ├── 20260306000005_realtime.sql
│   │   └── 20260306000006_vault_secrets.sql
│   └── functions/
│       ├── _shared/                   # Shared utilities
│       │   ├── cors.ts
│       │   ├── supabase.ts
│       │   ├── auth.ts
│       │   ├── openai.ts
│       │   └── encryption.ts
│       ├── chat/index.ts              # SSE streaming AI responses
│       ├── conversations/index.ts     # Create/list/update conversations
│       ├── messages/index.ts          # Get/send/approve messages
│       ├── widget-config/index.ts     # Public widget configuration
│       ├── contacts/index.ts          # Contact form submissions
│       ├── suggest/index.ts           # AI suggested reply
│       ├── settings/index.ts          # Plugin settings CRUD
│       ├── generate-pdf/index.ts      # Document template rendering
│       ├── export-csv/index.ts        # CSV data export
│       └── audio-signed-url/index.ts  # ElevenLabs audio URL
├── plugin/                            # WordPress plugin (thin client)
│   └── michelle-ai-plugin/
│       ├── michelle-ai-plugin.php     # Entry point
│       ├── includes/
│       │   ├── class-michelle-ai.php
│       │   ├── class-michelle-ai-loader.php
│       │   ├── class-michelle-ai-activator.php
│       │   ├── class-michelle-ai-deactivator.php
│       │   ├── class-michelle-ai-settings.php
│       │   ├── class-michelle-ai-db.php
│       │   ├── class-michelle-ai-chat.php
│       │   └── class-michelle-ai-ai.php
│       ├── admin/
│       │   ├── class-michelle-ai-admin.php
│       │   └── partials/
│       ├── public/
│       │   ├── class-michelle-ai-public.php
│       │   └── partials/
│       └── assets/
│           ├── css/
│           └── js/
├── .github/workflows/
│   ├── deploy.yml                     # WordPress plugin → SiteGround
│   └── deploy-supabase.yml           # Migrations + Edge Functions → Supabase
├── config/
│   └── apache-wordpress.conf
├── docker-compose.yml
├── .env.example
├── Makefile
└── README.md
```

---

## Plugin Configuration

Navigate to **WordPress Admin → Michelle AI → Settings**.

### Tab 1 — Branding

| Setting | Description |
|---|---|
| Widget Title | Text in the chat window header |
| Agent Name | Sender name shown in replies |
| Welcome Message | Auto-sent when a visitor first opens the chat |
| Primary Color | FAB button, header bar, visitor message bubbles |
| Secondary Color | AI / admin reply bubble background |
| Logo / Avatar URL | URL to a square image |

### Tab 2 — Chat

| Setting | Description |
|---|---|
| Chat Enabled | **ON** = live chat widget · **OFF** = contact form |
| Auto Reply | AI automatically replies to each visitor message |
| Moderation Mode | AI responses held for admin approval |
| Notification Sound | Audio alert on new visitor message |

### Tab 3 — AI

| Setting | Description |
|---|---|
| OpenAI API Key | Your `sk-...` key — stored encrypted in Supabase |
| Model | `gpt-4o-mini` (default), `gpt-4o`, etc. |
| System Prompt | Instructions defining the AI's personality |
| Context Window | Number of recent messages in AI context |
| Temperature | 0 = deterministic · 1 = creative |

### Tab 4 — Templates

| Setting | Description |
|---|---|
| Letterhead | Upload an image for document headers |
| Document Templates | Create templates with `{{placeholder}}` variables |

### Tab 5 — Contact Form

Shown when **Chat Enabled** is OFF. Customizable labels, submit button text, success message, and notification email.

---

## Troubleshooting

### Supabase won't start

```bash
# Check if Docker is running
docker info

# Check for port conflicts
lsof -i :54421 -i :54422 -i :54423

# Reset and try again
make supabase-stop
make supabase-start
```

### Edge Functions return "Missing authorization header"

Make sure you're serving with `--no-verify-jwt`:

```bash
make supabase-functions   # This flag is included automatically
```

### Widget renders but messages won't send

1. Check that Edge Functions are running: `curl http://127.0.0.1:54421/functions/v1/widget-config`
2. Check browser console for CORS errors
3. Verify the WordPress plugin is configured to point at the correct Supabase URL

### AI replies aren't appearing

1. Verify your OpenAI API key: `make set-openai-key KEY="sk-..."`
2. Ensure **Auto Reply** is ON in settings
3. Check Edge Function logs in the terminal where `make supabase-functions` is running

### Fresh start / reset everything

```bash
make dev-down         # Stop all services
make clean            # Delete WordPress volumes
make supabase-reset   # Reset Supabase DB
make dev              # Start everything fresh
```

---

## Security Notes

- All PII is encrypted at the column level using AES-256 (pgcrypto)
- Encryption key stored in `private` schema, inaccessible via PostgREST API
- Row Level Security enforced on all tables
- Visitor auth via session tokens validated against the database
- Admin auth via Supabase JWT + `admin_users` table lookup
- Audit triggers log every INSERT/UPDATE/DELETE on PHI tables
- API keys stored in private schema, never exposed in settings responses
- Contact form includes IP-based rate limiting
- Edge Functions handle their own auth (gateway JWT verification disabled)

---

## License

GPL-2.0-or-later — [GNU General Public License v2](https://www.gnu.org/licenses/gpl-2.0.html)
