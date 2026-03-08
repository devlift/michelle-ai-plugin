<?php
/**
 * Admin-specific functionality — menus, assets, and page routing.
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

class Michelle_AI_Admin {

    public function enqueue_styles( $hook ) {
        if ( strpos( $hook, 'michelle-ai' ) === false ) {
            return;
        }
        wp_enqueue_style(
            'michelle-ai-admin',
            MICHELLE_AI_PLUGIN_URL . 'assets/css/admin.css',
            [],
            (string) filemtime( MICHELLE_AI_PLUGIN_DIR . 'assets/css/admin.css' )
        );
    }

    public function enqueue_scripts( $hook ) {
        if ( strpos( $hook, 'michelle-ai' ) === false ) {
            return;
        }
        // Enqueue WP media uploader for letterhead image upload
        if ( strpos( $hook, 'michelle-ai-settings' ) !== false ) {
            wp_enqueue_media();
        }
        wp_enqueue_script(
            'michelle-ai-admin',
            MICHELLE_AI_PLUGIN_URL . 'assets/js/admin.js',
            [],
            (string) filemtime( MICHELLE_AI_PLUGIN_DIR . 'assets/js/admin.js' ),
            true
        );

        $prop_labels = [];
        $props = Michelle_AI_Settings::get( 'extraction_properties', [] );
        if ( is_array( $props ) ) {
            foreach ( $props as $p ) {
                $prop_labels[ $p['key'] ] = $p['label'] ?? $p['key'];
            }
        }

        wp_localize_script( 'michelle-ai-admin', 'michelleAIAdmin', [
            'restUrl'    => esc_url_raw( rest_url( 'michelle-ai/v1' ) ),
            'nonce'      => wp_create_nonce( 'wp_rest' ),
            'notifSound' => (bool) Michelle_AI_Settings::get( 'notification_sound', true ),
            'propLabels' => $prop_labels,
        ] );
    }

    public function add_admin_menu() {
        add_menu_page(
            __( 'Michelle AI', 'michelle-ai-plugin' ),
            __( 'Michelle AI', 'michelle-ai-plugin' ),
            'manage_options',
            'michelle-ai',
            [ $this, 'render_conversations_page' ],
            'dashicons-format-chat',
            30
        );

        add_submenu_page(
            'michelle-ai',
            __( 'Conversations', 'michelle-ai-plugin' ),
            __( 'Conversations', 'michelle-ai-plugin' ),
            'manage_options',
            'michelle-ai',
            [ $this, 'render_conversations_page' ]
        );

        add_submenu_page(
            'michelle-ai',
            __( 'Contacts', 'michelle-ai-plugin' ),
            __( 'Contacts', 'michelle-ai-plugin' ),
            'manage_options',
            'michelle-ai-contacts',
            [ $this, 'render_contacts_page' ]
        );

        add_submenu_page(
            'michelle-ai',
            __( 'Settings', 'michelle-ai-plugin' ),
            __( 'Settings', 'michelle-ai-plugin' ),
            'manage_options',
            'michelle-ai-settings',
            [ $this, 'render_settings_page' ]
        );
    }

    public function render_conversations_page() {
        if ( ! current_user_can( 'manage_options' ) ) {
            return;
        }
        include MICHELLE_AI_PLUGIN_DIR . 'admin/partials/admin-page-conversations.php';
    }

    public function render_contacts_page() {
        if ( ! current_user_can( 'manage_options' ) ) {
            return;
        }
        include MICHELLE_AI_PLUGIN_DIR . 'admin/partials/admin-page-contacts.php';
    }

    public function render_settings_page() {
        if ( ! current_user_can( 'manage_options' ) ) {
            return;
        }
        include MICHELLE_AI_PLUGIN_DIR . 'admin/partials/admin-page-settings.php';
    }
}
