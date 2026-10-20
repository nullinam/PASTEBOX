# Pastebox

Pastebox lets someone upload a file and share it with a short-lived link. A recipient can open the link from another device and download the file. There is no public file listing or account system.

**Live site:** <https://nullinam.github.io/PASTEBOX/>  
**Repository:** <https://github.com/nullinam/PASTEBOX>

## How it works

1. The uploader selects one or more files, up to 50 MB each. Pastebox does not collect uploader names or sharing purposes.
2. The browser sends each file in its own request with a SHA-256 checksum. The function verifies the bytes, applies per-IP/hourly and total-storage quotas, and stores file bytes in a private Supabase Storage bucket.
3. After storage succeeds, the function creates a 256-bit random share token using the Web Crypto API. The database stores only its SHA-256 hash.
4. Pastebox returns a share URL containing the bearer token in the URL fragment and a separate one-time revoke key. Keep the revoke key private; anyone with it can revoke the file. URL fragments are not sent in the initial page request or HTTP Referer header.
5. A share page sends the token to the backend for resolution. The backend checks the hash and expiry. No public listing or direct database access is available.
6. On download, the backend rechecks the token and expiry, increments a private download count, then creates a short-lived signed Storage URL with attachment disposition. The browser verifies the downloaded file checksum before saving it.
7. Six hours after upload, link resolution and download are denied immediately. A Supabase Cron job invokes a secret-only cleanup function every five minutes to remove expired Storage objects and metadata. Physical deletion can therefore occur up to about five minutes after access expires.

Pastebox does not scan, preview, execute, or render uploaded files. Recipients download opaque data as an attachment. Anyone who has a share link can download that file before expiry, so share links should be treated like passwords. Pastebox cannot remove copies already downloaded.

## Product limits

- Any file format, up to 50 MB per file; empty and oversized files are rejected. Multi-file selections upload sequentially.
- No uploader name or purpose is collected or displayed.
- No file listing, accounts, access codes, or permanent links. Each uploader receives a separate revoke key that acts as a private delete capability.
- Default upload limits are 10 attempts and 200 MiB per client IP per hour, with a 1 GiB global storage cap. The owner can adjust them in Edge Function secrets. IPs are HMAC-hashed server-side; raw IP addresses are not stored.
- Access is intentionally link-based, not restricted to a friend group. Anyone with the link can access the file for its active period.
- Optional first-download deletion, private owner usage view, file checksum verification, clipboard paste, PWA installation, and Web Share Target receiving are supported.
- Resumable uploads and QR-code generation are not included in this release. See [known limitations](docs/OPERATIONS.md#known-limitations).

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
