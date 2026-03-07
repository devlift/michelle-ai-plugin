-- Migration 004: PII column-level encryption using pgcrypto
-- Uses AES-256 symmetric encryption via pgp_sym_encrypt/pgp_sym_decrypt.
-- The encryption key is stored in a private table, inaccessible to public/anon.

-- =========================================================================
-- Private table for encryption keys (not exposed via PostgREST)
-- =========================================================================
create schema if not exists private;

create table private.encryption_keys (
  name text primary key,
  key  text not null
);

-- Seed a random 256-bit key for PII encryption
insert into private.encryption_keys (name, key)
values ('pii', encode(extensions.gen_random_bytes(32), 'hex'));

-- =========================================================================
-- encrypt_pii(plaintext) → bytea
-- =========================================================================
create or replace function public.encrypt_pii(plaintext text)
returns bytea
language plpgsql
security definer
as $$
declare
  enc_key text;
begin
  if plaintext is null or plaintext = '' then
    return null;
  end if;

  select key into enc_key
  from private.encryption_keys
  where name = 'pii';

  return extensions.pgp_sym_encrypt(plaintext, enc_key)::bytea;
end;
$$;

-- =========================================================================
-- decrypt_pii(ciphertext) → text
-- =========================================================================
create or replace function public.decrypt_pii(ciphertext bytea)
returns text
language plpgsql
security definer
as $$
declare
  enc_key text;
begin
  if ciphertext is null then
    return null;
  end if;

  select key into enc_key
  from private.encryption_keys
  where name = 'pii';

  return extensions.pgp_sym_decrypt(ciphertext, enc_key);
end;
$$;

-- Restrict access: only service_role and authenticated (admin) users
revoke execute on function encrypt_pii from public, anon;
revoke execute on function decrypt_pii from public, anon;
grant execute on function encrypt_pii to authenticated, service_role;
grant execute on function decrypt_pii to authenticated, service_role;
