-- Pastebox link-only file sharing.
-- This migration is intended to be reviewed and applied by the project owner.
-- It does not contain project credentials or share tokens.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- A private bucket with a hard 50 MiB per-object limit. MIME types remain unrestricted.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pastebox-files', 'pastebox-files', false, 52428800, null)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = null;

create table if not exists public.pastebox_shares (
  id uuid primary key default gen_random_uuid(),
  token_hash text unique,
  storage_path text not null unique,
  original_name text not null check (char_length(original_name) between 1 and 255),
  file_size bigint not null check (file_size between 1 and 52428800),
  uploader_name text not null check (char_length(uploader_name) between 2 and 80),
  purpose text not null check (char_length(purpose) between 10 and 240),
  status text not null default 'pending' check (status in ('pending', 'active')),
  created_at timestamptz not null default now(),
  pending_expires_at timestamptz not null default (now() + interval '30 minutes'),
  uploaded_at timestamptz,
  expires_at timestamptz,
  constraint pastebox_active_share_has_token check (
    (status = 'pending' and token_hash is null and uploaded_at is null and expires_at is null)
    or
    (status = 'active' and token_hash ~ '^[a-f0-9]{64}$' and uploaded_at is not null and expires_at is not null)
  )
);

create index if not exists pastebox_shares_expiry_idx
  on public.pastebox_shares (expires_at)
  where status = 'active';

create index if not exists pastebox_shares_pending_idx
  on public.pastebox_shares (pending_expires_at)
  where status = 'pending';

alter table public.pastebox_shares enable row level security;
revoke all on table public.pastebox_shares from public, anon, authenticated;
grant all on table public.pastebox_shares to service_role;

-- Store only HMAC-SHA-256 hashes of client IPs, never raw IP addresses.
create table if not exists public.pastebox_upload_limits (
  ip_hash text primary key check (ip_hash ~ '^[a-f0-9]{64}$'),
  window_started_at timestamptz not null,
  upload_count integer not null check (upload_count > 0)
);

alter table public.pastebox_upload_limits enable row level security;
revoke all on table public.pastebox_upload_limits from public, anon, authenticated;
grant all on table public.pastebox_upload_limits to service_role;

create or replace function public.consume_pastebox_upload_slot(p_ip_hash text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_upload_count integer;
begin
  if p_ip_hash !~ '^[a-f0-9]{64}$' then
    return false;
  end if;

  insert into public.pastebox_upload_limits as limits (ip_hash, window_started_at, upload_count)
  values (p_ip_hash, now(), 1)
  on conflict (ip_hash) do update
  set window_started_at = case
        when limits.window_started_at <= now() - interval '1 hour' then now()
        else limits.window_started_at
      end,
      upload_count = case
        when limits.window_started_at <= now() - interval '1 hour' then 1
        else limits.upload_count + 1
      end
  returning upload_count into current_upload_count;

  return current_upload_count <= 10;
end;
$$;

revoke all on function public.consume_pastebox_upload_slot(text) from public, anon, authenticated;
grant execute on function public.consume_pastebox_upload_slot(text) to service_role;

-- Close the earlier direct-public metadata and Storage policies created during setup.
-- Existing rows and objects are preserved; only direct anonymous access is removed.
alter table if exists public.files enable row level security;
revoke all on table public.files from public, anon, authenticated;
drop policy if exists "Anyone can view unexpired file details" on public.files;
drop policy if exists "Anyone can download Pastebox files" on storage.objects;

comment on table public.pastebox_shares is
  'Private Pastebox metadata. Visitors must use the Edge Function and a share token.';
comment on column public.pastebox_shares.token_hash is
  'SHA-256 hash of a 256-bit random share token; plaintext token is never stored.';

