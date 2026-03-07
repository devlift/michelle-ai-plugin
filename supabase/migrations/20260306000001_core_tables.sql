-- Migration 001: Core tables for Michelle AI
-- Mirrors the WordPress plugin schema with Postgres-native types

-- Enable required extensions (pgcrypto already in extensions schema on Supabase cloud)
create extension if not exists pgcrypto with schema extensions;

-- =========================================================================
-- conversations
-- =========================================================================
create table public.conversations (
  id               bigint generated always as identity primary key,
  session_token    text not null unique default encode(extensions.gen_random_bytes(32), 'hex'),
  visitor_name     text not null default '',
  visitor_email    text not null default '',
  visitor_ip       text not null default '',
  status           text not null default 'active'
                     check (status in ('active', 'closed', 'archived')),
  unread_admin     boolean not null default false,
  last_message_at  timestamptz,
  created_at       timestamptz not null default now(),

  -- Encrypted PII counterparts (populated by Edge Functions)
  visitor_name_encrypted   bytea,
  visitor_email_encrypted  bytea,
  visitor_ip_encrypted     bytea
);

create index idx_conversations_status on conversations(status);
create index idx_conversations_last_message on conversations(last_message_at desc nulls last);
create index idx_conversations_created on conversations(created_at desc);

-- =========================================================================
-- messages
-- =========================================================================
create table public.messages (
  id               bigint generated always as identity primary key,
  conversation_id  bigint not null references conversations(id) on delete cascade,
  sender_type      text not null check (sender_type in ('visitor', 'admin', 'ai')),
  content          text not null,
  quick_replies    jsonb default null,
  is_pending_mod   boolean not null default false,
  ai_suggestion    text default null,
  created_at       timestamptz not null default now(),

  -- Encrypted content
  content_encrypted bytea
);

create index idx_messages_conversation on messages(conversation_id);
create index idx_messages_conv_id_desc on messages(conversation_id, id desc);
create index idx_messages_created on messages(created_at);

-- =========================================================================
-- extracted_data
-- =========================================================================
create table public.extracted_data (
  id               bigint generated always as identity primary key,
  conversation_id  bigint not null references conversations(id) on delete cascade,
  property_key     text not null,
  property_value   text not null,
  extracted_at     timestamptz not null default now(),

  -- Encrypted value
  property_value_encrypted bytea,

  unique(conversation_id, property_key)
);

create index idx_extracted_conversation on extracted_data(conversation_id);

-- =========================================================================
-- contacts (contact form submissions)
-- =========================================================================
create table public.contacts (
  id            bigint generated always as identity primary key,
  name          text not null,
  address       text not null default '',
  email         text not null,
  message       text not null,
  submitted_at  timestamptz not null default now(),

  -- Encrypted PII
  name_encrypted    bytea,
  address_encrypted bytea,
  email_encrypted   bytea,
  message_encrypted bytea
);

-- =========================================================================
-- agent_settings (replaces wp_options serialized blob)
-- =========================================================================
create table public.agent_settings (
  id         bigint generated always as identity primary key,
  key        text not null unique,
  value      jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

-- =========================================================================
-- admin_users (maps Supabase auth users to admin role)
-- =========================================================================
create table public.admin_users (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  role       text not null default 'admin' check (role in ('admin', 'superadmin')),
  created_at timestamptz not null default now()
);
