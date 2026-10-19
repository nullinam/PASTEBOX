-- Run only after creating the Vault secrets described in docs/DEPLOYMENT.md.
-- Vault secret names: pastebox_project_url and pastebox_cron_api_key.
-- The cron API key is a Supabase secret key and must never be committed here.

select cron.unschedule(jobid)
from cron.job
where jobname = 'pastebox-expiry-cleanup';

select cron.schedule(
  'pastebox-expiry-cleanup',
  '*/5 * * * *',
  $$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'pastebox_project_url')
        || '/functions/v1/pastebox-cleanup',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'pastebox_cron_api_key')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 10000
    ) as request_id;
  $$
);

