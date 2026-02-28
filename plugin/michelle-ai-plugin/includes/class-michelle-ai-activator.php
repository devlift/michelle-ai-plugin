<?php
/**
 * Fired during plugin activation.
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

class Michelle_AI_Activator {

    public static function activate() {
        self::create_tables();
        self::set_default_options();
        flush_rewrite_rules();
    }

    private static function create_tables() {
        global $wpdb;
        $c = $wpdb->get_charset_collate();

        require_once ABSPATH . 'wp-admin/includes/upgrade.php';

        // Conversations
        dbDelta( "CREATE TABLE IF NOT EXISTS {$wpdb->prefix}michelle_ai_conversations (
            id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            session_token   VARCHAR(64)  NOT NULL,
            visitor_name    VARCHAR(255) NOT NULL DEFAULT '',
            visitor_email   VARCHAR(255) NOT NULL DEFAULT '',
            visitor_ip      VARCHAR(45)  NOT NULL DEFAULT '',
            status          ENUM('active','closed','archived') NOT NULL DEFAULT 'active',
            unread_admin    TINYINT(1)   NOT NULL DEFAULT 0,
            last_message_at DATETIME     DEFAULT NULL,
            created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            UNIQUE KEY session_token (session_token),
            KEY status (status),
            KEY last_message_at (last_message_at)
        ) $c;" );

        // Messages
        dbDelta( "CREATE TABLE IF NOT EXISTS {$wpdb->prefix}michelle_ai_messages (
            id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            conversation_id BIGINT UNSIGNED NOT NULL,
            sender_type     ENUM('visitor','admin','ai') NOT NULL,
            content         LONGTEXT        NOT NULL,
            quick_replies   JSON            DEFAULT NULL,
            is_pending_mod  TINYINT(1)      NOT NULL DEFAULT 0,
            ai_suggestion   TEXT            DEFAULT NULL,
            created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            KEY conversation_id (conversation_id),
            KEY created_at (created_at)
        ) $c;" );

        // Contact form submissions
        dbDelta( "CREATE TABLE IF NOT EXISTS {$wpdb->prefix}michelle_ai_contacts (
            id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            name         VARCHAR(255) NOT NULL,
            address      TEXT         NOT NULL DEFAULT '',
            email        VARCHAR(255) NOT NULL,
            message      LONGTEXT     NOT NULL,
            submitted_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id)
        ) $c;" );
    }

    private static function set_default_options() {
        add_option( 'michelle_ai_version', MICHELLE_AI_VERSION );
        if ( ! get_option( 'michelle_ai_settings' ) ) {
            add_option( 'michelle_ai_settings', Michelle_AI_Settings::defaults() );
        }
    }
}
