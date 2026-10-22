# API reference

The public function URL is configured by `VITE_API_URL`:

```text
https://YOUR_PROJECT_REF.supabase.co/functions/v1/pastebox-upload
```

Browser requests include the public Supabase publishable key in the `apikey` header. This key is designed for browser use and is not a credential. The handler uses the server-side admin client only after validating each action. Direct database and Storage access are denied by RLS and privileges.

All public operations use `POST`. There is intentionally no list endpoint.

## `POST /functions/v1/pastebox-upload` — upload

Send `multipart/form-data` fields:

| Field | Type | Requirements |
|---|---|---|
| `file` | File | Exactly one, non-empty, maximum 52,428,800 bytes (50 MiB) |
| `checksum` | Text | Required lowercase SHA-256 hex digest of the selected file bytes |

The server accepts only these fields and enforces the size, checksum, private bucket limit, configured per-IP/hourly quotas, and total storage cap. Multi-file selections are sent as separate sequential requests. Failed requests do not return a usable share token.

Successful response (`201`):

```json
{
  "token": "URL-safe 256-bit random bearer token",
  "revokeToken": "separate URL-safe 256-bit private deletion capability",
  "file": {
    "originalName": "notes.pdf",
    "size": 12400,
    "uploadedAt": "2026-10-20T10:00:00.000Z",
    "expiresAt": "2026-10-20T16:00:00.000Z",
    "checksum": "lowercase SHA-256 hex digest",
  }
}
```

The raw token is returned once for constructing the share URL. Only its SHA-256 hash is written to the database. The API response is `no-store` and the frontend places the token after `#share=`. Shares remain downloadable by link holders until their six-hour expiry or manual revocation.

The revoke token is returned once and stored as a SHA-256 hash. It is a separate bearer capability and must not be shared with recipients. `POST` JSON `{ "action": "revoke", "revokeToken": "..." }` revokes the matching share; physical object removal is retried by cleanup. `POST` JSON `{ "action": "owner-stats", "revokeToken": "..." }` returns the uploader-only download count.

`POST` JSON `{ "action": "owner-usage" }` returns aggregate usage only when accompanied by `x-owner-key` matching the server-side `PASTEBOX_OWNER_ACCESS_KEY`. Never set that value in a `VITE_` variable or expose it in the page.

## `POST` JSON — resolve a share link

```json
{ "action": "resolve", "token": "..." }
``

Successful response: `{ "file": { ...metadata shown above... } }`. The server hashes the token, finds an active row, and checks expiry. It returns `404` for invalid, unknown, or expired tokens to avoid revealing record state.

## `POST` JSON — download

```json
{ "action": "download", "token": "..." }
``

After the same hash and expiry checks, the function atomically records a download and returns `{ "downloadUrl": "..." }`. The signed URL lasts no more than 60 seconds. Objects are served as attachments with an octet-stream content type. The browser checks the URL host and verifies the SHA-256 checksum before saving the downloaded bytes.

## Secret-only cleanup function

`POST /functions/v1/pastebox-cleanup` is not a public action. It accepts a Supabase secret key through the `apikey` header, enforced by `withSupabase({ auth: 'secret' })`. The five-minute Cron job is configured in `supabase/schedules/pastebox-cleanup.sql` and reads its key and project URL from Supabase Vault.

## CORS, limits, and errors

The public handler allows the deployed GitHub Pages origin and localhost development. It accepts only POST and OPTIONS. CORS does not prevent scripts or command-line clients from calling the public endpoint.

Errors are JSON with an `error` message. Expected statuses include 400 for invalid fields/token shape, 404 for unavailable/expired links, 413 for oversized uploads, 429 for rate limit, 503 for storage/configuration failures, and 405 for unsupported methods.

