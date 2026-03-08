<?php
/**
 * Admin: Contact form submissions page.
 */
if ( ! defined( 'ABSPATH' ) ) { exit; }

$contacts = Michelle_AI_Supabase::get_contacts( 100 );
?>
<div class="wrap mai-admin">
    <h1 class="wp-heading-inline">
        <?php esc_html_e( 'Contact Form Submissions', 'michelle-ai-plugin' ); ?>
    </h1>

    <?php if ( empty( $contacts ) ) : ?>
        <div class="mai-empty" style="margin-top:20px;">
            <p><?php esc_html_e( 'No contact form submissions yet.', 'michelle-ai-plugin' ); ?></p>
        </div>
    <?php else : ?>
        <table class="wp-list-table widefat fixed striped" style="margin-top:20px;">
            <thead>
                <tr>
                    <th style="width:160px;"><?php esc_html_e( 'Name', 'michelle-ai-plugin' ); ?></th>
                    <th style="width:200px;"><?php esc_html_e( 'Email', 'michelle-ai-plugin' ); ?></th>
                    <th style="width:180px;"><?php esc_html_e( 'Address', 'michelle-ai-plugin' ); ?></th>
                    <th><?php esc_html_e( 'Message', 'michelle-ai-plugin' ); ?></th>
                    <th style="width:160px;"><?php esc_html_e( 'Submitted', 'michelle-ai-plugin' ); ?></th>
                </tr>
            </thead>
            <tbody>
                <?php foreach ( $contacts as $c ) : ?>
                    <tr>
                        <td><?php echo esc_html( $c->name ); ?></td>
                        <td>
                            <?php if ( $c->email ) : ?>
                                <a href="mailto:<?php echo esc_attr( $c->email ); ?>"><?php echo esc_html( $c->email ); ?></a>
                            <?php endif; ?>
                        </td>
                        <td><?php echo esc_html( $c->address ); ?></td>
                        <td><?php echo esc_html( $c->message ); ?></td>
                        <td>
                            <?php
                            if ( $c->submitted_at ) {
                                $ts = strtotime( $c->submitted_at );
                                echo esc_html( human_time_diff( $ts, current_time( 'timestamp' ) ) . ' ago' );
                                echo '<br><small style="color:#64748b;">' . esc_html( wp_date( 'M j, Y g:i a', $ts ) ) . '</small>';
                            }
                            ?>
                        </td>
                    </tr>
                <?php endforeach; ?>
            </tbody>
        </table>
    <?php endif; ?>
</div>
