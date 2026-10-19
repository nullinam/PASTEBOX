# Pastebox

Pastebox lets someone upload a file and share it with a short-lived link. A recipient can open the link from another device and download the file. There is no public file listing or account system.

**Live site:** <https://nullinam.github.io/PASTEBOX/>  
**Repository:** <https://github.com/nullinam/PASTEBOX>

## How it works

1. The uploader selects a file up to 50 MB and enters a name and a purpose.
2. The browser sends the file and metadata to the public Pastebox Edge Function. The function validates the actual received file size and text, rate-limits uploads, and stores file bytes in a private Supabase Storage bucket.
3. After storage succeeds, the function creates a 256-bit random share token using the Web Crypto API. The database stores only its SHA-256 hash.
4. Pastebox returns a share URL containing the bearer token in the URL fragment. URL fragments are not sent in the initial page request or HTTP Referer header.
5. A share page sends the token to the backend for resolution. The backend checks the hash and expiry. No public listing or direct database access is available.
6. On download, the backend rechecks the token and expiry, then creates a short-lived signed Storage URL with attachment disposition.
7. Six hours after upload, link resolution and download are denied immediately. A Supabase Cron job invokes a secret-only cleanup function every five minutes to remove expired Storage objects and metadata. Physical deletion can therefore occur up to about five minutes after access expires.

Pastebox does not scan, preview, execute, or render uploaded files. Recipients download opaque data as an attachment. Anyone who has a share link can download that file before expiry, so share links should be treated like passwords. Pastebox cannot remove copies already downloaded.

## Product limits

- Any file format, up to 50 MB; empty and oversized files are rejected.
- Uploader name required, 2–80 characters, trimmed; common placeholders are rejected. Names are not identity-verified.
- Purpose required, 10–240 characters; its truth is not verified.
- No file listing, accounts, access codes, manual-delete UI, or permanent links.
- Upload rate limit: at most 10 attempts per client IP per one-hour window. The IP is HMAC-hashed server-side before storage; raw IP addresses are not stored in the rate-limit table.
- Access is intentionally link-based, not restricted to a friend group. Anyone with the link can access the file for its active period.

## Technology

| Layer | Technology | Responsibility |
|---|---|---|
| Frontend | React, TypeScript, Vite | Accessible upload form, progress, share page, countdown, copy and download actions |
| Static hosting | GitHub Pages and GitHub Actions | Build and publish the static frontend |
| Public API | Supabase Edge Function `pastebox-upload` | Validate and store uploads, resolve share tokens, authorize downloads |
| Cleanup API | Supabase Edge Function `pastebox-cleanup` | Privileged scheduled removal of expired objects and metadata |
| Metadata | Supabase Postgres | Private share records and HMAC-keyed upload-rate windows |
| File bytes | Private Supabase Storage bucket `pastebox-files` | Opaque file content, served only through validated share links |
| Schedule | Supabase `pg_cron` + `pg_net` + Vault | Invoke cleanup every five minutes using a server-only Supabase secret key |

## Local development

Install Node.js 22 or newer:


```sh
npm install
```

Copy `.env.example` to `.env.local` and set the public function endpoint and publishable key. These are public client configuration; the publishable key is safe only because RLS, table privileges, and bucket policies deny direct visitor access.

```sh
npm run dev
```

To run Edge Functions locally, install the Supabase CLI and Docker, then use the Supabase local development workflow. Put local Edge Function secrets in `supabase/functions/.env`; this file is ignored by Git. Never place service-role or secret keys in Vite variables.

## Supabase setup and deployment

Read [deployment](docs/DEPLOYMENT.md) before configuring the project. The migration and schedule files are source files only; this implementation does not connect to or modify the live Supabase project. You must review and apply the migration, add Edge Function secrets, deploy both functions, configure Vault and Cron, and set GitHub Actions variables before the new application works.

The GitHub Pages workflow publishes only pushes to `main` and manual runs. Work on a feature branch to avoid publishing while configuring this change.

## Security and privacy

Review [security](docs/SECURITY.md), [architecture](docs/ARCHITECTURE.md), [API](docs/API.md), and [operations](docs/OPERATIONS.md). Never commit real `.env` files, service-role/secret keys, database passwords, Vault values, share tokens, or uploaded files. The repository is public.

## Repository map

```text
src/                              React user interface
supabase/config.toml              Edge Function auth-mode settings
supabase/functions/               Public API and secret-only cleanup function source
supabase/migrations/              RLS, private bucket, share metadata, rate-limit schema
supabase/schedules/               Cron job SQL template; no secret values
.github/workflows/pages.yml       GitHub Pages workflow, main branch only
docs/                             Architecture, API, security, deployment, operations
.env.example                      Placeholder-only public frontend configuration
```

## License

No license is currently declared. Until one is added, do not assume this project is available for reuse or redistribution.

