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
| `name` | Text | Trimmed, 2–80 characters; blank, whitespace-only, common placeholders, repeated Xs, and all-numeric labels are rejected |
| `purpose` | Text | Trimmed, 10–240 characters |

The server enforces the size, field rules, storage bucket limit, and ten-attempts-per-forwarded-IP-per-hour rate limit. A failed request does not return a usable share token.

Successful response (`201`):

```json
{
  "token": "URL-safe 256-bit random bearer token",
  "file": {
    "originalName": "notes.pdf",
    "size": 12400,
    "uploaderName": "Sam",
    "purpose": "Sharing the notes from our study session.",
    "uploadedAt": "2026-10-20T10:00:00.000Z",
    "expiresAt": "2026-10-20T16:00:00.000Z"
  }
}
```

The raw token is returned once for constructing the share URL. Only its SHA-256 hash is written to the database. The API response is `no-store` and the frontend places the token after `#share=`.

## `POST` JSON — resolve a share link

```json
{ "action": "resolve", "token": "..." }
``

Successful response: `{ "file": { ...metadata shown above... } }`. The server hashes the token, finds an active row, and checks expiry. It returns `404` for invalid, unknown, or expired tokens to avoid revealing record state.

## `POST` JSON — download

```json
{ "action": "download", "token": "..." }
``

After the same hash and expiry checks, the function returns `{ "downloadUrl": "..." }`. The signed URL lasts no more than 60 seconds and no later than the share expiry. The object is served as an attachment with an octet-stream content type and no-store/no-sniff protections. The browser verifies that the URL host matches the configured Supabase project before navigating to it.

## Secret-only cleanup function

`POST /functions/v1/pastebox-cleanup` is not a public action. It accepts a Supabase secret key through the `apikey` header, enforced by `withSupabase({ auth: 'secret' })`. The five-minute Cron job is configured in `supabase/schedules/pastebox-cleanup.sql` and reads its key and project URL from Supabase Vault.

## CORS, limits, and errors

The public handler allows the deployed GitHub Pages origin and localhost development. It accepts only POST and OPTIONS. CORS does not prevent scripts or command-line clients from calling the public endpoint.

Errors are JSON with an `error` message. Expected statuses include 400 for invalid fields/token shape, 404 for unavailable/expired links, 413 for oversized uploads, 429 for rate limit, 503 for storage/configuration failures, and 405 for unsupported methods.

