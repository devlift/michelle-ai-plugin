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
            (string) filemtime( MICHELLE_AI_PLUGIN_DIR . 'assets/css/public.css' )
        );
    }

    public function enqueue_scripts() {
        wp_enqueue_script(
            'michelle-ai-public',
            MICHELLE_AI_PLUGIN_URL . 'assets/js/public.js',
            [],
            (string) filemtime( MICHELLE_AI_PLUGIN_DIR . 'assets/js/public.js' ),
            true
        );

        $chat_enabled = (bool) Michelle_AI_Settings::get( 'chat_enabled', true );

        wp_localize_script( 'michelle-ai-public', 'michelleAICfg', [
            'restUrl'     => esc_url_raw( rest_url( 'michelle-ai/v1' ) ),
            'chatEnabled' => $chat_enabled,
            'autoReply'   => (bool) Michelle_AI_Settings::get( 'auto_reply', true ),
            'widgetTitle' => Michelle_AI_Settings::get( 'widget_title', 'Chat with us' ),
            'agentName'   => Michelle_AI_Settings::get( 'agent_name', 'Support' ),
            'logoUrl'     => Michelle_AI_Settings::get( 'logo_url', '' ),
            'audioEnabled' => (bool) Michelle_AI_Settings::get( 'audio_enabled', false ),
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
