<?php
/**
 * Settings manager — single source of truth for all plugin options.
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

class Michelle_AI_Settings {

    const OPTION_KEY = 'michelle_ai_settings';

    /**
     * Full default settings structure.
     */
    public static function defaults() {
        return [
            // Branding
            'widget_title'     => 'Chat with us',
            'agent_name'       => 'Support',
            'welcome_message'  => 'Hi there! How can we help you today?',
            'primary_color'    => '#2563eb',
            'secondary_color'  => '#f1f5f9',
            'logo_url'         => '',
            'fab_icon'         => 'bubble', // bubble | dots | message

            // Chat
            'widget_visible'   => true,
            'chat_enabled'     => true,
            'auto_reply'       => true,
            'moderation_mode'  => false,
            'notification_sound' => true,

            // AI
            'openai_api_key'   => '',
            'openai_model'     => 'gpt-5-mini',
            'system_prompt'    => 'You are a helpful and friendly customer support assistant. Be concise and professional.',
            'context_messages' => 10,
            'temperature'      => 0.7,

            // Audio
            'audio_enabled'   => false,
            'audio_api_key'   => '',
            'audio_agent_id'  => '',

            // Data extraction
            'extraction_enabled'    => false,
            'extraction_properties' => [],

            // Document templates
            'document_templates'  => [],
            'letterhead_url'      => '',

            // Contact form
            'form_title'          => 'Send us a message',
            'form_label_name'     => 'Your Name',
            'form_label_address'  => 'Address (optional)',
            'form_label_email'    => 'Email Address',
            'form_label_message'  => 'Message',
            'form_submit_label'   => 'Send Message',
            'form_success_msg'    => 'Thanks! We\'ll be in touch soon.',
            'form_notify_email'   => get_option( 'admin_email' ),
        ];
    }

    /**
     * Get all settings, merged with defaults.
     */
    public static function all() {
        $saved = get_option( self::OPTION_KEY, [] );
        return array_merge( self::defaults(), (array) $saved );
    }

    /**
     * Get a single setting value.
     */
    public static function get( $key, $fallback = null ) {
        $all = self::all();
        return array_key_exists( $key, $all ) ? $all[ $key ] : $fallback;
    }

    /**
     * Save an array of settings (merged with existing).
     */
    public static function save( array $data ) {
        $current = self::all();
        $updated = array_merge( $current, $data );
        // Only encrypt the API key when it is actually being changed (present in $data).
        // Otherwise the already-encrypted value from the DB would get re-encrypted.
        if ( array_key_exists( 'openai_api_key', $data ) && $data['openai_api_key'] !== '' ) {
            $updated['openai_api_key'] = self::encrypt( $data['openai_api_key'] );
        }
        if ( array_key_exists( 'audio_api_key', $data ) && $data['audio_api_key'] !== '' ) {
            $updated['audio_api_key'] = self::encrypt( $data['audio_api_key'] );
        }
        update_option( self::OPTION_KEY, $updated );
    }

    /**
     * Get the decrypted OpenAI API key.
     */
    public static function get_api_key() {
        $raw = self::get( 'openai_api_key', '' );
        return $raw ? self::decrypt( $raw ) : '';
    }

    /**
     * Get the decrypted audio API key.
     */
    public static function get_audio_api_key() {
        $raw = self::get( 'audio_api_key', '' );
        return $raw ? self::decrypt( $raw ) : '';
    }

    // -------------------------------------------------------------------------
    // Simple XOR encryption using AUTH_KEY (not cryptographically strong but
    // keeps the key out of plain sight in the DB).
    // -------------------------------------------------------------------------

    private static function encrypt( $value ) {
        $key    = defined( 'AUTH_KEY' ) ? AUTH_KEY : 'michelle-ai-fallback-key';
        $result = '';
        for ( $i = 0; $i < strlen( $value ); $i++ ) {
            $result .= chr( ord( $value[ $i ] ) ^ ord( $key[ $i % strlen( $key ) ] ) );
        }
        return base64_encode( $result );
    }

    private static function decrypt( $value ) {
        $key    = defined( 'AUTH_KEY' ) ? AUTH_KEY : 'michelle-ai-fallback-key';
        $value  = base64_decode( $value );
        $result = '';
        for ( $i = 0; $i < strlen( $value ); $i++ ) {
            $result .= chr( ord( $value[ $i ] ) ^ ord( $key[ $i % strlen( $key ) ] ) );
        }
        return $result;
    }
}
