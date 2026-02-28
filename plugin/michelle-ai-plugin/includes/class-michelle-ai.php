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
        $chat = new Michelle_AI_Chat();
        $this->loader->add_action( 'rest_api_init', $chat, 'register_routes' );
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

        $db_messages  = Michelle_AI_DB::get_messages( $conv_id );
        $api_messages = Michelle_AI_AI::build_messages_for_api( $db_messages );
        $response     = Michelle_AI_AI::generate_response( $api_messages, false );

        if ( ! $response ) {
            return;
        }

        $mod_mode = Michelle_AI_Settings::get( 'moderation_mode', false );
        $msg_id   = Michelle_AI_DB::add_message( $conv_id, 'ai', $response, [
            'is_pending_mod' => $mod_mode ? 1 : 0,
        ] );

        // Generate quick replies for the response
        if ( ! $mod_mode ) {
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
    }

    // -------------------------------------------------------------------------

    public function run() {
        $this->loader->run();
    }
}
