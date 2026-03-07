-- Migration 003: HIPAA audit logging
-- Tracks all INSERT, UPDATE, DELETE on PHI-containing tables.

-- =========================================================================
-- audit_log table
-- =========================================================================
create table public.audit_log (
  id          bigint generated always as identity primary key,
  table_name  text not null,
  record_id   text,
  action      text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  actor_id    uuid,
  actor_type  text not null default 'system'
                check (actor_type in ('visitor', 'admin', 'system', 'ai')),
  ip_address  text,
  old_data    jsonb,
  new_data    jsonb,
  metadata    jsonb default '{}',
  created_at  timestamptz not null default now()
);

create index idx_audit_table on audit_log(table_name);
create index idx_audit_created on audit_log(created_at desc);
create index idx_audit_actor on audit_log(actor_id);
create index idx_audit_record on audit_log(table_name, record_id);

-- RLS: only admins can read audit logs, nobody can modify
alter table audit_log enable row level security;

create policy "admins_read_audit_log" on audit_log
  for select using (public.is_admin());

-- No insert/update/delete policies for users — only triggers and service role can write

-- =========================================================================
-- Trigger function
-- =========================================================================
create or replace function public.audit_trigger_fn()
returns trigger
language plpgsql
security definer
as $$
declare
  v_actor_id uuid;
  v_actor_type text;
begin
  -- Try to get the current auth user
  begin
    v_actor_id := auth.uid();
  exception when others then
    v_actor_id := null;
  end;

  -- Determine actor type
  if v_actor_id is not null and exists (select 1 from public.admin_users where id = v_actor_id) then
    v_actor_type := 'admin';
  elsif v_actor_id is not null then
    v_actor_type := 'visitor';
  else
    v_actor_type := 'system';
  end if;

  if TG_OP = 'INSERT' then
    insert into public.audit_log (table_name, record_id, action, actor_id, actor_type, new_data)
    values (TG_TABLE_NAME, NEW.id::text, 'INSERT', v_actor_id, v_actor_type, to_jsonb(NEW));
    return NEW;

  elsif TG_OP = 'UPDATE' then
    insert into public.audit_log (table_name, record_id, action, actor_id, actor_type, old_data, new_data)
    values (TG_TABLE_NAME, NEW.id::text, 'UPDATE', v_actor_id, v_actor_type, to_jsonb(OLD), to_jsonb(NEW));
    return NEW;

  elsif TG_OP = 'DELETE' then
    insert into public.audit_log (table_name, record_id, action, actor_id, actor_type, old_data)
    values (TG_TABLE_NAME, OLD.id::text, 'DELETE', v_actor_id, v_actor_type, to_jsonb(OLD));
    return OLD;
  end if;

  return null;
end;
$$;

-- =========================================================================
-- Attach triggers to all PHI-containing tables
-- =========================================================================
create trigger audit_conversations
  after insert or update or delete on conversations
  for each row execute function audit_trigger_fn();

create trigger audit_messages
  after insert or update or delete on messages
  for each row execute function audit_trigger_fn();

create trigger audit_extracted_data
  after insert or update or delete on extracted_data
  for each row execute function audit_trigger_fn();

create trigger audit_contacts
  after insert or update or delete on contacts
  for each row execute function audit_trigger_fn();
