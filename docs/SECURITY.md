# Security and privacy

## Link access model

Pastebox has no accounts, public listing, password, or membership enforcement. Anyone with a share link can view its metadata and download its file until the six-hour expiry. Treat a share link like a password. Do not upload confidential, personal, medical, financial, or work-sensitive data.

The share token and separate revoke token are each generated from 32 bytes supplied by the Web Crypto secure random generator. They are independent of the filename and database ID. Only their SHA-256 hashes are stored. The raw share token is kept in the share URL fragment; the revoke token is shown once to the uploader and must be kept private. URL fragments are not sent in the initial HTTP request or Referer header. The app sets no-referrer/no-store protections and loads no third-party analytics or font assets.

Anyone who can use developer tools or copy the share URL can share the capability. A 256-bit token makes guessing impractical but does not protect a leaked link.

## Data and storage protections

- The `pastebox-files` bucket is private with a 50 MiB object limit.
- Metadata, rate-limit, upload-reservation, and alert-state tables have RLS enabled, no visitor policies, and no privileges for `anon`, `authenticated`, or `PUBLIC`.
- The browser calls Edge Functions only. It never queries tables or Storage directly.
- The public API uses a browser-safe publishable key. This does not grant table or bucket access.
- Upload, token lookup, expiry checks, signed-download creation, and deletion run in trusted Edge Functions using `ctx.supabaseAdmin`.
- The download URL is created only after token and expiry validation, forces an attachment, and has a maximum 60-second lifetime bounded by remaining share time.
- The cleanup function accepts only a Supabase secret key through `@supabase/server` auth mode `secret`; the scheduler obtains that key from Supabase Vault.
- Uploads default to at most ten attempts and 200 MiB per forwarded client IP per hour, and 1 GiB total reserved/stored volume. The owner can configure limits with Edge Function secrets. The stored rate-limit identifier is HMAC-SHA-256 with a server-only pepper; raw IP values are not stored.
- Upload bytes are SHA-256-checked before Storage writes and again after download in the browser. File downloads are buffered up to the enforced 50 MiB cap for Web Crypto verification.
- First-download deletion and revocation change status in trusted SQL/Edge Function code; they do not rely on client-only checks. A signed URL already created can remain active for at most 60 seconds.
- The owner usage view requires the separate `PASTEBOX_OWNER_ACCESS_KEY` server-side secret. It is sent in a request header only when the owner explicitly opens the view and is never embedded into the frontend build.

## Opaque files, no scanning

Pastebox accepts arbitrary formats but does not inspect or scan their content. Files are saved and returned as `application/octet-stream` attachments. Download only from people you trust and use endpoint protection before opening a file. These controls do not make malware-free guarantees.

## Expiry and deletion

The backend denies share resolution and download after expiry or revocation. A scheduled job runs every five minutes and removes expired, revoked, and first-download Storage objects and rows; failed Storage deletion leaves rows for retry. Physical removal can lag expiry by schedule/provider delay. Pastebox cannot erase downloaded copies or copies saved elsewhere.

## Secrets in a public repository

- Never commit service-role/secret API keys, database passwords, Vault values, personal access tokens, real `.env` files, share tokens, or user uploads.
- `VITE_API_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` are public build-time values. Only the publishable key belongs in frontend configuration.
- `PASTEBOX_RATE_LIMIT_SECRET` is an Edge Function secret. It must never use a `VITE_` prefix or be set as a GitHub Actions variable.
- Owner access and optional usage-alert webhook/threshold values are Edge Function secrets only. Never set them as frontend build variables.
- Supabase automatically supplies secret keys to trusted Edge Functions. Do not copy them into source code.
- The cleanup schedule uses Vault secrets. Do not put actual values in the tracked schedule SQL or paste them into a committed file.
- Git ignore rules exclude real `.env` files and local Supabase runtime state. `.env.example` contains placeholders only.

## Abuse limitations

The upload and share API is intentionally public and can be called outside a browser. The per-IP limit is an abuse control, not a complete defense against distributed abuse. There is no CAPTCHA, account identity, malware scanning, or moderation queue. The owner panel shows estimated usage and requires its server-side key; Supabase billing/quota settings should also be monitored.

## Incident response

If a secret key is exposed, revoke/rotate it in Supabase immediately, then review Git history, GitHub Actions, local copies, and logs. Removing the visible text does not invalidate a key. If a share link is exposed, use its separate revoke key to block future API access; signed download URLs already created may remain active for up to 60 seconds.
