# Security and privacy

## Link access model

Pastebox has no accounts, public listing, password, or membership enforcement. Anyone with a share link can view its metadata and download its file until the six-hour expiry. Treat a share link like a password. Do not upload confidential, personal, medical, financial, or work-sensitive data.

The share token is generated from 32 bytes supplied by the Web Crypto secure random generator. It is independent of the filename and database ID. Only the token's SHA-256 hash is stored. The raw token is returned once to the uploader and kept in the share URL fragment. URL fragments are not sent in the initial HTTP request or Referer header. The app sets no-referrer/no-store protections and loads no third-party analytics or font assets.

Anyone who can use developer tools or copy the share URL can share the capability. A 256-bit token makes guessing impractical but does not protect a leaked link.

## Data and storage protections

- The `pastebox-files` bucket is private with a 50 MiB object limit.
- Metadata and rate-limit tables have RLS enabled, no visitor policies, and no privileges for `anon`, `authenticated`, or `PUBLIC`.
- The browser calls Edge Functions only. It never queries tables or Storage directly.
- The public API uses a browser-safe publishable key. This does not grant table or bucket access.
- Upload, token lookup, expiry checks, signed-download creation, and deletion run in trusted Edge Functions using `ctx.supabaseAdmin`.
- The download URL is created only after token and expiry validation, forces an attachment, and has a maximum 60-second lifetime bounded by remaining share time.
- The cleanup function accepts only a Supabase secret key through `@supabase/server` auth mode `secret`; the scheduler obtains that key from Supabase Vault.
- Uploads are limited to ten attempts per forwarded client IP per hour. The stored rate-limit identifier is HMAC-SHA-256 with a server-only pepper; raw IP values are not stored.

## Opaque files, no scanning

Pastebox accepts arbitrary formats but does not inspect or scan their content. Files are saved and returned as `application/octet-stream` attachments. Download only from people you trust and use endpoint protection before opening a file. These controls do not make malware-free guarantees.

## Expiry and deletion

The backend denies share resolution and download once `expires_at` is reached. A scheduled job runs every five minutes and removes expired Storage objects and rows; physical removal can lag expiry by up to one schedule interval or provider delay. Pastebox cannot erase downloaded copies or copies saved elsewhere.

## Secrets in a public repository

- Never commit service-role/secret API keys, database passwords, Vault values, personal access tokens, real `.env` files, share tokens, or user uploads.
- `VITE_API_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` are public build-time values. Only the publishable key belongs in frontend configuration.
- `PASTEBOX_RATE_LIMIT_SECRET` is an Edge Function secret. It must never use a `VITE_` prefix or be set as a GitHub Actions variable.
- Supabase automatically supplies secret keys to trusted Edge Functions. Do not copy them into source code.
- The cleanup schedule uses Vault secrets. Do not put actual values in the tracked schedule SQL or paste them into a committed file.
- Git ignore rules exclude real `.env` files and local Supabase runtime state. `.env.example` contains placeholders only.

## Abuse limitations

The upload and share API is intentionally public and can be called outside a browser. The per-IP limit is an abuse control, not a complete defense against distributed abuse. There is no CAPTCHA, account identity, malware scanning, moderation queue, or admin UI. Supabase billing/quota settings should be monitored.

## Incident response

If a secret key is exposed, revoke/rotate it in Supabase immediately, then review Git history, GitHub Actions, local copies, and logs. Removing the visible text does not invalidate a key. If a share link is exposed, its holder can access the file until expiry; remove the corresponding file/row from Supabase through an authorized owner workflow if immediate revocation is required.

