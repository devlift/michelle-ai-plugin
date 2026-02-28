<?php
/**
 * Fired during plugin deactivation.
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

class Michelle_AI_Deactivator {

    public static function deactivate() {
        // Cleanup tasks on deactivation (flush rewrite rules, clear caches, etc.)
        flush_rewrite_rules();
    }
}
