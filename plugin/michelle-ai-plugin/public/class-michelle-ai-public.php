<?php
/**
 * Public-facing functionality — assets and widget injection.
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

class Michelle_AI_Public {

    public function enqueue_styles() {
        wp_enqueue_style(
            'michelle-ai-public',
            MICHELLE_AI_PLUGIN_URL . 'assets/css/public.css',
            [],
            MICHELLE_AI_VERSION
        );
    }

    public function enqueue_scripts() {
        wp_enqueue_script(
            'michelle-ai-public',
            MICHELLE_AI_PLUGIN_URL . 'assets/js/public.js',
            [],
            MICHELLE_AI_VERSION,
            true
        );

        $chat_enabled = (bool) Michelle_AI_Settings::get( 'chat_enabled', true );

        wp_localize_script( 'michelle-ai-public', 'michelleAICfg', [
            'restUrl'     => esc_url_raw( rest_url( 'michelle-ai/v1' ) ),
            'chatEnabled' => $chat_enabled,
            'widgetTitle' => Michelle_AI_Settings::get( 'widget_title', 'Chat with us' ),
            'agentName'   => Michelle_AI_Settings::get( 'agent_name', 'Support' ),
            'logoUrl'     => Michelle_AI_Settings::get( 'logo_url', '' ),
        ] );
    }

    public function render_widget() {
        $chat_enabled = (bool) Michelle_AI_Settings::get( 'chat_enabled', true );

        if ( $chat_enabled ) {
            include MICHELLE_AI_PLUGIN_DIR . 'public/partials/widget.php';
        } else {
            include MICHELLE_AI_PLUGIN_DIR . 'public/partials/contact-form.php';
        }
    }
}
