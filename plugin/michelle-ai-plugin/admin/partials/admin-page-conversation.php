<?php
/**
 * Admin: Single conversation detail pane.
 * $conv_id must be set by the parent include.
 */
if ( ! defined( 'ABSPATH' ) ) { exit; }

$conv = Michelle_AI_DB::get_conversation( $conv_id );
if ( ! $conv ) {
    echo '<div class="mai-empty"><p>' . esc_html__( 'Conversation not found.', 'michelle-ai-plugin' ) . '</p></div>';
    return;
}

Michelle_AI_DB::mark_read( $conv_id );
$messages = Michelle_AI_DB::get_messages( $conv_id );
$mod_mode = Michelle_AI_Settings::get( 'moderation_mode', false );

$name  = $conv->visitor_name  ?: __( 'Anonymous', 'michelle-ai-plugin' );
$email = $conv->visitor_email ?: __( 'No email', 'michelle-ai-plugin' );
?>

<div class="mai-detail-header">
    <div class="mai-detail-visitor">
        <strong><?php echo esc_html( $name ); ?></strong>
        <span><?php echo esc_html( $email ); ?></span>
    </div>
    <div class="mai-detail-actions">
        <select id="mai-status-select" data-conv-id="<?php echo (int) $conv_id; ?>">
            <option value="active"   <?php selected( $conv->status, 'active' ); ?>><?php esc_html_e( 'Active', 'michelle-ai-plugin' ); ?></option>
            <option value="closed"   <?php selected( $conv->status, 'closed' ); ?>><?php esc_html_e( 'Closed', 'michelle-ai-plugin' ); ?></option>
            <option value="archived" <?php selected( $conv->status, 'archived' ); ?>><?php esc_html_e( 'Archived', 'michelle-ai-plugin' ); ?></option>
        </select>
    </div>
</div>

<!-- Message thread -->
<div class="mai-detail-messages" id="mai-detail-messages">
    <?php foreach ( $messages as $msg ) :
        $is_pending = (bool) $msg->is_pending_mod;
        $bubble_cls = 'mai-admin-bubble mai-bubble-' . esc_attr( $msg->sender_type );
        if ( $is_pending ) $bubble_cls .= ' mai-bubble-pending';

        $quick_replies = $msg->quick_replies ? json_decode( $msg->quick_replies, true ) : [];
        $suggestion    = $msg->ai_suggestion ?? '';
    ?>
        <div class="<?php echo esc_attr( $bubble_cls ); ?>" data-msg-id="<?php echo (int) $msg->id; ?>">
            <div class="mai-bubble-sender">
                <?php
                if ( $msg->sender_type === 'visitor' ) {
                    echo esc_html( $name );
                } elseif ( $msg->sender_type === 'ai' ) {
                    echo esc_html__( 'AI', 'michelle-ai-plugin' );
                } else {
                    echo esc_html__( 'Admin', 'michelle-ai-plugin' );
                }
                ?>
                <span class="mai-bubble-time"><?php echo esc_html( get_date_from_gmt( $msg->created_at, 'g:i a' ) ); ?></span>
                <?php if ( $is_pending ) : ?>
                    <span class="mai-pending-label"><?php esc_html_e( 'Pending approval', 'michelle-ai-plugin' ); ?></span>
                <?php endif; ?>
            </div>
            <div class="mai-bubble-text"><?php echo esc_html( $msg->content ); ?></div>

            <?php if ( $is_pending ) : ?>
                <button class="button mai-approve-btn" data-msg-id="<?php echo (int) $msg->id; ?>">
                    <?php esc_html_e( '✓ Approve & Send', 'michelle-ai-plugin' ); ?>
                </button>
            <?php endif; ?>

            <?php if ( $quick_replies ) : ?>
                <div class="mai-admin-qr-list">
                    <span><?php esc_html_e( 'Quick replies offered to visitor:', 'michelle-ai-plugin' ); ?></span>
                    <?php foreach ( $quick_replies as $qr ) : ?>
                        <span class="mai-admin-qr-chip"><?php echo esc_html( $qr ); ?></span>
                    <?php endforeach; ?>
                </div>
            <?php endif; ?>
        </div>
    <?php endforeach; ?>
</div>

<!-- AI suggested reply -->
<div class="mai-suggestion-box">
    <div class="mai-suggestion-header">
        <span><?php esc_html_e( 'AI Suggested Reply', 'michelle-ai-plugin' ); ?></span>
        <button id="mai-regenerate-btn" class="button-link" data-conv-id="<?php echo (int) $conv_id; ?>">
            ↻ <?php esc_html_e( 'Regenerate', 'michelle-ai-plugin' ); ?>
        </button>
    </div>
    <textarea id="mai-suggestion-text" class="mai-suggestion-textarea" rows="3" placeholder="<?php esc_attr_e( 'Click Regenerate to get an AI suggestion…', 'michelle-ai-plugin' ); ?>"></textarea>
    <div class="mai-suggestion-btns">
        <button id="mai-use-suggestion-btn" class="button button-primary" data-conv-id="<?php echo (int) $conv_id; ?>">
            <?php esc_html_e( 'Send This Reply', 'michelle-ai-plugin' ); ?>
        </button>
    </div>
</div>

<!-- Admin reply area -->
<div class="mai-reply-area">
    <textarea id="mai-admin-reply" class="mai-admin-reply-input" rows="2" placeholder="<?php esc_attr_e( 'Type a reply…', 'michelle-ai-plugin' ); ?>"></textarea>
    <button id="mai-admin-send-btn" class="button button-primary" data-conv-id="<?php echo (int) $conv_id; ?>">
        <?php esc_html_e( 'Send', 'michelle-ai-plugin' ); ?>
    </button>
</div>
