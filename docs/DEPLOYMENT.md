# Supabase setup and deployment

This guide describes how the project owner can configure the service. The implementation work does not connect to or modify the live Supabase project, deploy Edge Functions, or publish GitHub Pages. Review the SQL and function code before applying it.

## Prerequisites

- GitHub access to `nullinam/PASTEBOX`.
- A Supabase project and permission to manage its database, Storage, Edge Functions, API keys, and Vault.
- Node.js 22+ for the frontend build.
- Supabase CLI and Docker for local Edge Function development.

## 1. Prepare the Supabase project

From a local checkout, link the project and apply the reviewed migration:

```sh
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

The migrations create the private 50 MiB `pastebox-files` bucket, share metadata, private rate-limit and reservation tables, RLS/revokes, quota and download RPCs, and owner-only usage functions. They also remove the exact legacy public policies created for Pastebox and revoke direct access to the previous `public.files` table, preserving existing rows and Storage objects. They enable `pg_cron` and `pg_net`. Review SQL against the live project before running `db push`.

The migration is a file only until you run it; no SQL was executed during implementation.

## 2. Set Edge Function secrets

In Supabase **Project Settings → Edge Functions → Secrets**, create:

| Name | Value |
|---|---|
| `PASTEBOX_RATE_LIMIT_SECRET` | A newly generated random value with at least 32 bytes of entropy |
| `PASTEBOX_OWNER_ACCESS_KEY` | A different random owner-only access key (at least 32 bytes); enter it only in the Owner panel when needed |
| `PASTEBOX_MAX_UPLOADS_PER_HOUR` | Optional integer; default `10` per IP hash |
| `PASTEBOX_MAX_BYTES_PER_HOUR` | Optional integer byte count; default `209715200` (200 MiB) per IP hash |
| `PASTEBOX_MAX_STORAGE_BYTES` | Optional integer byte count; default `1073741824` (1 GiB) total stored/reserved volume |
| `PASTEBOX_MAINTENANCE_MODE` | Optional `true` to pause new uploads while share resolution/downloads continue |
| `PASTEBOX_ALERT_WEBHOOK_URL` | Optional HTTPS webhook for aggregate storage/egress threshold alerts; receives counts only |
| `PASTEBOX_STORAGE_ALERT_BYTES` | Optional active/stored volume threshold in bytes for alerting |
| `PASTEBOX_EGRESS_ALERT_BYTES` | Optional estimated egress threshold in bytes (sum of file size × download count) |

Do not prefix it with `SUPABASE_` and do not use a `VITE_` name. It HMAC-hashes a gateway-provided client IP header before the rate-limit hash is stored; it does not trust caller-provided `X-Forwarded-For`. Supabase automatically provides the API secret keys to the server runtime; do not copy a service-role/secret key into source code or frontend configuration.

The `pastebox-cleanup` function uses `@supabase/server` with `auth: 'secret'`. The deployment config disables the platform's legacy JWT-only check so the function SDK can validate the secret API key itself. Keep cleanup on the secret auth mode; never change it to `none` or `publishable`. Do not place owner or webhook values in GitHub Pages variables or any `VITE_` variable.

## 3. Deploy the two Edge Functions

The function source is now versioned in this repository:

```sh
supabase functions deploy pastebox-upload
supabase functions deploy pastebox-cleanup
```

`supabase/config.toml` sets `verify_jwt = false` for both functions because `@supabase/server` enforces their respective key modes: public publishable key for the share API, secret key for cleanup. Check Supabase logs after deployment. Do not test with real private files.

## 4. Configure Vault and scheduled cleanup

In Supabase **Database → Vault**, create these secrets:

| Vault name | Value |
|---|---|
| `pastebox_project_url` | `https://YOUR_PROJECT_REF.supabase.co` |
| `pastebox_cron_api_key` | A Supabase secret API key from the project API Keys page; never use the publishable key here |

Vault keeps the cron credential server-side. Do not put either value in the repository, a GitHub variable, frontend environment, or tracked SQL file.

After confirming both Vault values, run `supabase/schedules/pastebox-cleanup.sql` once in the Supabase SQL Editor. It schedules cleanup every five minutes. Check Supabase **Integrations → Cron** or `cron.job_run_details` to confirm successful invocations and monitor failures. If this job cannot authenticate, verify the Vault secret name/value and that `pastebox-cleanup` remains in secret auth mode.

## 5. Configure GitHub Pages build variables

The Pages workflow only builds on `main` pushes or manual runs. Do not merge or manually run it until you are ready to publish.

In GitHub **Settings → Secrets and variables → Actions → Variables**, set:

| Variable | Value |
|---|---|
| `VITE_API_URL` | `https://YOUR_PROJECT_REF.supabase.co/functions/v1/pastebox-upload` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | The project's publishable key (`sb_publishable_…`) |

These are public values: Vite embeds them in the site. Never put a secret/service-role key in an Actions variable. The publishable key does not grant database or Storage access because RLS, grants, and bucket policies deny visitor access.

To build locally, copy `.env.example` to `.env.local`, fill the same two public values, then run:

```sh
npm install
npm run build
```

The real `.env.local` is ignored by Git. Do not commit it.

## 6. Verify before publishing

Use harmless test files on a non-production project first:

1. Check the bucket is private and capped at 50 MiB.
2. Confirm the table has RLS enabled and no public policies or grants. Try direct table and Storage access with a publishable key and confirm it is denied.
3. Upload a small harmless file; verify the resulting row contains a token hash but not the share token, and that no list endpoint exposes it.
4. Open the returned link in a private browser window, verify metadata and download, then test a malformed token.
5. Test 50 MiB acceptance and rejection just above the limit, confirm the upload request contains only the file field, and repeat uploads until a 429 appears.
6. Set a test row's expiry to the past in a non-production project and confirm resolve/download immediately fail.
7. Invoke cleanup through the scheduled job and confirm both the Storage object and database row are removed. Check retry behavior after a failed deletion.
8. Only then publish the frontend when ready.

## Optional domain and alerts

- For a custom domain, configure it under GitHub **Settings → Pages → Custom domain**, add the DNS records GitHub specifies (A/AAAA for an apex or CNAME for a subdomain), wait for DNS checks, then enable HTTPS. For a domain serving this project at `/`, change Vite's `base` in `vite.config.ts` from `/PASTEBOX/` to `/`. Update the service's exact allowed origin in `SHARE_SITE_ORIGINS` and redeploy the Edge Function after a domain change.
- For usage alerts, configure a private HTTPS webhook in `PASTEBOX_ALERT_WEBHOOK_URL` and set thresholds in bytes. Alerts are cooldown-limited to one per category per six hours and contain aggregate counts only. Estimated egress is a file-size × download-count estimate, not a billing-provider meter.
- Owner usage is gated by `PASTEBOX_OWNER_ACCESS_KEY` at the Edge Function. Enter it in the UI only when checking usage; it is held in memory and sent over HTTPS in a request header. Never use a Supabase service key for this value.
- Maintenance mode is a server-side Edge Function secret. Set it to `true` to pause uploads and remove it or set it to `false` to resume them. Existing link resolution and downloads remain enabled.

## PWA, encryption, and resumable transfers

- The PWA caches only the static app shell and built JS/CSS assets. It never caches API responses, share data, signed URLs, or file downloads. The Web Share Target queues files in local IndexedDB and hands them to the normal upload UI; it does not upload until the user confirms.
- End-to-end encryption is intentionally deferred. A future design should encrypt file bytes in the browser with AES-256-GCM and a fresh random key, put the key only in a URL fragment alongside the random share token, and send only ciphertext to Supabase. The backend would validate the share token without ever receiving the key; no analytics or third-party scripts may run on those pages. Losing the fragment key means the file cannot be recovered. Metadata and traffic sizes would still be visible to the service.
- Resumable upload is deferred because the current trusted Edge Function receives and validates a complete multipart file. A future implementation should issue a short-lived, object-scoped resumable upload capability server-side, enforce quota and expiry before issuance, finalize only after the backend verifies the uploaded object's size and checksum, and clean abandoned sessions. Do not allow browsers to upload directly using the service-role key.

## Troubleshooting

- **401/403 from public API:** check that the frontend sends the publishable key in `apikey`, `auth: 'publishable'` is set, and `verify_jwt = false` is deployed.
- **Origin/CORS errors:** verify the exact origin `https://nullinam.github.io` and the function preflight response.
- **503 upload protection not configured:** set `PASTEBOX_RATE_LIMIT_SECRET` in Edge Function secrets and redeploy or wait for secret propagation.
- **429 upload:** the current limit is ten attempts per forwarded client IP per one-hour window. A shared NAT can share this limit.
- **Expired file remains after expiry:** access should be denied immediately. Physical removal waits for the next five-minute Cron run and may retry after a Storage error.
- **Cleanup is unauthorized:** ensure Vault's `pastebox_cron_api_key` is a Supabase secret key (not publishable) and the function remains secret-only.
- **Large upload reliability:** the implementation uses the function API and standard Storage upload. Supabase recommends resumable transfers for files above 6 MiB; test at the intended network speeds and plan tier before treating 50 MiB uploads as production-ready.
