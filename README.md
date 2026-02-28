# Michelle AI — WordPress Chat Widget Plugin

A full-featured, real-time AI-powered live chat widget for WordPress. Visitors chat with you directly from your website via an animated floating action button. You manage all conversations from the WordPress admin dashboard. When chat is toggled off, the widget automatically becomes a contact form.

---

## Features

| Feature | Details |
|---|---|
| **Live chat widget** | Animated FAB (lower-right), slide-up chat window, per-brand colors |
| **Real-time messaging** | Long-polling (2 s) — no WebSocket server required |
| **OpenAI integration** | Token streaming via SSE, configurable model & system prompt |
| **Quick reply chips** | AI auto-generates 2–3 contextual reply buttons for visitors |
| **AI suggested reply** | Admin sees a pre-generated reply they can send or override |
| **Moderation mode** | Hold AI responses for admin review before the visitor sees them |
| **Auto-reply toggle** | Turn AI replies on/off independently of the rest of chat |
| **Browser notifications** | `window.Notification` alerts for both visitors and admin |
| **Conversation management** | Admin inbox with unread badges, status (active / closed / archived) |
| **Contact form fallback** | When chat is OFF, widget shows a configurable contact form |
| **Branding controls** | Colors, logo, agent name, welcome message — all configurable |
| **Encrypted API key** | OpenAI key stored XOR-encrypted in the WordPress options table |
| **Zero build step** | Pure PHP + Vanilla JS — no npm, no bundler |

---

## Requirements

- **WordPress** 5.6 or later
- **PHP** 7.4 or later (PHP 8.x recommended)
- **MySQL** 5.7 / MariaDB 10.3 or later
- **cURL** enabled in PHP (for OpenAI streaming)
- **Docker + Docker Compose** for local development
- An **OpenAI API key** for AI features (optional — chat works without it)

---

## Local Development Setup

### 1. Clone the repository

```bash
git clone https://github.com/<your-username>/michelle-ai-plugin.git
cd michelle-ai-plugin
```

### 2. Configure environment variables

```bash
cp .env.example .env
```

The defaults work out of the box:

```dotenv
DB_ROOT_PASSWORD=rootpassword
DB_NAME=wordpress
DB_USER=wordpress
DB_PASSWORD=wordpress

WP_PORT=8080   # WordPress → http://localhost:8080
PMA_PORT=8081  # phpMyAdmin → http://localhost:8081
```

### 3. Start Docker

```bash
make up
```

| Container | URL | Purpose |
|---|---|---|
| `michelle_ai_wordpress` | http://localhost:8080 | WordPress + plugin (live-mounted) |
| `michelle_ai_db` | — | MySQL 8.0 |
| `michelle_ai_phpmyadmin` | http://localhost:8081 | Database browser |

### 4. Complete the WordPress installation wizard

Visit **http://localhost:8080** and fill in the 5-step installer:

1. Choose language → **Continue**
2. Enter site title, admin username, strong password, and email
3. Click **Install WordPress** → **Log In**

### 5. Install WP-CLI (one-time)

```bash
make install-wpcli
```

### 6. Activate the plugin

```bash
make activate
```

Or via the WordPress admin: **Plugins → Michelle AI Plugin → Activate**.

On activation, three custom database tables are created:

| Table | Purpose |
|---|---|
| `wp_michelle_ai_conversations` | Chat sessions with visitor info |
| `wp_michelle_ai_messages` | All messages (visitor / admin / AI) |
| `wp_michelle_ai_contacts` | Contact form submissions |

---

## Plugin Configuration

Navigate to **WordPress Admin → Michelle AI → Settings**.

### Tab 1 — Branding

| Setting | Description |
|---|---|
| Widget Title | Text in the chat window header |
| Agent Name | Sender name shown in replies (e.g. "Support", "Michelle") |
| Welcome Message | Auto-sent when a visitor first opens the chat |
| Primary Color | FAB button, header bar, visitor message bubbles |
| Secondary Color | AI / admin reply bubble background |
| Logo / Avatar URL | URL to a square image (leave blank for letter avatar) |

### Tab 2 — Chat

| Setting | Description |
|---|---|
| Chat Enabled | **ON** = live chat widget · **OFF** = contact form |
| Auto Reply | AI automatically replies to each visitor message |
| Moderation Mode | AI responses held for admin approval before delivery |
| Notification Sound | Soft tone plays in admin when a new message arrives |

**Mode matrix:**

| Auto Reply | Moderation | Behaviour |
|---|---|---|
| ON | OFF | AI streams directly to visitor in real time |
| ON | ON | AI writes reply → admin approves → visitor sees it |
| OFF | — | AI suggestion shown only to admin; admin sends manually |

### Tab 3 — AI

| Setting | Description |
|---|---|
| OpenAI API Key | Your `sk-...` key — stored encrypted, masked after first save |
| Model | `gpt-4o-mini` (default), `gpt-4o`, `gpt-4-turbo`, `gpt-3.5-turbo` |
| System Prompt | Instructions defining the AI's personality and scope |
| Context Window | Number of recent messages included in the AI's context |
| Temperature | 0 = deterministic · 1 = creative (0.7 recommended) |

**Example system prompt:**
```
You are a friendly support agent for Acme Corp. Help visitors with product questions, pricing, and troubleshooting. Keep replies concise (2–3 sentences). If you cannot help, offer to connect them with a human.
```

### Tab 4 — Contact Form

Shown when **Chat Enabled** is OFF.

| Setting | Description |
|---|---|
| Form Title | Heading displayed in the widget |
| Field Labels | Customise Name / Address / Email / Message labels |
| Submit Button Label | Text on the submit button |
| Success Message | Shown after a successful submission |
| Notification Email | Where new submission emails are sent (defaults to WP admin email) |

Submissions are saved to `wp_michelle_ai_contacts` **and** emailed to the notification address.

---

## Using the Admin Inbox

Go to **WordPress Admin → Michelle AI → Conversations**.

### Conversations list (left panel)
- Sorted by most recent activity
- **Bold + blue dot** = visitor has sent an unread message
- Browser notification + sound fires when a new message arrives in any conversation

### Conversation detail (right panel)
- Full message thread between visitor and admin/AI
- **Pending approval badge** — appears on AI messages when Moderation Mode is ON; click **✓ Approve & Send** to deliver
- **AI Suggested Reply** box — click **↻ Regenerate** to get a fresh draft, edit it, then click **Send This Reply**
- **Reply textarea** — type your own message and press **Send** or `Enter`
- **Status dropdown** — set conversation to Active / Closed / Archived

---

## Frontend Widget (Visitor View)

1. **FAB button** appears in the bottom-right corner of every page
2. **Pulse ring** around the FAB when there is an unread reply
3. Click FAB → chat window **slides up** with a smooth animation
4. Type a message, press `Enter` or click the send arrow
5. **Typing indicator** (animated dots) while AI is thinking
6. **AI reply streams in token by token** — no waiting for the full response
7. **Quick reply chips** appear below AI messages — click one to instantly send
8. **Browser notification** fires when a reply arrives while the window is out of focus

The visitor's session token is stored in `localStorage` so conversations persist across page navigations within the same browser.

---

## Development Commands

```bash
make up               # Start all Docker containers
make down             # Stop all containers
make restart          # Restart containers
make shell            # Open bash inside the WordPress container
make db-shell         # Open MySQL shell (user: wordpress, db: wordpress)
make logs s=wordpress # Tail logs for a specific service
make ps               # Show container status
make install-wpcli    # Install WP-CLI (run once after first `make up`)
make activate         # Activate the plugin via WP-CLI
make deactivate       # Deactivate the plugin
make wp cmd="..."     # Run any WP-CLI command inside the container
make debug-log        # Tail WordPress debug.log in real time
make clean            # ⚠️  Stop containers AND delete all volumes (destroys data)
```

---

## Project Structure

```
michelle-ai-plugin/
├── plugin/
│   └── michelle-ai-plugin/
│       ├── michelle-ai-plugin.php            # Entry point & constants
│       ├── includes/
│       │   ├── class-michelle-ai.php         # Core — wires all hooks
│       │   ├── class-michelle-ai-loader.php  # Action/filter registry
│       │   ├── class-michelle-ai-activator.php   # DB table creation
│       │   ├── class-michelle-ai-deactivator.php # Deactivation cleanup
│       │   ├── class-michelle-ai-settings.php    # Settings get/save
│       │   ├── class-michelle-ai-db.php          # Database CRUD
│       │   ├── class-michelle-ai-chat.php         # REST API endpoints
│       │   └── class-michelle-ai-ai.php           # OpenAI + SSE streaming
│       ├── admin/
│       │   ├── class-michelle-ai-admin.php        # Admin menus & assets
│       │   └── partials/
│       │       ├── admin-page-conversations.php   # Conversations list
│       │       ├── admin-page-conversation.php    # Single conversation
│       │       └── admin-page-settings.php        # Settings tabs
│       ├── public/
│       │   ├── class-michelle-ai-public.php       # Frontend assets & widget
│       │   └── partials/
│       │       ├── widget.php                     # Chat widget HTML
│       │       └── contact-form.php               # Contact form HTML
│       └── assets/
│           ├── css/
│           │   ├── admin.css    # Admin UI styles
│           │   └── public.css   # Widget styles + animations
│           └── js/
│               ├── admin.js     # Admin: polling, reply, approve, notifications
│               └── public.js    # Widget: FAB, SSE streaming, quick replies
├── config/
│   └── apache-wordpress.conf  # Apache AllowOverride fix (volume-mounted by Docker)
├── docker-compose.yml         # WordPress + MySQL + phpMyAdmin
├── .env                       # Local credentials (gitignored)
├── .env.example               # Credentials template (safe to commit)
├── Makefile                   # Dev shortcuts
└── README.md                  # This file
```

---

## REST API Reference

Base URL: `https://yoursite.com/wp-json/michelle-ai/v1`

### Visitor endpoints (authenticate via `X-Chat-Token` header)

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/conversations` | Start session. Returns `conversation_id` + `token`. |
| `GET` | `/conversations/{id}/messages` | Poll messages. Add `?since=<datetime>` for incremental fetch. |
| `POST` | `/conversations/{id}/messages` | Send a visitor message. |
| `GET` | `/conversations/{id}/stream` | SSE — streams AI tokens in real time. |
| `POST` | `/contact` | Submit contact form (chat=OFF mode). |
| `GET` | `/widget-config` | Public branding/config (no auth). |

### Admin endpoints (`X-WP-Nonce` header + `manage_options` capability)

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/admin/conversations` | List all conversations with unread flag. |
| `GET` | `/admin/conversations/{id}` | Get conversation + messages; clears unread flag. |
| `POST` | `/admin/conversations/{id}/messages` | Admin sends a reply. |
| `POST` | `/admin/conversations/{id}/suggest` | Generate an AI suggested reply. |
| `PATCH` | `/admin/conversations/{id}` | Update status (active/closed/archived). |
| `POST` | `/admin/messages/{id}/approve` | Approve a pending-moderation message. |
| `GET` | `/admin/settings` | Get current settings (API key masked). |
| `POST` | `/admin/settings` | Save settings. |

---

## Troubleshooting

### Widget renders but messages won't send
WordPress REST API requires pretty permalinks.
**Fix:** In the WordPress admin, go to **Settings → Permalinks**, choose any non-plain structure (e.g. "Post name"), and save. The `config/apache-wordpress.conf` Docker volume mount handles this automatically on container restart.

### AI replies aren't appearing
1. Confirm your OpenAI API key is saved in **Michelle AI → Settings → AI**
2. Ensure **Auto Reply** is ON
3. Verify cURL is enabled: `docker exec michelle_ai_wordpress php -m | grep curl`
4. Check the debug log: `make debug-log`

### Contact form emails not arriving in production
WordPress uses PHP `mail()` by default, which many hosts block. Install [WP Mail SMTP](https://wordpress.org/plugins/wp-mail-smtp/) and configure it to use Gmail, SendGrid, Mailgun, or any SMTP provider.

### Fresh start / reset everything
```bash
make clean   # deletes all Docker volumes — all WordPress data is lost
make up      # rebuild from scratch
```
Re-run the WordPress installer at http://localhost:8080.

---

## Security Notes

- OpenAI API key is XOR-encrypted using WordPress's `AUTH_KEY` constant
- All visitor REST endpoints validate session tokens stored as transients (24 h TTL)
- Admin endpoints require `manage_options` capability + REST nonce
- All user input is sanitized via `sanitize_text_field()` / `sanitize_textarea_field()`
- Contact form includes IP-based rate limiting (5 submissions per IP per hour)
- Run WordPress behind HTTPS in production — `window.Notification` requires a secure context

---

## Production Deployment

1. Copy `plugin/michelle-ai-plugin/` to your server's `wp-content/plugins/`
2. Activate: **Plugins → Activate** (or `wp plugin activate michelle-ai-plugin`)
3. Ensure your web server supports WordPress pretty permalinks:
   - **Apache**: `AllowOverride All` in your VirtualHost (WordPress `.htaccess` handles the rest)
   - **Nginx**: Add `try_files $uri $uri/ /index.php?$args;` inside your `location /` block
4. Configure settings under **Michelle AI → Settings**
5. Set up HTTPS — required for browser notifications in production

---

## License

GPL-2.0-or-later — [GNU General Public License v2](https://www.gnu.org/licenses/gpl-2.0.html)
