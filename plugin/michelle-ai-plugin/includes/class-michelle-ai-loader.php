<?php
/**
 * Registers all actions and filters for the plugin.
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

class Michelle_AI_Loader {

    protected $actions = [];
    protected $filters = [];

    public function add_action( $hook, $component, $callback, $priority = 10, $accepted_args = 1 ) {
        $this->actions = $this->add( $this->actions, $hook, $component, $callback, $priority, $accepted_args );
    }

    public function add_filter( $hook, $component, $callback, $priority = 10, $accepted_args = 1 ) {
        $this->filters = $this->add( $this->filters, $hook, $component, $callback, $priority, $accepted_args );
    }

    private function add( $hooks, $hook, $component, $callback, $priority, $accepted_args ) {
        $hooks[] = compact( 'hook', 'component', 'callback', 'priority', 'accepted_args' );
        return $hooks;
    }

    public function run() {
        foreach ( $this->actions as $hook ) {
            add_action(
                $hook['hook'],
                [ $hook['component'], $hook['callback'] ],
                $hook['priority'],
                $hook['accepted_args']
            );
        }

        foreach ( $this->filters as $hook ) {
            add_filter(
                $hook['hook'],
                [ $hook['component'], $hook['callback'] ],
                $hook['priority'],
                $hook['accepted_args']
            );
        }
    }
}
