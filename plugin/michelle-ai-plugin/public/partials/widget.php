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
        <span class="mai-fab-icon mai-fab-open">
            <!-- Chat bubble SVG -->
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M20 2H4C2.9 2 2 2.9 2 4V22L6 18H20C21.1 18 22 17.1 22 16V4C22 2.9 21.1 2 20 2Z" fill="currentColor"/>
            </svg>
        </span>
        <span class="mai-fab-icon mai-fab-close" hidden>
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M19 6.41L17.59 5L12 10.59L6.41 5L5 6.41L10.59 12L5 17.59L6.41 19L12 13.41L17.59 19L19 17.59L13.41 12L19 6.41Z" fill="currentColor"/>
            </svg>
        </span>
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
                <div>
                    <strong><?php echo $title; ?></strong>
                    <span class="mai-status-dot"></span>
                </div>
            </div>
            <button class="mai-close-btn" aria-label="Close chat" id="mai-close-btn">
                <svg viewBox="0 0 24 24" fill="none"><path d="M19 6.41L17.59 5L12 10.59L6.41 5L5 6.41L10.59 12L5 17.59L6.41 19L12 13.41L17.59 19L19 17.59L13.41 12L19 6.41Z" fill="currentColor"/></svg>
            </button>
        </div>

        <!-- Messages area -->
        <div id="mai-messages" class="mai-messages" role="log" aria-live="polite">
            <!-- Messages injected by JS -->
        </div>

        <!-- Typing indicator -->
        <div id="mai-typing" class="mai-typing" hidden>
            <div class="mai-typing-bubble">
                <span></span><span></span><span></span>
            </div>
        </div>

        <!-- Input area -->
        <div class="mai-input-area">
            <textarea
                id="mai-input"
                class="mai-input"
                placeholder="Type a message…"
                rows="1"
                aria-label="Message input"
                maxlength="2000"
            ></textarea>
            <button id="mai-send-btn" class="mai-send-btn" aria-label="Send message">
                <svg viewBox="0 0 24 24" fill="none"><path d="M2.01 21L23 12L2.01 3L2 10L17 12L2 14L2.01 21Z" fill="currentColor"/></svg>
            </button>
        </div>

        <p class="mai-powered-by">Powered by Michelle AI</p>
    </div>
</div>
