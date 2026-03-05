#!/bin/bash
#
# Seed the local WordPress database and configure the environment.
# Usage: Called via `make seed` after `make up`
#

set -euo pipefail

CONTAINER_DB="michelle_ai_db"
CONTAINER_WP="michelle_ai_wordpress"
DB_USER="wordpress"
DB_PASS="wordpress"
DB_NAME="wordpress"
SEED_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "==> Waiting for database to be ready..."
until docker exec "$CONTAINER_DB" mysqladmin ping -u root -prootpassword --silent 2>/dev/null; do
    sleep 2
done

echo "==> Importing seed database..."
docker exec -i "$CONTAINER_DB" mysql -u "$DB_USER" -p"$DB_PASS" "$DB_NAME" < "$SEED_DIR/database.sql"

echo "==> Installing WP-CLI (if needed)..."
docker exec "$CONTAINER_WP" bash -c "which wp >/dev/null 2>&1 || (curl -sO https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar && chmod +x wp-cli.phar && mv wp-cli.phar /usr/local/bin/wp)"

echo "==> Clearing sensitive API keys (re-enter via admin settings)..."
docker exec "$CONTAINER_WP" wp eval '
    $s = get_option("michelle_ai_settings", []);
    $s["openai_api_key"] = "";
    $s["audio_api_key"] = "";
    update_option("michelle_ai_settings", $s);
' --allow-root

echo "==> Setting permalink structure..."
docker exec "$CONTAINER_WP" wp rewrite structure '/%postname%/' --allow-root
docker exec "$CONTAINER_WP" wp rewrite flush --allow-root

echo "==> Activating michelle-ai-plugin..."
docker exec "$CONTAINER_WP" wp plugin activate michelle-ai-plugin --allow-root 2>/dev/null || true

echo "==> Flushing cache..."
docker exec "$CONTAINER_WP" wp cache flush --allow-root

echo ""
echo "Seed complete!"
echo "  WordPress: http://localhost:8080/wp-admin"
echo "  Login:     admin / admin"
echo ""
echo "  NOTE: OpenAI and Audio API keys were cleared."
echo "  Re-enter them at: Settings > Michelle AI > AI / Audio tabs."
