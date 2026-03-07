-- Seed data for local development
-- Creates test conversations, messages, settings, and an admin user.

-- =========================================================================
-- Default agent settings (mirrors WordPress plugin defaults)
-- =========================================================================
INSERT INTO agent_settings (key, value) VALUES
  ('widget_title',      '"Chat with us"'),
  ('agent_name',        '"Support"'),
  ('welcome_message',   '"Hi there! How can we help you today?"'),
  ('primary_color',     '"#2563eb"'),
  ('secondary_color',   '"#f1f5f9"'),
  ('logo_url',          '""'),
  ('fab_icon',          '"bubble"'),
  ('widget_visible',    'true'),
  ('chat_enabled',      'true'),
  ('auto_reply',        'true'),
  ('moderation_mode',   'false'),
  ('notification_sound','true'),
  ('openai_model',      '"gpt-4o-mini"'),
  ('system_prompt',     '"You are a helpful and friendly customer support assistant. Be concise and professional."'),
  ('context_messages',  '10'),
  ('temperature',       '0.7'),
  ('audio_enabled',     'false'),
  ('audio_agent_id',    '""'),
  ('extraction_enabled','false'),
  ('extraction_properties', '[]'),
  ('document_templates','[]'),
  ('letterhead_url',    '""'),
  ('form_title',        '"Send us a message"'),
  ('form_label_name',   '"Your Name"'),
  ('form_label_address','"Address (optional)"'),
  ('form_label_email',  '"Email Address"'),
  ('form_label_message','"Message"'),
  ('form_submit_label', '"Send Message"'),
  ('form_success_msg',  '"Thanks! We''ll be in touch soon."'),
  ('form_notify_email', '"admin@example.com"')
ON CONFLICT (key) DO NOTHING;

-- =========================================================================
-- Test conversations
-- =========================================================================
INSERT INTO conversations (session_token, visitor_name, status, unread_admin, last_message_at,
                           visitor_name_encrypted, visitor_email_encrypted, visitor_ip_encrypted)
VALUES
  ('test_token_001', 'Jane Smith', 'active', true, now() - interval '5 minutes',
   encrypt_pii('Jane Smith'), encrypt_pii('jane@example.com'), encrypt_pii('10.0.0.1')),
  ('test_token_002', 'Bob Wilson', 'active', false, now() - interval '1 hour',
   encrypt_pii('Bob Wilson'), encrypt_pii('bob@example.com'), encrypt_pii('10.0.0.2')),
  ('test_token_003', 'Alice Chen', 'closed', false, now() - interval '1 day',
   encrypt_pii('Alice Chen'), encrypt_pii('alice@example.com'), encrypt_pii('10.0.0.3'));

-- =========================================================================
-- Test messages
-- =========================================================================
-- Conversation 1: Jane Smith (active, unread)
INSERT INTO messages (conversation_id, sender_type, content, content_encrypted, created_at) VALUES
  (1, 'ai', 'Hi there! How can we help you today?', encrypt_pii('Hi there! How can we help you today?'), now() - interval '10 minutes'),
  (1, 'visitor', 'I have a question about your services', encrypt_pii('I have a question about your services'), now() - interval '5 minutes');

-- Conversation 2: Bob Wilson (active, read)
INSERT INTO messages (conversation_id, sender_type, content, content_encrypted, quick_replies, created_at) VALUES
  (2, 'ai', 'Hi there! How can we help you today?', encrypt_pii('Hi there! How can we help you today?'), null, now() - interval '2 hours'),
  (2, 'visitor', 'What are your office hours?', encrypt_pii('What are your office hours?'), null, now() - interval '1 hour 55 minutes'),
  (2, 'ai', 'Our office hours are Monday to Friday, 9am to 5pm EST.', encrypt_pii('Our office hours are Monday to Friday, 9am to 5pm EST.'), '["Thanks!", "Any weekend hours?", "How about holidays?"]', now() - interval '1 hour 54 minutes'),
  (2, 'visitor', 'Thanks!', encrypt_pii('Thanks!'), null, now() - interval '1 hour'),
  (2, 'admin', 'You''re welcome! Let us know if you need anything else.', encrypt_pii('You''re welcome! Let us know if you need anything else.'), null, now() - interval '55 minutes');

-- Conversation 3: Alice Chen (closed)
INSERT INTO messages (conversation_id, sender_type, content, content_encrypted, created_at) VALUES
  (3, 'ai', 'Hi there! How can we help you today?', encrypt_pii('Hi there! How can we help you today?'), now() - interval '1 day'),
  (3, 'visitor', 'I need to cancel my appointment', encrypt_pii('I need to cancel my appointment'), now() - interval '23 hours'),
  (3, 'ai', 'I can help with that. Could you provide your appointment date?', encrypt_pii('I can help with that. Could you provide your appointment date?'), now() - interval '23 hours'),
  (3, 'visitor', 'March 15th at 2pm', encrypt_pii('March 15th at 2pm'), now() - interval '22 hours'),
  (3, 'admin', 'Your appointment on March 15th has been cancelled. Is there anything else I can help with?', encrypt_pii('Your appointment on March 15th has been cancelled. Is there anything else I can help with?'), now() - interval '21 hours');

-- =========================================================================
-- Test extracted data
-- =========================================================================
INSERT INTO extracted_data (conversation_id, property_key, property_value, property_value_encrypted) VALUES
  (1, 'first_name', '', encrypt_pii('Jane')),
  (1, 'last_name', '', encrypt_pii('Smith')),
  (2, 'first_name', '', encrypt_pii('Bob')),
  (2, 'last_name', '', encrypt_pii('Wilson')),
  (3, 'first_name', '', encrypt_pii('Alice')),
  (3, 'last_name', '', encrypt_pii('Chen')),
  (3, 'appointment_date', '', encrypt_pii('March 15th at 2pm'));
