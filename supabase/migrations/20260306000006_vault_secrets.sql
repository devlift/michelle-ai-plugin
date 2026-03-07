-- Migration 006: API key storage in private schema
-- API keys (OpenAI, ElevenLabs) stored encrypted alongside PII key.
-- Edge Functions retrieve them via get_secret().

-- =========================================================================
-- get_secret(name) — retrieve a secret from private.encryption_keys
-- =========================================================================
create or replace function public.get_secret(secret_name text)
returns text
language plpgsql
security definer
as $$
declare
  result text;
begin
  select key into result
  from private.encryption_keys
  where name = secret_name;

  return result;
end;
$$;

-- Restrict access
revoke execute on function get_secret from public, anon;
grant execute on function get_secret to service_role;

-- =========================================================================
-- set_secret(name, value) — upsert a secret in private.encryption_keys
-- =========================================================================
create or replace function public.set_secret(secret_name text, secret_value text)
returns void
language plpgsql
security definer
as $$
begin
  insert into private.encryption_keys (name, key)
  values (secret_name, secret_value)
  on conflict (name) do update set key = excluded.key;
end;
$$;

revoke execute on function set_secret from public, anon;
grant execute on function set_secret to service_role;

-- Seed placeholder entries for API keys
insert into private.encryption_keys (name, key)
values
  ('openai_api_key', ''),
  ('elevenlabs_api_key', '')
on conflict (name) do nothing;
