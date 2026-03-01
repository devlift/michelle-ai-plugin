<?php
/**
 * REST API route registration and handler logic for the chat system.
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

class Michelle_AI_Chat {

    const NS = 'michelle-ai/v1';

    public function register_routes() {
        // ── Visitor (public) endpoints ────────────────────────────────────────

        register_rest_route( self::NS, '/conversations', [
            'methods'             => 'POST',
            'callback'            => [ $this, 'start_conversation' ],
            'permission_callback' => '__return_true',
        ] );

        register_rest_route( self::NS, '/conversations/(?P<id>\d+)/messages', [
            [
                'methods'             => 'GET',
                'callback'            => [ $this, 'get_messages' ],
                'permission_callback' => [ $this, 'verify_visitor_token' ],
                'args'                => [
                    'since' => [
                        'type'              => 'string',
                        'sanitize_callback' => 'sanitize_text_field',
                        'default'           => '',
                    ],
                ],
            ],
            [
                'methods'             => 'POST',
                'callback'            => [ $this, 'send_visitor_message' ],
                'permission_callback' => [ $this, 'verify_visitor_token' ],
            ],
        ] );

        // SSE stream — visitor polls this to receive AI token stream
        register_rest_route( self::NS, '/conversations/(?P<id>\d+)/stream', [
            'methods'             => 'GET',
            'callback'            => [ $this, 'stream_ai_response' ],
            'permission_callback' => [ $this, 'verify_visitor_token' ],
        ] );

        // Contact form
        register_rest_route( self::NS, '/contact', [
            'methods'             => 'POST',
            'callback'            => [ $this, 'submit_contact_form' ],
            'permission_callback' => '__return_true',
        ] );

        // ── Admin endpoints ───────────────────────────────────────────────────

        register_rest_route( self::NS, '/admin/conversations', [
            'methods'             => 'GET',
            'callback'            => [ $this, 'admin_list_conversations' ],
            'permission_callback' => [ $this, 'require_admin' ],
        ] );

        register_rest_route( self::NS, '/admin/conversations/(?P<id>\d+)', [
            [
                'methods'             => 'GET',
                'callback'            => [ $this, 'admin_get_conversation' ],
                'permission_callback' => [ $this, 'require_admin' ],
            ],
            [
                'methods'             => 'PATCH',
                'callback'            => [ $this, 'admin_update_conversation' ],
                'permission_callback' => [ $this, 'require_admin' ],
            ],
        ] );

        register_rest_route( self::NS, '/admin/conversations/(?P<id>\d+)/messages', [
            [
                'methods'             => 'GET',
                'callback'            => [ $this, 'admin_get_messages' ],
                'permission_callback' => [ $this, 'require_admin' ],
            ],
            [
                'methods'             => 'POST',
                'callback'            => [ $this, 'admin_send_message' ],
                'permission_callback' => [ $this, 'require_admin' ],
            ],
        ] );

        register_rest_route( self::NS, '/admin/conversations/(?P<id>\d+)/suggest', [
            'methods'             => 'POST',
            'callback'            => [ $this, 'admin_regenerate_suggestion' ],
            'permission_callback' => [ $this, 'require_admin' ],
        ] );

        register_rest_route( self::NS, '/admin/messages/(?P<id>\d+)/approve', [
            'methods'             => 'POST',
            'callback'            => [ $this, 'admin_approve_message' ],
            'permission_callback' => [ $this, 'require_admin' ],
        ] );

        // Settings
        register_rest_route( self::NS, '/admin/settings', [
            [
                'methods'             => 'GET',
                'callback'            => [ $this, 'admin_get_settings' ],
                'permission_callback' => [ $this, 'require_admin' ],
            ],
            [
                'methods'             => 'POST',
                'callback'            => [ $this, 'admin_save_settings' ],
                'permission_callback' => [ $this, 'require_admin' ],
            ],
        ] );

        // Audio signed URL (public, rate-limited)
        register_rest_route( self::NS, '/audio/signed-url', [
            'methods'             => 'GET',
            'callback'            => [ $this, 'audio_signed_url' ],
            'permission_callback' => '__return_true',
        ] );

        // Widget config (public — branding data for frontend)
        register_rest_route( self::NS, '/widget-config', [
            'methods'             => 'GET',
            'callback'            => [ $this, 'widget_config' ],
            'permission_callback' => '__return_true',
        ] );
    }

    // =========================================================================
    // Permission callbacks
    // =========================================================================

    public function require_admin( $request ) {
        return current_user_can( 'manage_options' );
    }

    /**
     * Visitor token auth: expects X-Chat-Token header or `token` query param.
     * Token is stored as a transient for 24 h.
     */
    public function verify_visitor_token( $request ) {
        $token = $request->get_header( 'X-Chat-Token' )
            ?? sanitize_text_field( $request->get_param( 'token' ) ?? '' );
        if ( ! $token ) {
            return new WP_Error( 'no_token', 'Missing chat token', [ 'status' => 401 ] );
        }

        $conv_id = (int) $request->get_param( 'id' );
        $stored  = get_transient( 'michelle_ai_token_' . $token );

        if ( ! $stored || (int) $stored !== $conv_id ) {
            return new WP_Error( 'invalid_token', 'Invalid or expired token', [ 'status' => 403 ] );
        }

        return true;
    }

    // =========================================================================
    // Visitor endpoints
    // =========================================================================

    public function start_conversation( $request ) {
        $params = $request->get_json_params() ?: [];

        $result = Michelle_AI_DB::create_conversation( [
            'visitor_name'  => sanitize_text_field( $params['name'] ?? '' ),
            'visitor_email' => sanitize_email( $params['email'] ?? '' ),
            'visitor_ip'    => sanitize_text_field( $_SERVER['REMOTE_ADDR'] ?? '' ),
        ] );

        // Store token → conversation_id mapping in transient (24h)
        set_transient(
            'michelle_ai_token_' . $result['session_token'],
            $result['id'],
            DAY_IN_SECONDS
        );

        // Send welcome message if configured
        $welcome = Michelle_AI_Settings::get( 'welcome_message', '' );
        if ( $welcome ) {
            Michelle_AI_DB::add_message( $result['id'], 'ai', $welcome );
        }

        return rest_ensure_response( [
            'conversation_id' => $result['id'],
            'token'           => $result['session_token'],
        ] );
    }

    public function get_messages( $request ) {
        $conv_id   = (int) $request->get_param( 'id' );
        $since     = sanitize_text_field( $request->get_param( 'since' ) ?? '' );
        $before_id = $request->get_param( 'before' ) ? (int) $request->get_param( 'before' ) : null;
        $limit     = $request->get_param( 'limit' ) ? (int) $request->get_param( 'limit' ) : null;

        if ( $before_id || $limit ) {
            // Paginated request — initial load (limit only) or "load older" (before + limit)
            $rows    = Michelle_AI_DB::get_messages_page( $conv_id, $limit ?: 30, $before_id );
            $visible = array_filter( $rows, fn( $r ) => ! $r->is_pending_mod );
            return rest_ensure_response( [
                'messages'  => array_values( array_map( [ Michelle_AI_DB::class, 'format_message' ], $visible ) ),
                'has_older' => count( $rows ) >= ( $limit ?: 30 ),
            ] );
        }

        $rows = Michelle_AI_DB::get_messages( $conv_id, $since ?: null );

        // Filter out pending-moderation messages for visitors
        $visible = array_filter( $rows, fn( $r ) => ! $r->is_pending_mod );

        return rest_ensure_response( array_values( array_map(
            [ Michelle_AI_DB::class, 'format_message' ],
            $visible
        ) ) );
    }

    public function send_visitor_message( $request ) {
        $conv_id = (int) $request->get_param( 'id' );
        $params  = $request->get_json_params() ?: [];
        $content = sanitize_textarea_field( $params['content'] ?? '' );

        if ( ! $content ) {
            return new WP_Error( 'empty_message', 'Message cannot be empty', [ 'status' => 400 ] );
        }

        // Save visitor message
        Michelle_AI_DB::add_message( $conv_id, 'visitor', $content );

        // Trigger AI pipeline — the SSE stream endpoint delivers the response in real time.
        // Also schedule a cron fallback in case the SSE stream isn't opened.
        $auto_reply = Michelle_AI_Settings::get( 'auto_reply', true );
        $api_key    = Michelle_AI_Settings::get_api_key();

        if ( $auto_reply && $api_key ) {
            wp_schedule_single_event( time() + 5, 'michelle_ai_generate_response', [ $conv_id ] );
        }

        // Run data extraction immediately on the visitor's message.
        // This ensures names/data are captured even if the AI response fails.
        Michelle_AI::maybe_extract_data( $conv_id );

        return rest_ensure_response( [ 'ok' => true ] );
    }

    /**
     * SSE endpoint — streams the latest AI response for a conversation.
     * The client opens this right after sending a message.
     */
    public function stream_ai_response( $request ) {
        $conv_id = (int) $request->get_param( 'id' );

        // Get conversation + build message history
        $db_messages = Michelle_AI_DB::get_messages( $conv_id );
        $api_messages = Michelle_AI_AI::build_messages_for_api( $db_messages );

        $api_key = Michelle_AI_Settings::get_api_key();
        $auto    = Michelle_AI_Settings::get( 'auto_reply', true );
        $mod     = Michelle_AI_Settings::get( 'moderation_mode', false );

        // SSE headers — must be sent before any output
        if ( ob_get_level() ) {
            ob_end_clean();
        }
        header( 'Content-Type: text/event-stream' );
        header( 'Cache-Control: no-cache' );
        header( 'Connection: keep-alive' );
        header( 'X-Accel-Buffering: no' );
        if ( function_exists( 'apache_setenv' ) ) {
            apache_setenv( 'no-gzip', 1 );
        }
        ini_set( 'zlib.output_compression', 'Off' );

        if ( ! $api_key || ! $auto ) {
            echo "data: [DONE]\n\n";
            flush();
            exit;
        }

        $model       = Michelle_AI_Settings::get( 'openai_model', 'gpt-4o-mini' );
        $temperature = (float) Michelle_AI_Settings::get( 'temperature', 0.7 );
        $system      = Michelle_AI_Settings::get( 'system_prompt', '' );

        $payload_messages = [];
        if ( $system ) {
            $payload_messages[] = [ 'role' => 'system', 'content' => $system ];
        }
        foreach ( $api_messages as $m ) {
            $payload_messages[] = $m;
        }

        $body = [
            'model'       => $model,
            'messages'    => $payload_messages,
            'temperature' => $temperature,
            'stream'      => true,
        ];

        // Collect full text while streaming
        $full_text = '';

        $ch = curl_init( Michelle_AI_AI::API_BASE . '/chat/completions' );
        curl_setopt_array( $ch, [
            CURLOPT_POST          => true,
            CURLOPT_HTTPHEADER    => [
                'Authorization: Bearer ' . $api_key,
                'Content-Type: application/json',
                'Accept: text/event-stream',
            ],
            CURLOPT_POSTFIELDS    => wp_json_encode( $body ),
            CURLOPT_RETURNTRANSFER => false,
            CURLOPT_WRITEFUNCTION => function ( $ch, $data ) use ( &$full_text ) {
                $lines = explode( "\n", $data );
                foreach ( $lines as $line ) {
                    $line = trim( $line );
                    if ( strpos( $line, 'data: ' ) !== 0 ) {
                        continue;
                    }
                    $payload = substr( $line, 6 );
                    if ( $payload === '[DONE]' ) {
                        // Don't send [DONE] yet — we'll send it after quick
                        // replies are generated so the client stays connected.
                        continue;
                    }
                    $json  = json_decode( $payload, true );
                    $token = $json['choices'][0]['delta']['content'] ?? null;
                    if ( $token !== null ) {
                        $full_text .= $token;
                        echo 'data: ' . wp_json_encode( [ 'token' => $token ] ) . "\n\n";
                        flush();
                    }
                }
                return strlen( $data );
            },
            CURLOPT_TIMEOUT => 120,
        ] );

        $curl_ok = curl_exec( $ch );
        if ( $curl_ok === false ) {
            error_log( 'Michelle AI: SSE curl error — ' . curl_error( $ch ) );
        }
        $http_code = (int) curl_getinfo( $ch, CURLINFO_HTTP_CODE );
        if ( $http_code >= 400 ) {
            error_log( 'Michelle AI: OpenAI returned HTTP ' . $http_code . ' during SSE stream' );
        }
        curl_close( $ch );

        // Save the completed AI response to DB
        if ( $full_text ) {
            // When auto_reply is on the visitor already received the tokens via
            // the stream, so moderation is skipped. Moderation only applies when
            // auto_reply is off (admin-driven workflow).
            $pending_mod = $mod && ! $auto;
            $msg_id = Michelle_AI_DB::add_message( $conv_id, 'ai', $full_text, [
                'is_pending_mod' => $pending_mod ? 1 : 0,
            ] );

            // Generate quick replies in background (non-streaming call)
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
                    // Push quick replies to client
                    echo 'data: ' . wp_json_encode( [ 'quick_replies' => $quick ] ) . "\n\n";
                    flush();
                }
            }

            // Run data extraction
            Michelle_AI::maybe_extract_data( $conv_id );
        }

        // Send [DONE] last so the client stays connected for quick replies
        echo "data: [DONE]\n\n";
        flush();

        exit;
    }

    public function submit_contact_form( $request ) {
        $params = $request->get_json_params() ?: [];

        // Simple honeypot / rate limit
        $ip    = sanitize_text_field( $_SERVER['REMOTE_ADDR'] ?? '' );
        $count = (int) get_transient( 'michelle_ai_cf_' . md5( $ip ) );
        if ( $count > 5 ) {
            return new WP_Error( 'rate_limited', 'Too many submissions', [ 'status' => 429 ] );
        }
        set_transient( 'michelle_ai_cf_' . md5( $ip ), $count + 1, HOUR_IN_SECONDS );

        $name    = sanitize_text_field( $params['name'] ?? '' );
        $email   = sanitize_email( $params['email'] ?? '' );
        $address = sanitize_textarea_field( $params['address'] ?? '' );
        $message = sanitize_textarea_field( $params['message'] ?? '' );

        if ( ! $name || ! $email || ! $message ) {
            return new WP_Error( 'missing_fields', 'Name, email, and message are required', [ 'status' => 400 ] );
        }
        if ( ! is_email( $email ) ) {
            return new WP_Error( 'invalid_email', 'Invalid email address', [ 'status' => 400 ] );
        }

        Michelle_AI_DB::add_contact( compact( 'name', 'address', 'email', 'message' ) );

        // Email notification
        $notify_email = Michelle_AI_Settings::get( 'form_notify_email', get_option( 'admin_email' ) );
        $site         = get_bloginfo( 'name' );
        wp_mail(
            $notify_email,
            sprintf( '[%s] New contact form submission from %s', $site, $name ),
            sprintf(
                "Name: %s\nEmail: %s\nAddress: %s\n\nMessage:\n%s",
                $name, $email, $address, $message
            )
        );

        return rest_ensure_response( [
            'ok'      => true,
            'message' => Michelle_AI_Settings::get( 'form_success_msg', 'Thanks! We\'ll be in touch soon.' ),
        ] );
    }

    // =========================================================================
    // Admin endpoints
    // =========================================================================

    public function admin_list_conversations( $request ) {
        $rows = Michelle_AI_DB::get_conversations( [
            'limit'  => (int) ( $request->get_param( 'limit' ) ?? 50 ),
            'offset' => (int) ( $request->get_param( 'offset' ) ?? 0 ),
            'status' => $request->get_param( 'status' ),
        ] );

        return rest_ensure_response( array_map(
            [ Michelle_AI_DB::class, 'format_conversation' ],
            $rows
        ) );
    }

    public function admin_get_conversation( $request ) {
        $conv_id = (int) $request->get_param( 'id' );
        $conv    = Michelle_AI_DB::get_conversation( $conv_id );
        if ( ! $conv ) {
            return new WP_Error( 'not_found', 'Conversation not found', [ 'status' => 404 ] );
        }

        Michelle_AI_DB::mark_read( $conv_id );

        $messages       = Michelle_AI_DB::get_messages( $conv_id );
        $extracted_data = Michelle_AI_DB::get_extracted_data( $conv_id );

        $extracted = [];
        foreach ( $extracted_data as $ed ) {
            $extracted[ $ed->property_key ] = $ed->property_value;
        }

        return rest_ensure_response( [
            'conversation'   => Michelle_AI_DB::format_conversation( $conv ),
            'messages'       => array_map( [ Michelle_AI_DB::class, 'format_message' ], $messages ),
            'extracted_data' => $extracted,
        ] );
    }

    public function admin_update_conversation( $request ) {
        $conv_id = (int) $request->get_param( 'id' );
        $params  = $request->get_json_params() ?: [];

        $allowed = [ 'status' ];
        $update  = [];
        foreach ( $allowed as $field ) {
            if ( isset( $params[ $field ] ) ) {
                $update[ $field ] = sanitize_text_field( $params[ $field ] );
            }
        }

        if ( $update ) {
            Michelle_AI_DB::update_conversation( $conv_id, $update );
        }

        return rest_ensure_response( [ 'ok' => true ] );
    }

    public function admin_get_messages( $request ) {
        $conv_id   = (int) $request->get_param( 'id' );
        $before_id = $request->get_param( 'before' ) ? (int) $request->get_param( 'before' ) : null;
        $limit     = $request->get_param( 'limit' ) ? (int) $request->get_param( 'limit' ) : 30;

        $rows  = Michelle_AI_DB::get_messages_page( $conv_id, $limit, $before_id );
        $total = Michelle_AI_DB::count_messages( $conv_id );

        return rest_ensure_response( [
            'messages'  => array_map( [ Michelle_AI_DB::class, 'format_message' ], $rows ),
            'total'     => $total,
            'has_older' => $before_id ? ( count( $rows ) >= $limit ) : false,
        ] );
    }

    public function admin_send_message( $request ) {
        $conv_id = (int) $request->get_param( 'id' );
        $params  = $request->get_json_params() ?: [];
        $content = sanitize_textarea_field( $params['content'] ?? '' );

        if ( ! $content ) {
            return new WP_Error( 'empty_message', 'Message cannot be empty', [ 'status' => 400 ] );
        }

        $msg_id = Michelle_AI_DB::add_message( $conv_id, 'admin', $content );

        // Generate an AI suggestion for the NEXT reply (so admin is always ready)
        $db_messages  = Michelle_AI_DB::get_messages( $conv_id );
        $api_messages = Michelle_AI_AI::build_messages_for_api( $db_messages );
        // We'll store suggestion on last visitor message if any — noop for now,
        // admin can trigger manually via /suggest endpoint.

        return rest_ensure_response( [
            'ok'     => true,
            'msg_id' => $msg_id,
        ] );
    }

    public function admin_regenerate_suggestion( $request ) {
        $conv_id = (int) $request->get_param( 'id' );

        $db_messages  = Michelle_AI_DB::get_messages( $conv_id );
        $api_messages = Michelle_AI_AI::build_messages_for_api( $db_messages );
        $suggestion   = Michelle_AI_AI::generate_response( $api_messages, false );

        if ( ! $suggestion ) {
            return new WP_Error( 'ai_error', 'Could not generate suggestion', [ 'status' => 500 ] );
        }

        return rest_ensure_response( [ 'suggestion' => $suggestion ] );
    }

    public function admin_approve_message( $request ) {
        $msg_id = (int) $request->get_param( 'id' );
        $msg    = Michelle_AI_DB::get_message( $msg_id );

        if ( ! $msg ) {
            return new WP_Error( 'not_found', 'Message not found', [ 'status' => 404 ] );
        }

        Michelle_AI_DB::approve_message( $msg_id );

        // Now generate quick replies for the approved message
        $db_messages  = Michelle_AI_DB::get_messages( $msg->conversation_id );
        $api_messages = Michelle_AI_AI::build_messages_for_api( $db_messages );
        $quick        = Michelle_AI_AI::generate_quick_replies( $api_messages );
        if ( $quick ) {
            global $wpdb;
            $wpdb->update(
                Michelle_AI_DB::messages_table(),
                [ 'quick_replies' => wp_json_encode( $quick ) ],
                [ 'id' => $msg_id ],
                [ '%s' ], [ '%d' ]
            );
        }

        return rest_ensure_response( [ 'ok' => true ] );
    }

    public function admin_get_settings( $request ) {
        $settings = Michelle_AI_Settings::all();
        // Mask API keys
        if ( $settings['openai_api_key'] ) {
            $settings['openai_api_key'] = '••••••••';
        }
        if ( $settings['audio_api_key'] ) {
            $settings['audio_api_key'] = '••••••••';
        }
        return rest_ensure_response( $settings );
    }

    public function admin_save_settings( $request ) {
        $params   = $request->get_json_params() ?: [];
        $defaults = array_keys( Michelle_AI_Settings::defaults() );
        $save     = [];

        foreach ( $defaults as $key ) {
            if ( ! array_key_exists( $key, $params ) ) {
                continue;
            }
            $val = $params[ $key ];
            // Don't overwrite keys if masked
            if ( $key === 'openai_api_key' && $val === '••••••••' ) {
                continue;
            }
            if ( $key === 'audio_api_key' && $val === '••••••••' ) {
                continue;
            }
            // Array fields (e.g. extraction_properties)
            if ( $key === 'extraction_properties' ) {
                $save[ $key ] = is_array( $val ) ? $val : [];
                continue;
            }
            $save[ $key ] = is_bool( $val ) ? $val : sanitize_text_field( (string) $val );
            // Textarea fields
            if ( in_array( $key, [ 'system_prompt', 'form_label_message', 'welcome_message' ], true ) ) {
                $save[ $key ] = sanitize_textarea_field( (string) $val );
            }
        }

        Michelle_AI_Settings::save( $save );

        return rest_ensure_response( [ 'ok' => true ] );
    }

    public function audio_signed_url( $request ) {
        // Rate limit: 10 requests per minute per IP
        $ip    = sanitize_text_field( $_SERVER['REMOTE_ADDR'] ?? '' );
        $key   = 'michelle_ai_audio_' . md5( $ip );
        $count = (int) get_transient( $key );
        if ( $count >= 10 ) {
            return new WP_Error( 'rate_limited', 'Too many requests', [ 'status' => 429 ] );
        }
        set_transient( $key, $count + 1, MINUTE_IN_SECONDS );

        $audio_enabled = (bool) Michelle_AI_Settings::get( 'audio_enabled', false );
        if ( ! $audio_enabled ) {
            return new WP_Error( 'disabled', 'Audio conversations are not enabled', [ 'status' => 403 ] );
        }

        $agent_id = Michelle_AI_Settings::get( 'audio_agent_id', '' );
        if ( ! $agent_id ) {
            return new WP_Error( 'not_configured', 'Audio is not fully configured', [ 'status' => 500 ] );
        }

        $api_key = Michelle_AI_Settings::get_audio_api_key();

        // If we have an API key, fetch a signed URL for private agent access
        if ( $api_key ) {
            $url = 'https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=' . urlencode( $agent_id );
            $response = wp_remote_get( $url, [
                'headers' => [
                    'xi-api-key' => $api_key,
                ],
                'timeout' => 10,
            ] );

            if ( is_wp_error( $response ) ) {
                error_log( 'Michelle AI: Audio signed URL request failed — ' . $response->get_error_message() );
                return new WP_Error( 'upstream_error', 'Could not obtain audio session', [ 'status' => 502 ] );
            }

            $code = wp_remote_retrieve_response_code( $response );
            $body = json_decode( wp_remote_retrieve_body( $response ), true );

            if ( $code >= 400 || empty( $body['signed_url'] ) ) {
                error_log( 'Michelle AI: Audio signed URL HTTP ' . $code );
                return new WP_Error( 'upstream_error', 'Could not obtain audio session', [ 'status' => 502 ] );
            }

            return rest_ensure_response( [ 'signed_url' => $body['signed_url'] ] );
        }

        // No API key — return agent_id for public agent fallback
        return rest_ensure_response( [ 'agent_id' => $agent_id ] );
    }

    public function widget_config( $request ) {
        $s = Michelle_AI_Settings::all();
        return rest_ensure_response( [
            'chat_enabled'    => (bool) $s['chat_enabled'],
            'widget_title'    => $s['widget_title'],
            'agent_name'      => $s['agent_name'],
            'welcome_message' => $s['welcome_message'],
            'primary_color'   => $s['primary_color'],
            'secondary_color' => $s['secondary_color'],
            'logo_url'        => $s['logo_url'],
            'fab_icon'        => $s['fab_icon'],
            'audio_enabled'   => (bool) $s['audio_enabled'],
            // Contact form labels
            'form_title'         => $s['form_title'],
            'form_label_name'    => $s['form_label_name'],
            'form_label_address' => $s['form_label_address'],
            'form_label_email'   => $s['form_label_email'],
            'form_label_message' => $s['form_label_message'],
            'form_submit_label'  => $s['form_submit_label'],
            'form_success_msg'   => $s['form_success_msg'],
        ] );
    }
}
