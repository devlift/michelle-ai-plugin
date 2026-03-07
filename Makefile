.PHONY: up down restart logs shell db-shell ps clean seed snapshot \
       supabase-start supabase-stop supabase-status supabase-reset \
       supabase-functions supabase-diff supabase-new-migration \
       supabase-studio set-openai-key dev dev-down status

## Start the WordPress environment
up:
	docker-compose up -d
	@echo ""
	@echo "WordPress: http://localhost:$$(grep WP_PORT .env | cut -d= -f2)"
	@echo "phpMyAdmin: http://localhost:$$(grep PMA_PORT .env | cut -d= -f2)"

## Stop the environment
down:
	docker-compose down

## Restart all services
restart:
	docker-compose restart

## Tail logs (use: make logs s=wordpress)
logs:
	docker-compose logs -f $(s)

## Open a shell in the WordPress container
shell:
	docker exec -it michelle_ai_wordpress bash

## Open a MySQL shell
db-shell:
	docker exec -it michelle_ai_db mysql -u wordpress -pwordpress wordpress

## Show running containers
ps:
	docker-compose ps

## Stop and remove volumes (WARNING: deletes all data)
clean:
	docker-compose down -v
	@echo "All volumes removed."

## Install WP-CLI in the WordPress container (run once)
install-wpcli:
	docker exec michelle_ai_wordpress bash -c "\
		curl -O https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar && \
		chmod +x wp-cli.phar && \
		mv wp-cli.phar /usr/local/bin/wp"

## Run WP-CLI command (use: make wp cmd="plugin list")
wp:
	docker exec -it --user www-data michelle_ai_wordpress wp $(cmd) --allow-root

## Activate the plugin
activate:
	docker exec --user www-data michelle_ai_wordpress wp plugin activate michelle-ai-plugin --allow-root

## Deactivate the plugin
deactivate:
	docker exec --user www-data michelle_ai_wordpress wp plugin deactivate michelle-ai-plugin --allow-root

## Tail WordPress debug log
debug-log:
	docker exec michelle_ai_wordpress tail -f /var/www/html/wp-content/debug.log

## Seed the database with content, settings, and plugins (run after `make up`)
seed:
	bash seed/seed.sh

## Snapshot current local DB into seed/database.sql (run before committing)
snapshot:
	docker-compose exec -T db mysqldump -u wordpress -pwordpress wordpress > seed/database.sql
	@echo "Snapshot saved to seed/database.sql"

# ===========================================================================
# Supabase
# ===========================================================================

## Start local Supabase (DB + API + Studio + Realtime)
supabase-start:
	supabase start
	@echo ""
	@echo "Supabase Studio: http://127.0.0.1:54423"
	@echo "Supabase API:    http://127.0.0.1:54421"
	@echo "Database:        postgresql://postgres:postgres@127.0.0.1:54422/postgres"

## Stop local Supabase
supabase-stop:
	supabase stop

## Show Supabase status
supabase-status:
	supabase status

## Serve Edge Functions locally (hot-reload, no JWT verification)
supabase-functions:
	supabase functions serve --no-verify-jwt

## Reset local DB: re-apply all migrations + seed data
supabase-reset:
	supabase db reset

## Show schema diff between local DB and migrations
supabase-diff:
	supabase db diff

## Create a new migration file
supabase-new-migration:
	@if [ -z "$(NAME)" ]; then echo "Usage: make supabase-new-migration NAME=\"description\""; exit 1; fi
	supabase migration new $(NAME)

## Open Supabase Studio in browser
supabase-studio:
	open http://127.0.0.1:54423

## Store OpenAI API key in local Supabase
set-openai-key:
	@if [ -z "$(KEY)" ]; then echo "Usage: make set-openai-key KEY=\"sk-...\""; exit 1; fi
	psql postgresql://postgres:postgres@127.0.0.1:54422/postgres \
		-c "SELECT set_secret('openai_api_key', '$(KEY)');"
	@echo "OpenAI API key stored."

# ===========================================================================
# Full Stack
# ===========================================================================

## Start everything (WordPress + Supabase + Edge Functions)
dev:
	@echo "Starting WordPress..."
	docker-compose up -d
	@echo ""
	@echo "Starting Supabase..."
	supabase start
	@echo ""
	@echo "Starting Edge Functions (background)..."
	supabase functions serve --no-verify-jwt &
	@echo ""
	@echo "=== All services running ==="
	@echo "WordPress:       http://localhost:$$(grep WP_PORT .env | cut -d= -f2)"
	@echo "phpMyAdmin:      http://localhost:$$(grep PMA_PORT .env | cut -d= -f2)"
	@echo "Supabase Studio: http://127.0.0.1:54423"
	@echo "Supabase API:    http://127.0.0.1:54421"
	@echo "Edge Functions:  http://127.0.0.1:54421/functions/v1/"

## Stop everything
dev-down:
	@echo "Stopping Edge Functions..."
	-pkill -f "supabase functions serve" 2>/dev/null
	@echo "Stopping Supabase..."
	-supabase stop 2>/dev/null
	@echo "Stopping WordPress..."
	docker-compose down

## Show status of all services
status:
	@echo "=== WordPress ==="
	@docker-compose ps 2>/dev/null || echo "  Not running"
	@echo ""
	@echo "=== Supabase ==="
	@supabase status 2>/dev/null || echo "  Not running"
	@echo ""
	@echo "=== Edge Functions ==="
	@pgrep -f "supabase functions serve" > /dev/null 2>&1 && echo "  Serving" || echo "  Not running"
