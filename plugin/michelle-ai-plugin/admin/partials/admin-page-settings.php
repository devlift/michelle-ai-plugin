<?php
/**
 * Admin: Settings page — 5 tabs.
 */
if ( ! defined( 'ABSPATH' ) ) { exit; }

$s = Michelle_AI_Settings::all();

// Mask API key
$api_key_display = $s['openai_api_key'] ? '••••••••' : '';
?>
<div class="wrap mai-admin">
    <h1><?php esc_html_e( 'Michelle AI — Settings', 'michelle-ai-plugin' ); ?></h1>

    <div id="mai-settings-saved" class="notice notice-success is-dismissible" hidden>
        <p><?php esc_html_e( 'Settings saved.', 'michelle-ai-plugin' ); ?></p>
    </div>

    <div class="mai-tabs">
        <a href="#branding" class="mai-tab mai-tab-active" data-tab="branding"><?php esc_html_e( 'Branding', 'michelle-ai-plugin' ); ?></a>
        <a href="#chat"     class="mai-tab" data-tab="chat"><?php esc_html_e( 'Chat', 'michelle-ai-plugin' ); ?></a>
        <a href="#ai"       class="mai-tab" data-tab="ai"><?php esc_html_e( 'AI', 'michelle-ai-plugin' ); ?></a>
        <a href="#extraction" class="mai-tab" data-tab="extraction"><?php esc_html_e( 'Data Collection', 'michelle-ai-plugin' ); ?></a>
        <a href="#contact"  class="mai-tab" data-tab="contact"><?php esc_html_e( 'Contact Form', 'michelle-ai-plugin' ); ?></a>
    </div>

    <form id="mai-settings-form">
        <?php wp_nonce_field( 'mai_settings_save', 'mai_settings_nonce' ); ?>

        <!-- ── Branding ──────────────────────────────────────────────────── -->
        <div class="mai-tab-panel" id="mai-tab-branding">
            <table class="form-table">
                <tr>
                    <th><label for="widget_title"><?php esc_html_e( 'Widget Title', 'michelle-ai-plugin' ); ?></label></th>
                    <td>
                        <input type="text" id="widget_title" name="widget_title" value="<?php echo esc_attr( $s['widget_title'] ); ?>" class="regular-text" />
                        <p class="description"><?php esc_html_e( 'Shown in the chat window header.', 'michelle-ai-plugin' ); ?></p>
                    </td>
                </tr>
                <tr>
                    <th><label for="agent_name"><?php esc_html_e( 'Agent Name', 'michelle-ai-plugin' ); ?></label></th>
                    <td><input type="text" id="agent_name" name="agent_name" value="<?php echo esc_attr( $s['agent_name'] ); ?>" class="regular-text" /></td>
                </tr>
                <tr>
                    <th><label for="welcome_message"><?php esc_html_e( 'Welcome Message', 'michelle-ai-plugin' ); ?></label></th>
                    <td>
                        <textarea id="welcome_message" name="welcome_message" rows="3" class="large-text"><?php echo esc_textarea( $s['welcome_message'] ); ?></textarea>
                        <p class="description"><?php esc_html_e( 'Sent automatically when a visitor opens the chat.', 'michelle-ai-plugin' ); ?></p>
                    </td>
                </tr>
                <tr>
                    <th><label for="primary_color"><?php esc_html_e( 'Primary Color', 'michelle-ai-plugin' ); ?></label></th>
                    <td>
                        <input type="color" id="primary_color" name="primary_color" value="<?php echo esc_attr( $s['primary_color'] ); ?>" />
                        <p class="description"><?php esc_html_e( 'FAB button, header, visitor bubbles.', 'michelle-ai-plugin' ); ?></p>
                    </td>
                </tr>
                <tr>
                    <th><label for="secondary_color"><?php esc_html_e( 'Secondary Color', 'michelle-ai-plugin' ); ?></label></th>
                    <td>
                        <input type="color" id="secondary_color" name="secondary_color" value="<?php echo esc_attr( $s['secondary_color'] ); ?>" />
                        <p class="description"><?php esc_html_e( 'AI / admin reply bubbles background.', 'michelle-ai-plugin' ); ?></p>
                    </td>
                </tr>
                <tr>
                    <th><label for="logo_url"><?php esc_html_e( 'Logo / Avatar URL', 'michelle-ai-plugin' ); ?></label></th>
                    <td>
                        <input type="url" id="logo_url" name="logo_url" value="<?php echo esc_attr( $s['logo_url'] ); ?>" class="large-text" />
                        <p class="description"><?php esc_html_e( 'Leave empty to use initial letter avatar.', 'michelle-ai-plugin' ); ?></p>
                    </td>
                </tr>
            </table>
        </div>

        <!-- ── Chat ─────────────────────────────────────────────────────── -->
        <div class="mai-tab-panel" id="mai-tab-chat" hidden>
            <table class="form-table">
                <tr>
                    <th><?php esc_html_e( 'Chat Status', 'michelle-ai-plugin' ); ?></th>
                    <td>
                        <label>
                            <input type="checkbox" name="chat_enabled" value="1" <?php checked( $s['chat_enabled'] ); ?> />
                            <?php esc_html_e( 'Chat enabled — shows live chat widget', 'michelle-ai-plugin' ); ?>
                        </label>
                        <p class="description"><?php esc_html_e( 'When disabled, the widget shows the Contact Form instead.', 'michelle-ai-plugin' ); ?></p>
                    </td>
                </tr>
                <tr>
                    <th><?php esc_html_e( 'Auto Reply', 'michelle-ai-plugin' ); ?></th>
                    <td>
                        <label>
                            <input type="checkbox" name="auto_reply" value="1" <?php checked( $s['auto_reply'] ); ?> />
                            <?php esc_html_e( 'Enable AI auto-reply', 'michelle-ai-plugin' ); ?>
                        </label>
                        <p class="description"><?php esc_html_e( 'AI automatically replies to visitor messages. When off, AI only suggests replies to the admin.', 'michelle-ai-plugin' ); ?></p>
                    </td>
                </tr>
                <tr>
                    <th><?php esc_html_e( 'Moderation Mode', 'michelle-ai-plugin' ); ?></th>
                    <td>
                        <label>
                            <input type="checkbox" name="moderation_mode" value="1" <?php checked( $s['moderation_mode'] ); ?> />
                            <?php esc_html_e( 'Require admin approval before AI replies are sent', 'michelle-ai-plugin' ); ?>
                        </label>
                        <p class="description"><?php esc_html_e( 'AI responses are held for review. Admin must click "Approve" before the visitor sees them.', 'michelle-ai-plugin' ); ?></p>
                    </td>
                </tr>
                <tr>
                    <th><?php esc_html_e( 'Notification Sound', 'michelle-ai-plugin' ); ?></th>
                    <td>
                        <label>
                            <input type="checkbox" name="notification_sound" value="1" <?php checked( $s['notification_sound'] ); ?> />
                            <?php esc_html_e( 'Play sound on new message (admin)', 'michelle-ai-plugin' ); ?>
                        </label>
                    </td>
                </tr>
            </table>
        </div>

        <!-- ── AI ───────────────────────────────────────────────────────── -->
        <div class="mai-tab-panel" id="mai-tab-ai" hidden>
            <table class="form-table">
                <tr>
                    <th><label for="openai_api_key"><?php esc_html_e( 'OpenAI API Key', 'michelle-ai-plugin' ); ?></label></th>
                    <td>
                        <input type="password" id="openai_api_key" name="openai_api_key" value="<?php echo esc_attr( $api_key_display ); ?>" class="large-text" autocomplete="new-password" placeholder="sk-..." />
                        <p class="description"><?php esc_html_e( 'Your key is encrypted in the database. Paste a new key to update it.', 'michelle-ai-plugin' ); ?></p>
                    </td>
                </tr>
                <tr>
                    <th><label for="openai_model"><?php esc_html_e( 'Model', 'michelle-ai-plugin' ); ?></label></th>
                    <td>
                        <select id="openai_model" name="openai_model">
                            <optgroup label="GPT-5 Series">
                                <option value="gpt-5.2"     <?php selected( $s['openai_model'], 'gpt-5.2' ); ?>>gpt-5.2</option>
                                <option value="gpt-5.2-pro" <?php selected( $s['openai_model'], 'gpt-5.2-pro' ); ?>>gpt-5.2-pro</option>
                                <option value="gpt-5"       <?php selected( $s['openai_model'], 'gpt-5' ); ?>>gpt-5</option>
                                <option value="gpt-5-mini"  <?php selected( $s['openai_model'], 'gpt-5-mini' ); ?>>gpt-5-mini (recommended)</option>
                                <option value="gpt-5-nano"  <?php selected( $s['openai_model'], 'gpt-5-nano' ); ?>>gpt-5-nano</option>
                            </optgroup>
                            <optgroup label="GPT-4 Series">
                                <option value="gpt-4.1"     <?php selected( $s['openai_model'], 'gpt-4.1' ); ?>>gpt-4.1</option>
                                <option value="gpt-4o"      <?php selected( $s['openai_model'], 'gpt-4o' ); ?>>gpt-4o</option>
                                <option value="gpt-4o-mini" <?php selected( $s['openai_model'], 'gpt-4o-mini' ); ?>>gpt-4o-mini</option>
                            </optgroup>
                        </select>
                    </td>
                </tr>
                <tr>
                    <th><label for="system_prompt"><?php esc_html_e( 'System Prompt', 'michelle-ai-plugin' ); ?></label></th>
                    <td>
                        <textarea id="system_prompt" name="system_prompt" rows="6" class="large-text"><?php echo esc_textarea( $s['system_prompt'] ); ?></textarea>
                        <p class="description"><?php esc_html_e( 'Instructions that define the AI\'s personality and scope.', 'michelle-ai-plugin' ); ?></p>
                    </td>
                </tr>
                <tr>
                    <th><label for="context_messages"><?php esc_html_e( 'Context Window', 'michelle-ai-plugin' ); ?></label></th>
                    <td>
                        <input type="number" id="context_messages" name="context_messages" value="<?php echo (int) $s['context_messages']; ?>" min="2" max="50" class="small-text" />
                        <p class="description"><?php esc_html_e( 'Number of recent messages to include as context for the AI.', 'michelle-ai-plugin' ); ?></p>
                    </td>
                </tr>
                <tr>
                    <th><label for="temperature"><?php esc_html_e( 'Temperature', 'michelle-ai-plugin' ); ?></label></th>
                    <td>
                        <input type="range" id="temperature" name="temperature" value="<?php echo esc_attr( $s['temperature'] ); ?>" min="0" max="2" step="0.1" />
                        <output id="temperature_output"><?php echo esc_html( $s['temperature'] ); ?></output>
                        <p class="description"><?php esc_html_e( '0 = deterministic, 1 = creative. Recommended: 0.7', 'michelle-ai-plugin' ); ?></p>
                    </td>
                </tr>
            </table>
        </div>

        <!-- ── Data Collection ────────────────────────────────────────────── -->
        <div class="mai-tab-panel" id="mai-tab-extraction" hidden>
            <table class="form-table">
                <tr>
                    <th><?php esc_html_e( 'Data Extraction', 'michelle-ai-plugin' ); ?></th>
                    <td>
                        <label>
                            <input type="checkbox" name="extraction_enabled" value="1" <?php checked( $s['extraction_enabled'] ); ?> />
                            <?php esc_html_e( 'Enable automatic data extraction from conversations', 'michelle-ai-plugin' ); ?>
                        </label>
                        <p class="description"><?php esc_html_e( 'When enabled, the AI will attempt to extract configured properties from conversation messages.', 'michelle-ai-plugin' ); ?></p>
                    </td>
                </tr>
            </table>

            <h3><?php esc_html_e( 'Extraction Properties', 'michelle-ai-plugin' ); ?></h3>
            <p class="description" style="margin-bottom:12px;">
                <?php esc_html_e( 'Define the properties the AI should extract from conversations. Each property needs a unique key, a display label, and a prompt describing when and how to extract the value.', 'michelle-ai-plugin' ); ?>
            </p>

            <div id="mai-extraction-props">
                <?php
                $props = $s['extraction_properties'];
                if ( ! is_array( $props ) ) { $props = []; }
                if ( empty( $props ) ) {
                    // Show two blank starter rows
                    $props = [
                        [ 'key' => 'first_name', 'label' => 'First Name', 'prompt' => 'Extract the visitor\'s first name if they mention it.' ],
                        [ 'key' => 'last_name',  'label' => 'Last Name',  'prompt' => 'Extract the visitor\'s last name if they mention it.' ],
                    ];
                }
                foreach ( $props as $i => $prop ) : ?>
                    <div class="mai-prop-row" data-index="<?php echo (int) $i; ?>">
                        <input type="text" class="mai-prop-key" placeholder="<?php esc_attr_e( 'key (e.g. city)', 'michelle-ai-plugin' ); ?>" value="<?php echo esc_attr( $prop['key'] ?? '' ); ?>" />
                        <input type="text" class="mai-prop-label" placeholder="<?php esc_attr_e( 'Label (e.g. City)', 'michelle-ai-plugin' ); ?>" value="<?php echo esc_attr( $prop['label'] ?? '' ); ?>" />
                        <input type="text" class="mai-prop-prompt" placeholder="<?php esc_attr_e( 'Extraction prompt...', 'michelle-ai-plugin' ); ?>" value="<?php echo esc_attr( $prop['prompt'] ?? '' ); ?>" />
                        <button type="button" class="button mai-prop-remove" title="<?php esc_attr_e( 'Remove', 'michelle-ai-plugin' ); ?>">&times;</button>
                    </div>
                <?php endforeach; ?>
            </div>
            <p><button type="button" class="button" id="mai-add-prop"><?php esc_html_e( '+ Add Property', 'michelle-ai-plugin' ); ?></button></p>
        </div>

        <!-- ── Contact Form ─────────────────────────────────────────────── -->
        <div class="mai-tab-panel" id="mai-tab-contact" hidden>
            <table class="form-table">
                <tr>
                    <th><label for="form_title"><?php esc_html_e( 'Form Title', 'michelle-ai-plugin' ); ?></label></th>
                    <td><input type="text" id="form_title" name="form_title" value="<?php echo esc_attr( $s['form_title'] ); ?>" class="regular-text" /></td>
                </tr>
                <tr>
                    <th><label for="form_label_name"><?php esc_html_e( 'Name Label', 'michelle-ai-plugin' ); ?></label></th>
                    <td><input type="text" id="form_label_name" name="form_label_name" value="<?php echo esc_attr( $s['form_label_name'] ); ?>" class="regular-text" /></td>
                </tr>
                <tr>
                    <th><label for="form_label_address"><?php esc_html_e( 'Address Label', 'michelle-ai-plugin' ); ?></label></th>
                    <td><input type="text" id="form_label_address" name="form_label_address" value="<?php echo esc_attr( $s['form_label_address'] ); ?>" class="regular-text" /></td>
                </tr>
                <tr>
                    <th><label for="form_label_email"><?php esc_html_e( 'Email Label', 'michelle-ai-plugin' ); ?></label></th>
                    <td><input type="text" id="form_label_email" name="form_label_email" value="<?php echo esc_attr( $s['form_label_email'] ); ?>" class="regular-text" /></td>
                </tr>
                <tr>
                    <th><label for="form_label_message"><?php esc_html_e( 'Message Label', 'michelle-ai-plugin' ); ?></label></th>
                    <td><input type="text" id="form_label_message" name="form_label_message" value="<?php echo esc_attr( $s['form_label_message'] ); ?>" class="regular-text" /></td>
                </tr>
                <tr>
                    <th><label for="form_submit_label"><?php esc_html_e( 'Submit Button Label', 'michelle-ai-plugin' ); ?></label></th>
                    <td><input type="text" id="form_submit_label" name="form_submit_label" value="<?php echo esc_attr( $s['form_submit_label'] ); ?>" class="regular-text" /></td>
                </tr>
                <tr>
                    <th><label for="form_success_msg"><?php esc_html_e( 'Success Message', 'michelle-ai-plugin' ); ?></label></th>
                    <td><input type="text" id="form_success_msg" name="form_success_msg" value="<?php echo esc_attr( $s['form_success_msg'] ); ?>" class="large-text" /></td>
                </tr>
                <tr>
                    <th><label for="form_notify_email"><?php esc_html_e( 'Notification Email', 'michelle-ai-plugin' ); ?></label></th>
                    <td>
                        <input type="email" id="form_notify_email" name="form_notify_email" value="<?php echo esc_attr( $s['form_notify_email'] ); ?>" class="regular-text" />
                        <p class="description"><?php esc_html_e( 'Receives an email for each contact form submission.', 'michelle-ai-plugin' ); ?></p>
                    </td>
                </tr>
            </table>
        </div>

        <p class="submit">
            <button type="submit" class="button button-primary" id="mai-save-settings">
                <?php esc_html_e( 'Save Settings', 'michelle-ai-plugin' ); ?>
            </button>
        </p>
    </form>
</div>
