-- Pastebox no longer asks for uploader names or sharing purposes.
-- Keep existing values in place for already-created shares, but allow new
-- uploads to omit these legacy metadata columns entirely.
alter table public.pastebox_shares
  alter column uploader_name drop not null,
  alter column purpose drop not null;

alter table public.pastebox_shares
  add column if not exists revoke_token_hash text unique,
  add column if not exists checksum_sha256 text,
  add column if not exists download_count bigint not null default 0,
  add column if not exists delete_after_first_download boolean not null default false;

alter table public.pastebox_shares
  add constraint pastebox_checksum_format_check
  check (checksum_sha256 is null or checksum_sha256 ~ '^[a-f0-9]{64}$');

create table if not exists public.pastebox_alert_state (
  alert_key text primary key,
  last_sent_at timestamptz not null
);
alter table public.pastebox_alert_state enable row level security;
revoke all on table public.pastebox_alert_state from public, anon, authenticated;
grant all on table public.pastebox_alert_state to service_role;

create or replace function public.claim_pastebox_alert(p_alert_key text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed text;
begin
  if p_alert_key not in ('storage', 'egress') then return false; end if;
  insert into public.pastebox_alert_state as alerts (alert_key, last_sent_at)
  values (p_alert_key, now())
  on conflict (alert_key) do update set last_sent_at = now()
    where alerts.last_sent_at <= now() - interval '6 hours'
  returning alert_key into claimed;
  return claimed is not null;
end;
$$;

revoke all on function public.claim_pastebox_alert(text) from public, anon, authenticated;
grant execute on function public.claim_pastebox_alert(text) to service_role;

alter table public.pastebox_shares
  drop constraint if exists pastebox_shares_status_check;
alter table public.pastebox_shares
  add constraint pastebox_shares_status_check
  check (status in ('pending', 'active', 'revoked', 'downloaded'));
alter table public.pastebox_shares
  drop constraint if exists pastebox_active_share_has_token;
alter table public.pastebox_shares
  add constraint pastebox_active_share_has_token check (
    (status = 'pending' and token_hash is null and uploaded_at is null and expires_at is null)
    or
    (status in ('active', 'revoked', 'downloaded') and token_hash ~ '^[a-f0-9]{64}$' and uploaded_at is not null and expires_at is not null)
  );

alter table public.pastebox_upload_limits
  add column if not exists bytes_count bigint not null default 0;
update public.pastebox_upload_limits
set window_started_at = now() - interval '1 hour';

create table if not exists public.pastebox_upload_reservations (
  id uuid primary key,
  ip_hash text not null check (ip_hash ~ '^[a-f0-9]{64}$'),
  file_size bigint not null check (file_size between 1 and 52428800),
  created_at timestamptz not null default now()
);
alter table public.pastebox_upload_reservations enable row level security;
revoke all on table public.pastebox_upload_reservations from public, anon, authenticated;
grant all on table public.pastebox_upload_reservations to service_role;

create or replace function public.consume_pastebox_upload_quota(
  p_ip_hash text,
  p_file_size bigint,
  p_max_uploads integer,
  p_max_bytes bigint
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_count integer;
  current_bytes bigint;
begin
  if p_ip_hash !~ '^[a-f0-9]{64}$' or p_file_size < 1
    or p_max_uploads < 1 or p_max_bytes < 1 then
    return false;
  end if;

  insert into public.pastebox_upload_limits as limits
    (ip_hash, window_started_at, upload_count, bytes_count)
  values (p_ip_hash, now(), 1, p_file_size)
  on conflict (ip_hash) do update
  set window_started_at = case
        when limits.window_started_at <= now() - interval '1 hour' then now()
        else limits.window_started_at
      end,
      upload_count = case
        when limits.window_started_at <= now() - interval '1 hour' then 1
        else limits.upload_count + 1
      end,
      bytes_count = case
        when limits.window_started_at <= now() - interval '1 hour' then excluded.bytes_count
        else limits.bytes_count + excluded.bytes_count
      end
  returning upload_count, bytes_count into current_count, current_bytes;

  return current_count <= p_max_uploads and current_bytes <= p_max_bytes;
end;
$$;

revoke all on function public.consume_pastebox_upload_quota(text, bigint, integer, bigint) from public, anon, authenticated;
grant execute on function public.consume_pastebox_upload_quota(text, bigint, integer, bigint) to service_role;

create or replace function public.reserve_pastebox_upload(
  p_ip_hash text,
  p_file_size bigint,
  p_max_uploads integer,
  p_max_bytes bigint,
  p_max_storage bigint,
  p_reservation_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_count integer;
  current_bytes bigint;
  current_storage bigint;
  retry_seconds integer;
begin
  if p_ip_hash !~ '^[a-f0-9]{64}$' or p_file_size < 1 or p_file_size > 52428800
    or p_max_uploads < 1 or p_max_bytes < 1 or p_max_storage < 1 then
    return 'invalid';
  end if;

  perform pg_advisory_xact_lock(hashtext('pastebox-global-storage-quota'));
  select coalesce(sum(file_size), 0) into current_storage
    from public.pastebox_shares
    where status in ('pending', 'active', 'revoked', 'downloaded');
  select current_storage + coalesce(sum(file_size), 0) into current_storage
    from public.pastebox_upload_reservations
    where created_at > now() - interval '30 minutes';
  if current_storage + p_file_size > p_max_storage then return 'storage'; end if;

  insert into public.pastebox_upload_limits as limits
    (ip_hash, window_started_at, upload_count, bytes_count)
  values (p_ip_hash, now(), 1, p_file_size)
  on conflict (ip_hash) do update
  set window_started_at = case when limits.window_started_at <= now() - interval '1 hour' then now() else limits.window_started_at end,
      upload_count = case when limits.window_started_at <= now() - interval '1 hour' then 1 else limits.upload_count + 1 end,
      bytes_count = case when limits.window_started_at <= now() - interval '1 hour' then excluded.bytes_count else limits.bytes_count + excluded.bytes_count end
  returning upload_count, bytes_count, greatest(0, 3600 - extract(epoch from (now() - window_started_at))::integer)
    into current_count, current_bytes, retry_seconds;

  if current_count > p_max_uploads then return 'rate:' || retry_seconds::text; end if;
  if current_bytes > p_max_bytes then return 'hourly-volume:' || retry_seconds::text; end if;
  insert into public.pastebox_upload_reservations (id, ip_hash, file_size) values (p_reservation_id, p_ip_hash, p_file_size);
  return 'ok';
end;
$$;

revoke all on function public.reserve_pastebox_upload(text, bigint, integer, bigint, bigint, uuid) from public, anon, authenticated;
grant execute on function public.reserve_pastebox_upload(text, bigint, integer, bigint, bigint, uuid) to service_role;

create or replace function public.record_pastebox_download(p_share_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed integer;
begin
  update public.pastebox_shares
  set download_count = download_count + 1,
      status = case when delete_after_first_download then 'downloaded' else status end,
      expires_at = case when delete_after_first_download then now() + interval '2 minutes' else expires_at end
  where id = p_share_id
    and status = 'active'
    and expires_at > now()
    and (not delete_after_first_download or download_count = 0);
  get diagnostics changed = row_count;
  return changed = 1;
end;
$$;

revoke all on function public.record_pastebox_download(uuid) from public, anon, authenticated;
grant execute on function public.record_pastebox_download(uuid) to service_role;

create or replace function public.get_pastebox_owner_usage()
returns table (active_files bigint, active_bytes bigint, total_downloads bigint, estimated_egress_bytes bigint, pending_cleanup bigint)
language sql
security definer
set search_path = ''
as $$
  select
    count(*) filter (where status = 'active' and expires_at > now()),
    coalesce(sum(file_size), 0) + coalesce((select sum(file_size) from public.pastebox_upload_reservations), 0),
    coalesce(sum(download_count), 0),
    coalesce(sum(file_size * download_count), 0),
    count(*) filter (where status = 'revoked' or (status in ('downloaded', 'active') and expires_at <= now()))
  from public.pastebox_shares;
$$;

revoke all on function public.get_pastebox_owner_usage() from public, anon, authenticated;
grant execute on function public.get_pastebox_owner_usage() to service_role;
