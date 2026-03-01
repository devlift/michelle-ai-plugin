<?php
/**
 * Database helper — all CRUD for conversations, messages, and contacts.
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

class Michelle_AI_DB {

    // -------------------------------------------------------------------------
    // Table name helpers
    // -------------------------------------------------------------------------

    public static function conversations_table() {
        global $wpdb;
        return $wpdb->prefix . 'michelle_ai_conversations';
    }

    public static function messages_table() {
        global $wpdb;
        return $wpdb->prefix . 'michelle_ai_messages';
    }

    public static function extracted_data_table() {
        global $wpdb;
        return $wpdb->prefix . 'michelle_ai_extracted_data';
    }

    public static function contacts_table() {
        global $wpdb;
        return $wpdb->prefix . 'michelle_ai_contacts';
    }

    // -------------------------------------------------------------------------
    // Conversations
    // -------------------------------------------------------------------------

    /**
     * Create a new conversation and return its ID.
     */
    public static function create_conversation( $args = [] ) {
        global $wpdb;

        $token = bin2hex( random_bytes( 32 ) );

        $wpdb->insert(
            self::conversations_table(),
            [
                'session_token'   => $token,
                'visitor_name'    => sanitize_text_field( $args['visitor_name'] ?? '' ),
                'visitor_email'   => sanitize_email( $args['visitor_email'] ?? '' ),
                'visitor_ip'      => sanitize_text_field( $args['visitor_ip'] ?? '' ),
                'status'          => 'active',
                'unread_admin'    => 0,
                'last_message_at' => current_time( 'mysql' ),
                'created_at'      => current_time( 'mysql' ),
            ],
            [ '%s', '%s', '%s', '%s', '%s', '%d', '%s', '%s' ]
        );

        return [
            'id'            => (int) $wpdb->insert_id,
            'session_token' => $token,
        ];
    }

    /**
     * Get a conversation by ID.
     */
    public static function get_conversation( $id ) {
        global $wpdb;
        return $wpdb->get_row(
            $wpdb->prepare( 'SELECT * FROM ' . self::conversations_table() . ' WHERE id = %d', $id )
        );
    }

    /**
     * Get a conversation by session token.
     */
    public static function get_conversation_by_token( $token ) {
        global $wpdb;
        return $wpdb->get_row(
            $wpdb->prepare(
                'SELECT * FROM ' . self::conversations_table() . ' WHERE session_token = %s',
                $token
            )
        );
    }

    /**
     * List all conversations (for admin), newest first.
     */
    public static function get_conversations( $args = [] ) {
        global $wpdb;
        $limit  = isset( $args['limit'] ) ? (int) $args['limit'] : 50;
        $offset = isset( $args['offset'] ) ? (int) $args['offset'] : 0;
        $status = isset( $args['status'] ) ? sanitize_text_field( $args['status'] ) : null;

        $where = $status ? $wpdb->prepare( 'WHERE status = %s', $status ) : '';

        return $wpdb->get_results(
            "SELECT * FROM " . self::conversations_table() . " $where ORDER BY last_message_at DESC LIMIT $limit OFFSET $offset"
        );
    }

    /**
     * Update conversation fields.
     */
    public static function update_conversation( $id, $data ) {
        global $wpdb;
        $wpdb->update(
            self::conversations_table(),
            $data,
            [ 'id' => $id ]
        );
    }

    /**
     * Mark conversation as read by admin (clears unread flag).
     */
    public static function mark_read( $id ) {
        self::update_conversation( $id, [ 'unread_admin' => 0 ] );
    }

    /**
     * Get count of conversations with unread messages for admin.
     */
    public static function unread_count() {
        global $wpdb;
        return (int) $wpdb->get_var(
            'SELECT COUNT(*) FROM ' . self::conversations_table() . " WHERE unread_admin = 1 AND status = 'active'"
        );
    }

    // -------------------------------------------------------------------------
    // Messages
    // -------------------------------------------------------------------------

    /**
     * Insert a message and return its ID.
     *
     * @param int    $conversation_id
     * @param string $sender_type  visitor|admin|ai
     * @param string $content
     * @param array  $extra        quick_replies, is_pending_mod, ai_suggestion
     */
    public static function add_message( $conversation_id, $sender_type, $content, $extra = [] ) {
        global $wpdb;

        $quick_replies = isset( $extra['quick_replies'] )
            ? ( is_array( $extra['quick_replies'] ) ? wp_json_encode( $extra['quick_replies'] ) : $extra['quick_replies'] )
            : null;

        $wpdb->insert(
            self::messages_table(),
            [
                'conversation_id' => (int) $conversation_id,
                'sender_type'     => $sender_type,
                'content'         => $content,
                'quick_replies'   => $quick_replies,
                'is_pending_mod'  => (int) ( $extra['is_pending_mod'] ?? 0 ),
                'ai_suggestion'   => $extra['ai_suggestion'] ?? null,
                'created_at'      => current_time( 'mysql' ),
            ],
            [ '%d', '%s', '%s', '%s', '%d', '%s', '%s' ]
        );

        $message_id = (int) $wpdb->insert_id;

        // Touch the conversation timestamp + set unread flag (if from visitor)
        $touch = [ 'last_message_at' => current_time( 'mysql' ) ];
        if ( $sender_type === 'visitor' ) {
            $touch['unread_admin'] = 1;
        }
        self::update_conversation( $conversation_id, $touch );

        return $message_id;
    }

    /**
     * Get all messages for a conversation, optionally only those after a datetime.
     */
    public static function get_messages( $conversation_id, $since = null ) {
        global $wpdb;

        $since_clause = '';
        if ( $since ) {
            $since_clause = $wpdb->prepare( ' AND created_at > %s', $since );
        }

        return $wpdb->get_results(
            $wpdb->prepare(
                'SELECT * FROM ' . self::messages_table() .
                ' WHERE conversation_id = %d' . $since_clause .
                ' ORDER BY created_at ASC',
                $conversation_id
            )
        );
    }

    /**
     * Get the total number of messages in a conversation.
     */
    public static function count_messages( $conversation_id ) {
        global $wpdb;
        return (int) $wpdb->get_var(
            $wpdb->prepare(
                'SELECT COUNT(*) FROM ' . self::messages_table() . ' WHERE conversation_id = %d',
                $conversation_id
            )
        );
    }

    /**
     * Get paginated messages: newest $limit messages, or messages older than $before_id.
     * Returns rows in chronological (ASC) order.
     */
    public static function get_messages_page( $conversation_id, $limit = 30, $before_id = null ) {
        global $wpdb;
        $before_clause = '';
        if ( $before_id ) {
            $before_clause = $wpdb->prepare( ' AND id < %d', $before_id );
        }
        // Get the newest $limit rows (ORDER DESC to pick from the end, then re-sort ASC)
        $rows = $wpdb->get_results(
            $wpdb->prepare(
                'SELECT * FROM ' . self::messages_table() .
                ' WHERE conversation_id = %d' . $before_clause .
                ' ORDER BY id DESC LIMIT %d',
                $conversation_id,
                $limit
            )
        );
        return array_reverse( $rows ); // chronological order
    }

    /**
     * Get a single message by ID.
     */
    public static function get_message( $id ) {
        global $wpdb;
        return $wpdb->get_row(
            $wpdb->prepare( 'SELECT * FROM ' . self::messages_table() . ' WHERE id = %d', $id )
        );
    }

    /**
     * Approve a pending-moderation message (sets is_pending_mod = 0).
     */
    public static function approve_message( $message_id ) {
        global $wpdb;
        $wpdb->update(
            self::messages_table(),
            [ 'is_pending_mod' => 0 ],
            [ 'id' => $message_id ],
            [ '%d' ],
            [ '%d' ]
        );
    }

    /**
     * Update ai_suggestion on a message.
     */
    public static function set_ai_suggestion( $message_id, $suggestion ) {
        global $wpdb;
        $wpdb->update(
            self::messages_table(),
            [ 'ai_suggestion' => $suggestion ],
            [ 'id'            => $message_id ],
            [ '%s' ],
            [ '%d' ]
        );
    }

    // -------------------------------------------------------------------------
    // Extracted data
    // -------------------------------------------------------------------------

    /**
     * Save or update an extracted property for a conversation.
     */
    public static function save_extracted_data( $conversation_id, $key, $value ) {
        global $wpdb;
        $wpdb->replace(
            self::extracted_data_table(),
            [
                'conversation_id' => (int) $conversation_id,
                'property_key'    => sanitize_key( $key ),
                'property_value'  => sanitize_text_field( $value ),
                'extracted_at'    => current_time( 'mysql' ),
            ],
            [ '%d', '%s', '%s', '%s' ]
        );
    }

    /**
     * Get all extracted data for a conversation.
     */
    public static function get_extracted_data( $conversation_id ) {
        global $wpdb;
        return $wpdb->get_results(
            $wpdb->prepare(
                'SELECT property_key, property_value, extracted_at FROM ' . self::extracted_data_table() .
                ' WHERE conversation_id = %d ORDER BY extracted_at ASC',
                $conversation_id
            )
        );
    }

    /**
     * Get a single extracted property value.
     */
    public static function get_extracted_value( $conversation_id, $key ) {
        global $wpdb;
        return $wpdb->get_var(
            $wpdb->prepare(
                'SELECT property_value FROM ' . self::extracted_data_table() .
                ' WHERE conversation_id = %d AND property_key = %s',
                $conversation_id,
                $key
            )
        );
    }

    // -------------------------------------------------------------------------
    // Contacts (contact form when chat is OFF)
    // -------------------------------------------------------------------------

    public static function add_contact( $data ) {
        global $wpdb;
        $wpdb->insert(
            self::contacts_table(),
            [
                'name'         => sanitize_text_field( $data['name'] ),
                'address'      => sanitize_textarea_field( $data['address'] ?? '' ),
                'email'        => sanitize_email( $data['email'] ),
                'message'      => sanitize_textarea_field( $data['message'] ),
                'submitted_at' => current_time( 'mysql' ),
            ],
            [ '%s', '%s', '%s', '%s', '%s' ]
        );
        return (int) $wpdb->insert_id;
    }

    public static function get_contacts( $limit = 50, $offset = 0 ) {
        global $wpdb;
        return $wpdb->get_results(
            "SELECT * FROM " . self::contacts_table() . " ORDER BY submitted_at DESC LIMIT $limit OFFSET $offset"
        );
    }

    // -------------------------------------------------------------------------
    // Serialize helper for REST responses
    // -------------------------------------------------------------------------

    public static function format_message( $row ) {
        return [
            'id'              => (int) $row->id,
            'conversation_id' => (int) $row->conversation_id,
            'sender_type'     => $row->sender_type,
            'content'         => $row->content,
            'quick_replies'   => $row->quick_replies ? json_decode( $row->quick_replies, true ) : [],
            'is_pending_mod'  => (bool) $row->is_pending_mod,
            'ai_suggestion'   => $row->ai_suggestion,
            'created_at'      => $row->created_at,
        ];
    }

    public static function format_conversation( $row ) {
        return [
            'id'              => (int) $row->id,
            'visitor_name'    => $row->visitor_name,
            'visitor_email'   => $row->visitor_email,
            'status'          => $row->status,
            'unread_admin'    => (bool) $row->unread_admin,
            'last_message_at' => $row->last_message_at,
            'created_at'      => $row->created_at,
        ];
    }
}
