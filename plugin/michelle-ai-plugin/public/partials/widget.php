<?php
/**
 * Chat widget HTML — injected into the footer of every public page.
 * CSS custom properties are injected inline so branding colors work without
 * re-compiling any stylesheet.
 */
if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

$primary   = esc_attr( Michelle_AI_Settings::get( 'primary_color', '#6366f1' ) );
$secondary = esc_attr( Michelle_AI_Settings::get( 'secondary_color', '#f1f5f9' ) );
$title     = esc_html( Michelle_AI_Settings::get( 'widget_title', 'Chat with us' ) );
$agent     = esc_html( Michelle_AI_Settings::get( 'agent_name', 'Support' ) );
$logo_url  = esc_url( Michelle_AI_Settings::get( 'logo_url', '' ) );
?>
<style>
:root {
    --mai-primary:   <?php echo $primary; ?>;
    --mai-secondary: <?php echo $secondary; ?>;
}
</style>

<div id="mai-chat-widget" aria-live="polite" role="region" aria-label="<?php echo $title; ?>">

    <!-- FAB toggle button -->
    <button id="mai-fab" aria-label="Open chat" title="<?php echo $title; ?>">
        <!-- Chat bubble icon (visible when closed) -->
        <svg class="mai-fab-icon mai-icon-chat" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <!-- Close X icon (visible when open) -->
        <svg class="mai-fab-icon mai-icon-close" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
        </svg>
        <span class="mai-unread-dot" hidden aria-label="New messages"></span>
    </button>

    <!-- Chat window -->
    <div id="mai-chat-window" hidden aria-modal="true" role="dialog" aria-label="<?php echo $title; ?>">

        <!-- Header -->
        <div class="mai-chat-header">
            <div class="mai-header-left">
                <?php if ( $logo_url ) : ?>
                    <img src="<?php echo $logo_url; ?>" class="mai-avatar" alt="<?php echo $agent; ?>" />
                <?php else : ?>
                    <span class="mai-avatar mai-avatar-default"><?php echo mb_substr( $agent, 0, 1 ); ?></span>
                <?php endif; ?>
                <div class="mai-header-info">
                    <strong><?php echo $title; ?></strong>
                    <span class="mai-header-status">
                        <span class="mai-status-dot"></span>
                        Online
                    </span>
                </div>
            </div>
            <button class="mai-close-btn" aria-label="Close chat" id="mai-close-btn">
                <!-- Chevron down icon -->
                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
            </button>
        </div>

        <!-- Messages area -->
        <div id="mai-messages" class="mai-messages" role="log" aria-live="polite">
            <!-- Messages injected by JS -->
        </div>

        <!-- Typing indicator -->
        <div id="mai-typing" class="mai-typing" hidden>
            <div class="mai-typing-row">
                <?php if ( $logo_url ) : ?>
                    <div class="mai-typing-avatar"><img src="<?php echo $logo_url; ?>" alt="" /></div>
                <?php else : ?>
                    <div class="mai-typing-avatar"><?php echo mb_substr( $agent, 0, 1 ); ?></div>
                <?php endif; ?>
                <div class="mai-typing-bubble">
                    <span></span><span></span><span></span>
                </div>
            </div>
        </div>

        <!-- Input area -->
        <div class="mai-input-area">
            <div class="mai-input-wrapper">
                <textarea
                    id="mai-input"
                    class="mai-input"
                    placeholder="Ask anything..."
                    rows="1"
                    aria-label="Message input"
                    maxlength="2000"
                ></textarea>
                <button id="mai-send-btn" class="mai-send-btn" aria-label="Send message">
                    <!-- Arrow up icon -->
                    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M12 19V5M5 12l7-7 7 7" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                </button>
            </div>
        </div>

        <p class="mai-powered-by">Powered by Michelle AI</p>
    </div>
</div>
