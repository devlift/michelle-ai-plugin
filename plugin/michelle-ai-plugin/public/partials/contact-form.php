<?php
/**
 * Contact form — shown when chat is disabled.
 */
if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

$primary   = esc_attr( Michelle_AI_Settings::get( 'primary_color', '#6366f1' ) );
$secondary = esc_attr( Michelle_AI_Settings::get( 'secondary_color', '#f1f5f9' ) );
$title     = esc_html( Michelle_AI_Settings::get( 'agent_name', 'Support' ) );
$logo_url  = esc_url( Michelle_AI_Settings::get( 'logo_url', '' ) );

$form_title   = esc_html( Michelle_AI_Settings::get( 'form_title', 'Send us a message' ) );
$lbl_name     = esc_html( Michelle_AI_Settings::get( 'form_label_name', 'Your Name' ) );
$lbl_address  = esc_html( Michelle_AI_Settings::get( 'form_label_address', 'Address (optional)' ) );
$lbl_email    = esc_html( Michelle_AI_Settings::get( 'form_label_email', 'Email Address' ) );
$lbl_message  = esc_html( Michelle_AI_Settings::get( 'form_label_message', 'Message' ) );
$lbl_submit   = esc_html( Michelle_AI_Settings::get( 'form_submit_label', 'Send Message' ) );
?>
<style>
:root {
    --mai-primary:   <?php echo $primary; ?>;
    --mai-secondary: <?php echo $secondary; ?>;
}
</style>

<div id="mai-chat-widget" aria-live="polite" role="region" aria-label="Contact form">

    <button id="mai-fab" aria-label="Open contact form" title="<?php echo $form_title; ?>">
        <!-- Mail icon (visible when closed) -->
        <svg class="mai-fab-icon mai-icon-chat" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="2" y="4" width="20" height="16" rx="2" stroke="currentColor" stroke-width="2"/>
            <path d="M2 7l10 7 10-7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <!-- Close X icon (visible when open) -->
        <svg class="mai-fab-icon mai-icon-close" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
        </svg>
    </button>

    <div id="mai-chat-window" hidden aria-modal="true" role="dialog" aria-label="<?php echo $form_title; ?>">

        <div class="mai-chat-header">
            <div class="mai-header-left">
                <?php if ( $logo_url ) : ?>
                    <img src="<?php echo $logo_url; ?>" class="mai-avatar" alt="<?php echo $title; ?>" />
                <?php else : ?>
                    <span class="mai-avatar mai-avatar-default"><?php echo mb_substr( $title, 0, 1 ); ?></span>
                <?php endif; ?>
                <div class="mai-header-info">
                    <strong><?php echo $form_title; ?></strong>
                </div>
            </div>
            <button class="mai-close-btn" aria-label="Close" id="mai-close-btn">
                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
            </button>
        </div>

        <div class="mai-contact-body">
            <form id="mai-contact-form" novalidate>
                <?php wp_nonce_field( 'mai_contact_form', 'mai_contact_nonce' ); ?>

                <label for="mai-cf-name"><?php echo $lbl_name; ?> <span aria-hidden="true">*</span></label>
                <input type="text" id="mai-cf-name" name="name" required autocomplete="name" />

                <label for="mai-cf-address"><?php echo $lbl_address; ?></label>
                <input type="text" id="mai-cf-address" name="address" autocomplete="street-address" />

                <label for="mai-cf-email"><?php echo $lbl_email; ?> <span aria-hidden="true">*</span></label>
                <input type="email" id="mai-cf-email" name="email" required autocomplete="email" />

                <label for="mai-cf-message"><?php echo $lbl_message; ?> <span aria-hidden="true">*</span></label>
                <textarea id="mai-cf-message" name="message" rows="4" required></textarea>

                <div id="mai-cf-error" class="mai-cf-error" hidden></div>

                <button type="submit" class="mai-cf-submit"><?php echo $lbl_submit; ?></button>
            </form>

            <div id="mai-cf-success" class="mai-cf-success" hidden>
                <svg viewBox="0 0 24 24" fill="none"><path d="M9 16.2L4.8 12 3.4 13.4 9 19 21 7l-1.4-1.4L9 16.2Z" fill="currentColor"/></svg>
                <p id="mai-cf-success-msg"></p>
            </div>
        </div>

        <p class="mai-powered-by">Powered by Michelle AI</p>
    </div>
</div>
