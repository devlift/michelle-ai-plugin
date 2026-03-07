<?php
/**
 * The core plugin class — wires all hooks.
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

class Michelle_AI {

    protected $loader;

    public function __construct() {
        $this->loader = new Michelle_AI_Loader();
        $this->define_rest_hooks();
        $this->define_admin_hooks();
        $this->define_public_hooks();
        $this->define_cron_hooks();
    }

    // -------------------------------------------------------------------------
    // REST API
    // -------------------------------------------------------------------------
    private function define_rest_hooks() {
        // Supabase proxy handles admin REST endpoints (conversations, messages, settings).
        // Admin JS calls WP REST → PHP proxy → Supabase Edge Functions.
        // Visitor endpoints are now called directly by public.js to Edge Functions.
        $supabase = new Michelle_AI_Supabase();
        $this->loader->add_action( 'rest_api_init', $supabase, 'register_routes' );
    }

    // -------------------------------------------------------------------------
    // Admin
    // -------------------------------------------------------------------------
    private function define_admin_hooks() {
        $admin = new Michelle_AI_Admin();
        $this->loader->add_action( 'admin_enqueue_scripts', $admin, 'enqueue_styles' );
        $this->loader->add_action( 'admin_enqueue_scripts', $admin, 'enqueue_scripts' );
        $this->loader->add_action( 'admin_menu', $admin, 'add_admin_menu' );
    }

    // -------------------------------------------------------------------------
    // Public (frontend)
    // -------------------------------------------------------------------------
    private function define_public_hooks() {
        $public = new Michelle_AI_Public();
        $this->loader->add_action( 'wp_enqueue_scripts', $public, 'enqueue_styles' );
        $this->loader->add_action( 'wp_enqueue_scripts', $public, 'enqueue_scripts' );
        $this->loader->add_action( 'wp_footer',          $public, 'render_widget' );
    }

    // -------------------------------------------------------------------------
    // Cron (async AI response trigger)
    // -------------------------------------------------------------------------
    private function define_cron_hooks() {
        $this->loader->add_action( 'michelle_ai_generate_response', $this, 'handle_ai_response_cron' );
        $this->loader->add_action( 'michelle_ai_extract_data',      $this, 'handle_extraction_cron' );
    }

    /**
     * Called by wp_schedule_single_event after a visitor sends a message.
     * Generates the AI response and saves it to DB (for moderation or direct delivery).
     */
    public function handle_ai_response_cron( $conv_id ) {
        $auto_reply = Michelle_AI_Settings::get( 'auto_reply', true );
        $api_key    = Michelle_AI_Settings::get_api_key();
        if ( ! $auto_reply || ! $api_key ) {
            return;
        }

        $db_messages = Michelle_AI_DB::get_messages( $conv_id );

        // Guard: skip if the SSE stream already saved an AI response after the last visitor message
        if ( ! empty( $db_messages ) ) {
            $last = end( $db_messages );
            if ( $last->sender_type !== 'visitor' ) {
                return;
            }
        }

        $api_messages = Michelle_AI_AI::build_messages_for_api( $db_messages );
        $response     = Michelle_AI_AI::generate_response( $api_messages, false );

        if ( ! $response ) {
            return;
        }

        // When auto_reply is on, skip moderation — the response goes straight to
        // the visitor. Moderation only applies in admin-driven workflows.
        $mod_mode    = Michelle_AI_Settings::get( 'moderation_mode', false );
        $pending_mod = $mod_mode && ! $auto_reply;
        $msg_id      = Michelle_AI_DB::add_message( $conv_id, 'ai', $response, [
            'is_pending_mod' => $pending_mod ? 1 : 0,
        ] );

        // Generate quick replies for the response
        if ( ! $pending_mod ) {
            $all_msgs     = Michelle_AI_DB::get_messages( $conv_id );
            $api_msgs_for = Michelle_AI_AI::build_messages_for_api( $all_msgs );
            $quick        = Michelle_AI_AI::generate_quick_replies( $api_msgs_for );
            if ( $quick ) {
                global $wpdb;
                $wpdb->update(
                    Michelle_AI_DB::messages_table(),
                    [ 'quick_replies' => wp_json_encode( $quick ) ],
                    [ 'id' => $msg_id ],
                    [ '%s' ], [ '%d' ]
                );
            }
        }

        // Run data extraction
        self::maybe_extract_data( $conv_id );
    }

    /**
     * Cron handler: run data extraction for a conversation.
     */
    public function handle_extraction_cron( $conv_id ) {
        self::maybe_extract_data( $conv_id );
    }

    // -------------------------------------------------------------------------
    // Data extraction
    // -------------------------------------------------------------------------

    /**
     * Run data extraction on a conversation if extraction is enabled.
     * Called after AI responses are saved. Updates visitor_name if
     * first_name or last_name are extracted.
     */
    public static function maybe_extract_data( $conv_id ) {
        $enabled    = Michelle_AI_Settings::get( 'extraction_enabled', false );
        $properties = Michelle_AI_Settings::get( 'extraction_properties', [] );

        if ( ! $enabled || ! is_array( $properties ) || empty( $properties ) ) {
            return;
        }

        $db_messages  = Michelle_AI_DB::get_messages( $conv_id );
        $api_messages = Michelle_AI_AI::build_messages_for_api( $db_messages );

        $extracted = Michelle_AI_AI::extract_properties( $api_messages, $properties );

        if ( empty( $extracted ) ) {
            return;
        }

        // Save each extracted property
        foreach ( $extracted as $key => $value ) {
            Michelle_AI_DB::save_extracted_data( $conv_id, $key, $value );
        }

        // Update visitor_name if first_name or last_name were extracted
        $first = Michelle_AI_DB::get_extracted_value( $conv_id, 'first_name' );
        $last  = Michelle_AI_DB::get_extracted_value( $conv_id, 'last_name' );
        if ( $first || $last ) {
            $name = trim( ( $first ?: '' ) . ' ' . ( $last ?: '' ) );
            if ( $name ) {
                Michelle_AI_DB::update_conversation( $conv_id, [ 'visitor_name' => $name ] );
            }
        }
    }

    // -------------------------------------------------------------------------

    public function run() {
        $this->loader->run();
    }
}
