# API reference

The frontend API URL is the public Supabase Edge Function endpoint:

```text
https://YOUR_PROJECT_REF.supabase.co/functions/v1/pastebox-upload
```

Set it as the GitHub Actions repository variable `VITE_API_URL`. It is a public URL, not a secret. Never put a service-role key in the frontend. The function is publicly callable and must validate every request server-side.

The endpoint contract below reflects the current frontend integration and deployed setup.

## `GET /` — list active files

Returns active file metadata newest first:

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

The list is public. It must not return the private Storage path, privileged credentials, or expired records.

## `POST /` — upload

Send `multipart/form-data` with:

| Field | Type | Requirements |
|---|---|---|
| `file` | File | Required, non-empty, at most 25 MiB; any format accepted |
| `name` | Text | Required, trimmed, 2–80 characters in the database; common placeholders are rejected by the current UI |
| `purpose` | Text | Required, trimmed, 10–240 characters |

The server records the upload time and expiry. A successful response should provide the created file ID and upload/expiry timestamps. The function should store the bytes in the private `pastebox-files` bucket and then store metadata in `public.files`; if metadata creation fails, it should attempt to remove the uploaded object.

The exact success and error response shape should be kept in sync with `src/App.tsx` and the deployed function source.

## `GET /?download=<id>` — download

The function looks up the file by ID, checks that `expires_at` is later than the server's current time, retrieves the object from private Storage, and returns it as an attachment. It should return a not-found response for expired or missing records. Do not expose permanent public object URLs.

## Expiry

The database default sets expiry to six hours after row creation. Listing and download behavior must enforce this deadline. Physical deletion is not yet configured; expired rows/objects can remain stored after access is blocked. See [operations](OPERATIONS.md).

## CORS and errors

The Edge Function must handle browser preflight requests and allow the deployed site origin `https://nullinam.github.io`; add local development origins only when needed. CORS is not authorization. Requests from scripts and command-line clients can still reach a public endpoint.

The frontend displays a connection error if the function cannot be reached. A network-level error such as `ERR_CONNECTION_CLOSED` with no HTTP status usually means the request did not reach the function; inspect the network/proxy, then check Edge Function logs for requests that do arrive.
