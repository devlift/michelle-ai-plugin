<?php
/**
 * Plugin Name: Michelle AI Plugin
 * Plugin URI:  https://github.com/your-repo/michelle-ai-plugin
 * Description: Real-time AI-powered chat widget with multi-conversation management, OpenAI streaming, moderation mode, and a contact form fallback.
 * Version:     1.0.0
 * Author:      Your Name
 * Author URI:  https://yourwebsite.com
 * License:     GPL-2.0-or-later
 * License URI: https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain: michelle-ai-plugin
 * Domain Path: /languages
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

// Constants
define( 'MICHELLE_AI_VERSION',       '1.0.0' );
define( 'MICHELLE_AI_PLUGIN_DIR',    plugin_dir_path( __FILE__ ) );
define( 'MICHELLE_AI_PLUGIN_URL',    plugin_dir_url( __FILE__ ) );
define( 'MICHELLE_AI_PLUGIN_BASENAME', plugin_basename( __FILE__ ) );

// Core includes (order matters — dependencies first)
require_once MICHELLE_AI_PLUGIN_DIR . 'includes/class-michelle-ai-settings.php';
require_once MICHELLE_AI_PLUGIN_DIR . 'includes/class-michelle-ai-db.php';
require_once MICHELLE_AI_PLUGIN_DIR . 'includes/class-michelle-ai-ai.php';
require_once MICHELLE_AI_PLUGIN_DIR . 'includes/class-michelle-ai-chat.php';
require_once MICHELLE_AI_PLUGIN_DIR . 'includes/class-michelle-ai-loader.php';
require_once MICHELLE_AI_PLUGIN_DIR . 'includes/class-michelle-ai-activator.php';
require_once MICHELLE_AI_PLUGIN_DIR . 'includes/class-michelle-ai-deactivator.php';
require_once MICHELLE_AI_PLUGIN_DIR . 'includes/class-michelle-ai.php';
require_once MICHELLE_AI_PLUGIN_DIR . 'admin/class-michelle-ai-admin.php';
require_once MICHELLE_AI_PLUGIN_DIR . 'public/class-michelle-ai-public.php';

// Lifecycle hooks
register_activation_hook( __FILE__, [ 'Michelle_AI_Activator', 'activate' ] );
register_deactivation_hook( __FILE__, [ 'Michelle_AI_Deactivator', 'deactivate' ] );

// Bootstrap
function michelle_ai_run() {
    $plugin = new Michelle_AI();
    $plugin->run();
}
michelle_ai_run();
