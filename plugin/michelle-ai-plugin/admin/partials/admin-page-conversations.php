<?php
/**
 * Admin: Conversations list page.
 */
if ( ! defined( 'ABSPATH' ) ) { exit; }

$conversations = Michelle_AI_DB::get_conversations( [ 'limit' => 100 ] );
?>
<div class="wrap mai-admin">
    <h1 class="wp-heading-inline">
        <?php esc_html_e( 'Conversations', 'michelle-ai-plugin' ); ?>
    </h1>

    <div class="mai-admin-layout">

        <!-- Conversation list sidebar -->
        <div class="mai-conv-list" id="mai-conv-list">
            <?php if ( empty( $conversations ) ) : ?>
                <div class="mai-empty">
                    <p><?php esc_html_e( 'No conversations yet. Once a visitor opens the chat widget, conversations will appear here.', 'michelle-ai-plugin' ); ?></p>
                </div>
            <?php else : ?>
                <?php foreach ( $conversations as $conv ) : ?>
                    <?php
                    $unread = (bool) $conv->unread_admin;
                    $active = isset( $_GET['conv'] ) && (int) $_GET['conv'] === (int) $conv->id;
                    $name   = $conv->visitor_name ?: __( 'Anonymous', 'michelle-ai-plugin' );
                    $email  = $conv->visitor_email ?: '';
                    $ts     = $conv->last_message_at
                        ? human_time_diff( strtotime( $conv->last_message_at ), current_time( 'timestamp' ) ) . ' ago'
                        : '';
                    $classes = 'mai-conv-item';
                    if ( $active )  $classes .= ' mai-conv-active';
                    if ( $unread )  $classes .= ' mai-conv-unread';
                    ?>
                    <a href="<?php echo esc_url( add_query_arg( 'conv', $conv->id ) ); ?>"
                       class="<?php echo esc_attr( $classes ); ?>"
                       data-id="<?php echo (int) $conv->id; ?>">
                        <div class="mai-conv-avatar">
                            <?php echo esc_html( mb_strtoupper( mb_substr( $name, 0, 1 ) ) ); ?>
                        </div>
                        <div class="mai-conv-info">
                            <div class="mai-conv-name">
                                <?php echo esc_html( $name ); ?>
                                <?php if ( $unread ) : ?>
                                    <span class="mai-unread-badge"></span>
                                <?php endif; ?>
                            </div>
                            <div class="mai-conv-meta"><?php echo esc_html( $email ?: $ts ); ?></div>
                        </div>
                        <div class="mai-conv-ts"><?php echo esc_html( $ts ); ?></div>
                    </a>
                <?php endforeach; ?>
            <?php endif; ?>
        </div>

        <!-- Conversation detail pane -->
        <div class="mai-conv-detail" id="mai-conv-detail">
            <?php
            if ( isset( $_GET['conv'] ) ) {
                $conv_id = (int) $_GET['conv'];
                include __DIR__ . '/admin-page-conversation.php';
            } else {
                ?>
                <div class="mai-empty mai-empty-detail">
                    <svg viewBox="0 0 24 24" fill="none" width="48" height="48">
                        <path d="M20 2H4C2.9 2 2 2.9 2 4V22L6 18H20C21.1 18 22 17.1 22 16V4C22 2.9 21.1 2 20 2Z" fill="#e2e8f0"/>
                    </svg>
                    <p><?php esc_html_e( 'Select a conversation to view messages', 'michelle-ai-plugin' ); ?></p>
                </div>
                <?php
            }
            ?>
        </div>
    </div>
</div>
