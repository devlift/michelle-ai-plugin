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
        <span class="mai-fab-icon mai-fab-open">
            <svg viewBox="0 0 24 24" fill="none">
                <path d="M20 4H4C2.9 4 2.01 4.9 2.01 6L2 18C2 19.1 2.9 20 4 20H20C21.1 20 22 19.1 22 18V6C22 4.9 21.1 4 20 4ZM20 8L12 13L4 8V6L12 11L20 6V8Z" fill="currentColor"/>
            </svg>
        </span>
        <span class="mai-fab-icon mai-fab-close" hidden>
            <svg viewBox="0 0 24 24" fill="none"><path d="M19 6.41L17.59 5L12 10.59L6.41 5L5 6.41L10.59 12L5 17.59L6.41 19L12 13.41L17.59 19L19 17.59L13.41 12L19 6.41Z" fill="currentColor"/></svg>
        </span>
    </button>

    <div id="mai-chat-window" hidden aria-modal="true" role="dialog" aria-label="<?php echo $form_title; ?>">

        <div class="mai-chat-header">
            <div class="mai-header-left">
                <?php if ( $logo_url ) : ?>
                    <img src="<?php echo $logo_url; ?>" class="mai-avatar" alt="<?php echo $title; ?>" />
                <?php else : ?>
                    <span class="mai-avatar mai-avatar-default"><?php echo mb_substr( $title, 0, 1 ); ?></span>
                <?php endif; ?>
                <div><strong><?php echo $form_title; ?></strong></div>
            </div>
            <button class="mai-close-btn" aria-label="Close" id="mai-close-btn">
                <svg viewBox="0 0 24 24" fill="none"><path d="M19 6.41L17.59 5L12 10.59L6.41 5L5 6.41L10.59 12L5 17.59L6.41 19L12 13.41L17.59 19L19 17.59L13.41 12L19 6.41Z" fill="currentColor"/></svg>
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
                <svg viewBox="0 0 24 24" fill="none"><path d="M9 16.2L4.8 12L3.4 13.4L9 19L21 7L19.6 5.6L9 16.2Z" fill="currentColor"/></svg>
                <p id="mai-cf-success-msg"></p>
            </div>
        </div>

        <p class="mai-powered-by">Powered by Michelle AI</p>
    </div>
</div>
