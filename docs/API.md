# API reference

The API base URL is the Cloudflare Worker URL, for example `https://pastebox-api.<account-subdomain>.workers.dev`. The URL is public configuration. All endpoints return JSON errors in the form `{ "error": "..." }`, except successful downloads.

## `GET /api/health`

Returns a minimal health response when the Worker is reachable.

```json
{ "ok": true }
```

This checks Worker reachability only. It does not prove that D1 and R2 are provisioned correctly.

## `GET /api/files`

Returns up to 200 active files, newest first. Expired records are excluded by the database query.

```json
{
  "files": [
    {
      "id": "uuid",
      "originalName": "weekend-plans.pdf",
      "name": "Alex",
      "purpose": "Sharing the itinerary for our trip this weekend.",
      "size": 860160,
      "uploadedAt": "2026-10-20T10:00:00.000Z",
      "expiresAt": "2026-10-20T16:00:00.000Z"
    }
  ]
}
```

The list is public. It contains uploader-entered metadata and is not paginated in this version. A background cleanup is requested while listing.

## `POST /api/files`

Creates a file record. Send `multipart/form-data` fields:

| Field | Type | Requirements |
|---|---|---|
| `file` | File | Required, non-empty, at most 25 MiB; any extension/content type accepted |
| `name` | Text | Required, trimmed, 2–60 characters; common placeholder values are rejected |
| `purpose` | Text | Required, trimmed, 10–240 characters |

On success, returns HTTP `201`:

```json
{
  "id": "uuid",
  "uploadedAt": "2026-10-20T10:00:00.000Z",
  "expiresAt": "2026-10-20T16:00:00.000Z"
}
```

The Worker first writes bytes to R2, then inserts the D1 row. If the insert fails, it attempts to remove the R2 object. Names remain unverified, and the purpose check only enforces length.

Possible errors include `400` for missing/invalid fields, `413` for oversized uploads, and `503` when storage cannot save the upload.

## `GET /api/files/{id}/download`

Streams the file as an attachment only if its D1 record exists and `expires_at` is later than the current server time. It returns `404` for an expired/missing file. Response headers include `Content-Disposition: attachment`, `Content-Type: application/octet-stream`, `X-Content-Type-Options: nosniff`, and `Cache-Control: private, no-store`.

There is no public R2 object URL, no file preview endpoint, and no manual delete endpoint.

## CORS

The Worker allows the `ALLOWED_ORIGIN` configured in Wrangler and permits `http://localhost:<port>` for development. CORS is a browser policy, not authorization: scripts and command-line clients can call the API directly.
