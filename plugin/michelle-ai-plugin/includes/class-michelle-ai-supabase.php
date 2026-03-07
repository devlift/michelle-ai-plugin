<?php
/**
 * Supabase proxy for admin operations.
 *
 * WordPress admin JS calls WP REST API (nonce-authenticated), and this class
 * forwards those requests to Supabase Edge Functions using the service_role key.
 * This keeps the service_role key server-side and avoids requiring admins to
 * have separate Supabase credentials.
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

class Michelle_AI_Supabase {

    const NS = 'michelle-ai/v1';

    /**
     * Register WP REST routes that proxy to Supabase Edge Functions.
     */
    public function register_routes() {
        // Prevent caching of REST responses
        add_filter( 'rest_post_dispatch', [ $this, 'nocache_headers' ], 10, 3 );

        // ── Admin endpoints (proxy to Supabase) ─────────────────────────────

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
            'callback'            => [ $this, 'admin_suggest' ],
            'permission_callback' => [ $this, 'require_admin' ],
        ] );

        register_rest_route( self::NS, '/admin/messages/(?P<id>\d+)/approve', [
            'methods'             => 'POST',
            'callback'            => [ $this, 'admin_approve_message' ],
            'permission_callback' => [ $this, 'require_admin' ],
        ] );

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

        register_rest_route( self::NS, '/admin/export-csv', [
            'methods'             => 'GET',
            'callback'            => [ $this, 'admin_export_csv' ],
            'permission_callback' => [ $this, 'require_admin' ],
        ] );

        register_rest_route( self::NS, '/admin/retrain', [
            'methods'             => 'POST',
            'callback'            => [ $this, 'admin_retrain' ],
            'permission_callback' => [ $this, 'require_admin' ],
        ] );

        register_rest_route( self::NS, '/admin/conversations/(?P<id>\d+)/generate-pdf', [
            'methods'             => 'GET',
            'callback'            => [ $this, 'admin_generate_pdf' ],
            'permission_callback' => [ $this, 'require_admin' ],
            'args'                => [
                'template' => [
                    'type'              => 'integer',
                    'required'          => true,
                    'sanitize_callback' => 'absint',
                ],
            ],
        ] );
    }

    // =========================================================================
    // Permission
    // =========================================================================

    public function require_admin() {
        return current_user_can( 'manage_options' );
    }

    // =========================================================================
    // Route handlers — each proxies to a Supabase Edge Function
    // =========================================================================

    public function admin_list_conversations( $request ) {
        return $this->proxy( 'GET', '/conversations', [
            'query' => [ 'limit' => 50 ],
        ] );
    }

    public function admin_get_conversation( $request ) {
        $id = (int) $request['id'];

        // Get messages for this conversation
        $messages_resp = $this->call_edge_function( 'GET', '/messages', [
            'query' => [ 'conversation_id' => $id, 'limit' => 50 ],
        ] );

        $messages_data = json_decode( $messages_resp['body'], true );
        $messages = [];
        if ( isset( $messages_data['messages'] ) ) {
            $messages = $messages_data['messages'];
        } elseif ( is_array( $messages_data ) ) {
            $messages = $messages_data;
        }

        // Get conversation details
        $conv_resp = $this->call_edge_function( 'GET', '/conversations', [
            'query' => [ 'id' => $id ],
        ] );
        $conversations = json_decode( $conv_resp['body'], true );
        $conversation = is_array( $conversations ) && count( $conversations ) > 0 ? $conversations[0] : null;

        // Get extracted data
        $extracted = $this->get_extracted_data( $id );

        return rest_ensure_response( [
            'messages'       => $messages,
            'conversation'   => $conversation,
            'extracted_data' => $extracted,
        ] );
    }

    public function admin_update_conversation( $request ) {
        $id = (int) $request['id'];
        $body = $request->get_json_params();
        return $this->proxy( 'PATCH', '/conversations', [
            'query' => [ 'id' => $id ],
            'body'  => $body,
        ] );
    }

    public function admin_get_messages( $request ) {
        $id = (int) $request['id'];
        $params = [
            'conversation_id' => $id,
            'limit'           => $request->get_param( 'limit' ) ?: 30,
        ];
        if ( $request->get_param( 'before' ) ) {
            $params['before'] = (int) $request->get_param( 'before' );
        }
        if ( $request->get_param( 'since' ) ) {
            $params['since'] = $request->get_param( 'since' );
        }
        return $this->proxy( 'GET', '/messages', [ 'query' => $params ] );
    }

    public function admin_send_message( $request ) {
        $id = (int) $request['id'];
        $body = $request->get_json_params();
        $body['conversation_id'] = $id;
        return $this->proxy( 'POST', '/messages', [ 'body' => $body ] );
    }

    public function admin_suggest( $request ) {
        $id = (int) $request['id'];
        return $this->proxy( 'POST', '/suggest', [
            'body' => [ 'conversation_id' => $id ],
        ] );
    }

    public function admin_approve_message( $request ) {
        $msg_id = (int) $request['id'];
        return $this->proxy( 'POST', '/messages', [
            'query' => [ 'action' => 'approve', 'msg_id' => $msg_id ],
        ] );
    }

    public function admin_get_settings() {
        return $this->proxy( 'GET', '/settings' );
    }

    public function admin_save_settings( $request ) {
        $body = $request->get_json_params();

        // Dual-write: save non-secret settings to wp_options so PHP templates
        // (widget rendering, page load) stay in sync with Supabase.
        $wp_data = $body;
        // API keys go to Supabase Vault only — store a boolean flag in wp_options
        // so the settings page can show the mask without storing the actual key.
        if ( isset( $wp_data['openai_api_key'] ) ) {
            $val = $wp_data['openai_api_key'];
            $wp_data['openai_api_key_set'] = ( is_string( $val ) && $val !== '' && $val !== '••••••••' );
            unset( $wp_data['openai_api_key'] );
        }
        if ( isset( $wp_data['audio_api_key'] ) ) {
            $val = $wp_data['audio_api_key'];
            $wp_data['audio_api_key_set'] = ( is_string( $val ) && $val !== '' && $val !== '••••••••' );
            unset( $wp_data['audio_api_key'] );
        }
        Michelle_AI_Settings::save( $wp_data );

        return $this->proxy( 'POST', '/settings', [ 'body' => $body ] );
    }

    public function admin_retrain( $request ) {
        $body = $request->get_json_params();
        return $this->proxy( 'POST', '/retrain', [ 'body' => $body ] );
    }

    public function admin_export_csv() {
        $resp = $this->call_edge_function( 'GET', '/export-csv' );
        $content_type = $resp['headers']['content-type'] ?? 'text/csv';

        // Return raw CSV response
        header( 'Content-Type: ' . $content_type );
        header( 'Content-Disposition: attachment; filename="michelle-ai-export.csv"' );
        echo $resp['body'];
        exit;
    }

    public function admin_generate_pdf( $request ) {
        $id = (int) $request['id'];
        $template = (int) $request->get_param( 'template' );

        $resp = $this->call_edge_function( 'GET', '/generate-pdf', [
            'query' => [
                'conversation_id' => $id,
                'template'        => $template,
            ],
        ] );

        $content_type = $resp['headers']['content-type'] ?? 'text/html';

        // Return raw HTML response
        header( 'Content-Type: ' . $content_type );
        echo $resp['body'];
        exit;
    }

    // =========================================================================
    // Extracted data helper
    // =========================================================================

    private function get_extracted_data( $conversation_id ) {
        // Query extracted_data via Supabase PostgREST directly (service_role bypasses RLS)
        $base_url = MICHELLE_AI_SUPABASE_URL . '/rest/v1/extracted_data';
        $url = add_query_arg( [
            'conversation_id' => 'eq.' . $conversation_id,
            'select'          => 'property_key,property_value,property_value_encrypted',
        ], $base_url );

        $resp = wp_remote_get( $url, [
            'headers' => [
                'apikey'        => MICHELLE_AI_SUPABASE_SERVICE_ROLE_KEY,
                'Authorization' => 'Bearer ' . MICHELLE_AI_SUPABASE_SERVICE_ROLE_KEY,
            ],
            'timeout' => 10,
        ] );

        if ( is_wp_error( $resp ) ) {
            return [];
        }

        $rows = json_decode( wp_remote_retrieve_body( $resp ), true );
        if ( ! is_array( $rows ) ) {
            return [];
        }

        $result = [];
        foreach ( $rows as $row ) {
            $value = $row['property_value'] ?? '';
            // Decrypt if encrypted value is present and plaintext is empty
            if ( empty( $value ) && ! empty( $row['property_value_encrypted'] ) ) {
                $decrypted = self::rpc( 'decrypt_pii', [ 'ciphertext' => $row['property_value_encrypted'] ] );
                if ( $decrypted ) {
                    $value = $decrypted;
                }
            }
            $result[ $row['property_key'] ] = $value;
        }
        return $result;
    }

    // =========================================================================
    // HTTP proxy helpers
    // =========================================================================

    /**
     * Proxy a request to a Supabase Edge Function and return a WP REST Response.
     */
    private function proxy( $method, $function_path, $opts = [] ) {
        $resp = $this->call_edge_function( $method, $function_path, $opts );

        $body = json_decode( $resp['body'], true );
        $code = (int) $resp['code'];

        if ( $code >= 400 ) {
            return new WP_REST_Response(
                $body ?: [ 'message' => 'Supabase request failed' ],
                $code
            );
        }

        return rest_ensure_response( $body );
    }

    /**
     * Call a Supabase Edge Function via HTTP.
     */
    private function call_edge_function( $method, $function_path, $opts = [] ) {
        $base_url = rtrim( MICHELLE_AI_SUPABASE_URL, '/' ) . '/functions/v1' . $function_path;

        if ( ! empty( $opts['query'] ) ) {
            $base_url = add_query_arg( $opts['query'], $base_url );
        }

        $args = [
            'method'  => $method,
            'headers' => [
                'Content-Type'       => 'application/json',
                'X-Service-Role-Key' => MICHELLE_AI_SUPABASE_SERVICE_ROLE_KEY,
            ],
            'timeout' => 30,
        ];

        if ( ! empty( $opts['body'] ) ) {
            $args['body'] = wp_json_encode( $opts['body'] );
        }

        $response = wp_remote_request( $base_url, $args );

        if ( is_wp_error( $response ) ) {
            return [
                'body'    => wp_json_encode( [ 'error' => $response->get_error_message() ] ),
                'code'    => 500,
                'headers' => [],
            ];
        }

        return [
            'body'    => wp_remote_retrieve_body( $response ),
            'code'    => wp_remote_retrieve_response_code( $response ),
            'headers' => wp_remote_retrieve_headers( $response )->getAll(),
        ];
    }

    /**
     * Add no-cache headers to REST responses.
     */
    public function nocache_headers( $response, $server, $request ) {
        if ( strpos( $request->get_route(), 'michelle-ai' ) !== false ) {
            $response->header( 'Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0' );
            $response->header( 'Pragma', 'no-cache' );
        }
        return $response;
    }

    // =========================================================================
    // Static helpers for server-side page rendering (admin PHP templates)
    // These query Supabase PostgREST directly with the service_role key.
    // =========================================================================

    /**
     * Query Supabase PostgREST table directly.
     */
    private static function postgrest_get( $table, $params = [] ) {
        $url = rtrim( MICHELLE_AI_SUPABASE_URL, '/' ) . '/rest/v1/' . $table;
        if ( ! empty( $params ) ) {
            $url = add_query_arg( $params, $url );
        }

        $resp = wp_remote_get( $url, [
            'headers' => [
                'apikey'        => MICHELLE_AI_SUPABASE_SERVICE_ROLE_KEY,
                'Authorization' => 'Bearer ' . MICHELLE_AI_SUPABASE_SERVICE_ROLE_KEY,
                'Prefer'        => 'count=exact',
            ],
            'timeout' => 10,
        ] );

        if ( is_wp_error( $resp ) ) {
            return [ 'data' => [], 'count' => 0 ];
        }

        $data = json_decode( wp_remote_retrieve_body( $resp ) );
        $count_header = wp_remote_retrieve_header( $resp, 'content-range' );
        $count = 0;
        if ( $count_header && preg_match( '/\/(\d+)$/', $count_header, $m ) ) {
            $count = (int) $m[1];
        }

        return [ 'data' => is_array( $data ) ? $data : [], 'count' => $count ];
    }

    /**
     * Update rows in a Supabase table via PostgREST PATCH.
     */
    private static function postgrest_patch( $table, $filters, $data ) {
        $url = rtrim( MICHELLE_AI_SUPABASE_URL, '/' ) . '/rest/v1/' . $table;
        $url = add_query_arg( $filters, $url );

        wp_remote_request( $url, [
            'method'  => 'PATCH',
            'headers' => [
                'apikey'        => MICHELLE_AI_SUPABASE_SERVICE_ROLE_KEY,
                'Authorization' => 'Bearer ' . MICHELLE_AI_SUPABASE_SERVICE_ROLE_KEY,
                'Content-Type'  => 'application/json',
                'Prefer'        => 'return=minimal',
            ],
            'body'    => wp_json_encode( $data ),
            'timeout' => 10,
        ] );
    }

    /**
     * Get conversation list for admin page (server-side render).
     */
    public static function get_conversations( $args = [] ) {
        $limit = $args['limit'] ?? 100;

        $result = self::postgrest_get( 'conversations', [
            'select'   => 'id,visitor_name,visitor_email,status,unread_admin,last_message_at,created_at',
            'order'    => 'last_message_at.desc.nullslast',
            'limit'    => $limit,
        ] );

        return $result['data'];
    }

    /**
     * Get a single conversation.
     */
    public static function get_conversation( $conv_id ) {
        $result = self::postgrest_get( 'conversations', [
            'id'     => 'eq.' . (int) $conv_id,
            'select' => 'id,visitor_name,visitor_email,visitor_ip,status,unread_admin,last_message_at,created_at',
            'limit'  => 1,
        ] );

        return ! empty( $result['data'] ) ? $result['data'][0] : null;
    }

    /**
     * Mark a conversation as read.
     */
    public static function mark_read( $conv_id ) {
        self::postgrest_patch( 'conversations', [
            'id' => 'eq.' . (int) $conv_id,
        ], [
            'unread_admin' => false,
        ] );
    }

    /**
     * Get paginated messages for a conversation (newest first, reversed for display).
     */
    public static function get_messages_page( $conv_id, $limit = 30 ) {
        $result = self::postgrest_get( 'messages', [
            'conversation_id' => 'eq.' . (int) $conv_id,
            'select'          => 'id,conversation_id,sender_type,content,quick_replies,is_pending_mod,ai_suggestion,created_at',
            'order'           => 'id.desc',
            'limit'           => $limit,
        ] );

        // Reverse so oldest is first (chronological order for display)
        return array_reverse( $result['data'] );
    }

    /**
     * Count total messages in a conversation.
     */
    public static function count_messages( $conv_id ) {
        $result = self::postgrest_get( 'messages', [
            'conversation_id' => 'eq.' . (int) $conv_id,
            'select'          => 'id',
        ] );

        return $result['count'];
    }

    /**
     * Get extracted data for a conversation.
     */
    public static function get_extracted_data_for_conv( $conv_id ) {
        $result = self::postgrest_get( 'extracted_data', [
            'conversation_id' => 'eq.' . (int) $conv_id,
            'select'          => 'property_key,property_value,property_value_encrypted',
        ] );

        $rows = $result['data'];
        if ( empty( $rows ) ) {
            return $rows;
        }

        // Decrypt encrypted values via RPC
        foreach ( $rows as &$row ) {
            if ( ! empty( $row->property_value_encrypted ) ) {
                $decrypted = self::rpc( 'decrypt_pii', [ 'ciphertext' => $row->property_value_encrypted ] );
                if ( $decrypted ) {
                    $row->property_value = $decrypted;
                }
            }
        }

        return $rows;
    }

    /**
     * Call a Supabase RPC function via PostgREST.
     */
    private static function rpc( $fn_name, $params = [] ) {
        $url  = rtrim( MICHELLE_AI_SUPABASE_URL, '/' ) . '/rest/v1/rpc/' . $fn_name;
        $resp = wp_remote_post( $url, [
            'headers' => [
                'apikey'        => MICHELLE_AI_SUPABASE_SERVICE_ROLE_KEY,
                'Authorization' => 'Bearer ' . MICHELLE_AI_SUPABASE_SERVICE_ROLE_KEY,
                'Content-Type'  => 'application/json',
            ],
            'body'    => wp_json_encode( $params ),
            'timeout' => 10,
        ] );

        if ( is_wp_error( $resp ) ) {
            return null;
        }

        $body = wp_remote_retrieve_body( $resp );
        $decoded = json_decode( $body );

        return is_string( $decoded ) ? $decoded : null;
    }
}
