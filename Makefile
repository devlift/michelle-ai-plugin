.PHONY: up down restart logs shell db-shell ps clean seed snapshot

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
