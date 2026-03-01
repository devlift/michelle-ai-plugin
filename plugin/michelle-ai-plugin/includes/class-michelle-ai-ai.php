<?php
/**
 * OpenAI integration — response generation, streaming, and quick-reply suggestions.
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

class Michelle_AI_AI {

    const API_BASE = 'https://api.openai.com/v1';

    // -------------------------------------------------------------------------
    // Public interface
    // -------------------------------------------------------------------------

    /**
     * Generate a chat completion and optionally stream it to the browser via SSE.
     *
     * @param array  $messages     OpenAI messages array [['role'=>..,'content'=>..], ...]
     * @param bool   $stream       If true, output SSE tokens directly. If false, return string.
     * @return string|null         Full response text (non-streaming), or null (streaming).
     */
    public static function generate_response( array $messages, $stream = false ) {
        $api_key = Michelle_AI_Settings::get_api_key();
        if ( ! $api_key ) {
            return null;
        }

        $model       = Michelle_AI_Settings::get( 'openai_model', 'gpt-4o-mini' );
        $temperature = (float) Michelle_AI_Settings::get( 'temperature', 0.7 );
        $system      = Michelle_AI_Settings::get( 'system_prompt', '' );

        // Prepend system prompt
        $payload_messages = [];
        if ( $system ) {
            $payload_messages[] = [ 'role' => 'system', 'content' => $system ];
        }
        foreach ( $messages as $m ) {
            $payload_messages[] = $m;
        }

        $body = [
            'model'       => $model,
            'messages'    => $payload_messages,
            'temperature' => $temperature,
            'stream'      => $stream,
        ];

        if ( $stream ) {
            self::stream_to_browser( $api_key, $body );
            return null;
        }

        return self::blocking_request( $api_key, $body );
    }

    /**
     * Generate 2-3 short quick-reply options relevant to the conversation.
     * Returns an array of strings.
     */
    public static function generate_quick_replies( array $messages ) {
        $api_key = Michelle_AI_Settings::get_api_key();
        if ( ! $api_key ) {
            return [];
        }

        $model       = Michelle_AI_Settings::get( 'openai_model', 'gpt-4o-mini' );
        $temperature = 0.5;

        // Build a condensed conversation summary for the prompt
        $last_ai = '';
        foreach ( array_reverse( $messages ) as $m ) {
            if ( $m['role'] === 'assistant' ) {
                $last_ai = $m['content'];
                break;
            }
        }

        $payload_messages = [
            [
                'role'    => 'system',
                'content' => 'You generate short quick-reply button labels for a chat widget. Given the last assistant message, return exactly a JSON array of 2-3 concise reply options (under 40 chars each) that a visitor might want to click. Return ONLY the JSON array, no other text.',
            ],
            [
                'role'    => 'user',
                'content' => 'Last assistant message: ' . $last_ai,
            ],
        ];

        $body = [
            'model'       => $model,
            'messages'    => $payload_messages,
            'temperature' => $temperature,
            'stream'      => false,
        ];

        $response = self::blocking_request( $api_key, $body );
        if ( ! $response ) {
            return [];
        }

        // Strip possible markdown code fences
        $response = preg_replace( '/^```json?\s*/i', '', trim( $response ) );
        $response = preg_replace( '/```$/', '', $response );

        $decoded = json_decode( trim( $response ), true );
        if ( is_array( $decoded ) ) {
            return array_slice( array_map( 'strval', $decoded ), 0, 3 );
        }

        return [];
    }

    /**
     * Build the OpenAI messages array from a conversation's DB message rows.
     */
    public static function build_messages_for_api( $db_messages ) {
        $context_limit = (int) Michelle_AI_Settings::get( 'context_messages', 10 );
        $result        = [];

        foreach ( $db_messages as $row ) {
            if ( $row->sender_type === 'visitor' ) {
                $result[] = [ 'role' => 'user', 'content' => $row->content ];
            } elseif ( in_array( $row->sender_type, [ 'admin', 'ai' ], true ) ) {
                $result[] = [ 'role' => 'assistant', 'content' => $row->content ];
            }
        }

        // Keep only the last N exchanges
        return array_slice( $result, -$context_limit );
    }

    /**
     * Extract structured data from conversation messages based on configured properties.
     *
     * @param array $messages   OpenAI-style messages array.
     * @param array $properties Array of [ 'key' => ..., 'label' => ..., 'prompt' => ... ].
     * @return array            Associative array of extracted key => value pairs.
     */
    public static function extract_properties( array $messages, array $properties ) {
        $api_key = Michelle_AI_Settings::get_api_key();
        if ( ! $api_key || empty( $properties ) || empty( $messages ) ) {
            return [];
        }

        // Build the property descriptions for the prompt
        $prop_lines = [];
        foreach ( $properties as $prop ) {
            $prop_lines[] = sprintf( '- "%s" (%s): %s', $prop['key'], $prop['label'], $prop['prompt'] );
        }
        $prop_list = implode( "\n", $prop_lines );

        // Only send the last few messages to keep the extraction focused
        $recent = array_slice( $messages, -10 );
        $conversation_text = '';
        foreach ( $recent as $m ) {
            $role = $m['role'] === 'user' ? 'Visitor' : 'Assistant';
            $conversation_text .= "$role: {$m['content']}\n";
        }

        $system = "You are a data extraction assistant. Analyze the conversation below and extract any of the following properties if they are mentioned or can be inferred. Return ONLY a JSON object with the property keys as keys and extracted values as string values. Only include properties where a value was clearly stated or strongly implied. If nothing can be extracted, return an empty JSON object {}. Do not include null values or guesses.\n\nProperties to extract:\n{$prop_list}";

        $payload_messages = [
            [ 'role' => 'system', 'content' => $system ],
            [ 'role' => 'user',   'content' => $conversation_text ],
        ];

        $model = Michelle_AI_Settings::get( 'openai_model', 'gpt-4o-mini' );

        $body = [
            'model'       => $model,
            'messages'    => $payload_messages,
            'temperature' => 0.1,
            'stream'      => false,
        ];

        $response = self::blocking_request( $api_key, $body );
        if ( ! $response ) {
            return [];
        }

        // Strip possible markdown code fences
        $response = preg_replace( '/^```json?\s*/i', '', trim( $response ) );
        $response = preg_replace( '/```$/', '', $response );

        $decoded = json_decode( trim( $response ), true );
        if ( ! is_array( $decoded ) ) {
            return [];
        }

        // Filter to only configured property keys with non-empty string values
        $valid_keys = array_column( $properties, 'key' );
        $result     = [];
        foreach ( $decoded as $k => $v ) {
            if ( in_array( $k, $valid_keys, true ) && is_string( $v ) && $v !== '' ) {
                $result[ $k ] = $v;
            }
        }

        return $result;
    }

    // -------------------------------------------------------------------------
    // SSE streaming output
    // -------------------------------------------------------------------------

    /**
     * Stream an OpenAI response as SSE events directly to the browser.
     * Called inside a REST endpoint that has already set SSE headers.
     */
    public static function stream_to_browser( $api_key, $body ) {
        // Ensure output goes straight to browser
        if ( ob_get_level() ) {
            ob_end_clean();
        }
        ini_set( 'zlib.output_compression', 'Off' );

        $full_text = '';

        $ch = curl_init( self::API_BASE . '/chat/completions' );
        curl_setopt_array( $ch, [
            CURLOPT_POST           => true,
            CURLOPT_HTTPHEADER     => [
                'Authorization: Bearer ' . $api_key,
                'Content-Type: application/json',
                'Accept: text/event-stream',
            ],
            CURLOPT_POSTFIELDS     => wp_json_encode( $body ),
            CURLOPT_RETURNTRANSFER => false,
            CURLOPT_WRITEFUNCTION  => function ( $ch, $data ) use ( &$full_text ) {
                $lines = explode( "\n", $data );
                foreach ( $lines as $line ) {
                    $line = trim( $line );
                    if ( strpos( $line, 'data: ' ) !== 0 ) {
                        continue;
                    }
                    $payload = substr( $line, 6 );
                    if ( $payload === '[DONE]' ) {
                        echo "data: [DONE]\n\n";
                        flush();
                        continue;
                    }
                    $json  = json_decode( $payload, true );
                    $token = $json['choices'][0]['delta']['content'] ?? null;
                    if ( $token !== null ) {
                        $full_text .= $token;
                        echo 'data: ' . wp_json_encode( [ 'token' => $token ] ) . "\n\n";
                        flush();
                    }
                }
                return strlen( $data );
            },
            CURLOPT_TIMEOUT        => 120,
        ] );

        curl_exec( $ch );
        curl_close( $ch );

        return $full_text;
    }

    // -------------------------------------------------------------------------
    // Blocking (non-streaming) request
    // -------------------------------------------------------------------------

    private static function blocking_request( $api_key, $body ) {
        $response = wp_remote_post( self::API_BASE . '/chat/completions', [
            'headers' => [
                'Authorization' => 'Bearer ' . $api_key,
                'Content-Type'  => 'application/json',
            ],
            'body'    => wp_json_encode( $body ),
            'timeout' => 60,
        ] );

        if ( is_wp_error( $response ) ) {
            error_log( 'Michelle AI: OpenAI request failed — ' . $response->get_error_message() );
            return null;
        }

        $resp_body = wp_remote_retrieve_body( $response );
        $http_code = wp_remote_retrieve_response_code( $response );
        if ( $http_code >= 400 ) {
            error_log( 'Michelle AI: OpenAI HTTP ' . $http_code . ' — ' . substr( $resp_body, 0, 500 ) );
        }

        $data = json_decode( $resp_body, true );
        return $data['choices'][0]['message']['content'] ?? null;
    }
}
