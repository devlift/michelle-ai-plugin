-- Migration 002: Row Level Security policies
-- Auth model: visitors use session_token via Edge Functions (service role),
-- admins use Supabase JWT checked against admin_users table.

-- =========================================================================
-- Enable RLS on all tables
-- =========================================================================
alter table conversations enable row level security;
alter table messages enable row level security;
alter table extracted_data enable row level security;
alter table contacts enable row level security;
alter table agent_settings enable row level security;
alter table admin_users enable row level security;

-- =========================================================================
-- Helper: check if current authenticated user is an admin
-- =========================================================================
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from public.admin_users
    where id = auth.uid()
  );
$$;

-- =========================================================================
-- conversations
-- =========================================================================

-- Admins can read all conversations
create policy "admins_select_conversations" on conversations
  for select using (is_admin());

-- Admins can update conversations (status changes, mark read)
create policy "admins_update_conversations" on conversations
  for update using (is_admin());

-- Service role inserts conversations (via Edge Functions for visitors)
-- No direct visitor insert — Edge Functions use service_role key
create policy "service_insert_conversations" on conversations
  for insert with check (true);
  -- Edge Functions run with service_role which bypasses RLS,
  -- but this policy exists as a safety net for anon key usage.

-- =========================================================================
-- messages
-- =========================================================================

-- Admins can read all messages (including pending moderation)
create policy "admins_select_messages" on messages
  for select using (is_admin());

-- Admins can update messages (approve moderation, add quick replies)
create policy "admins_update_messages" on messages
  for update using (is_admin());

-- Insert allowed for service role (Edge Functions handle all inserts)
create policy "service_insert_messages" on messages
  for insert with check (true);

-- =========================================================================
-- extracted_data — admin only
-- =========================================================================
create policy "admins_select_extracted_data" on extracted_data
  for select using (is_admin());

create policy "admins_insert_extracted_data" on extracted_data
  for insert with check (is_admin());

create policy "admins_update_extracted_data" on extracted_data
  for update using (is_admin());

-- Service role also needs insert/update (extraction runs in Edge Functions)
-- Service role bypasses RLS, so these policies are for admin direct access.

-- =========================================================================
-- contacts — anyone can insert, only admins can read
-- =========================================================================
create policy "anyone_insert_contacts" on contacts
  for insert with check (true);

create policy "admins_select_contacts" on contacts
  for select using (is_admin());

-- =========================================================================
-- agent_settings — admin only
-- =========================================================================
create policy "admins_all_settings" on agent_settings
  for all using (is_admin());

-- Public read for widget config (specific keys only, enforced in Edge Function)
-- Edge Functions use service_role to read settings, so no anon policy needed.

-- =========================================================================
-- admin_users — admin can read own and other admins
-- =========================================================================
create policy "admins_select_admin_users" on admin_users
  for select using (is_admin());
