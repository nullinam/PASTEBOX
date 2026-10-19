# Operations and maintenance

## Expiry and physical cleanup

The `public.files` table sets `expires_at` to six hours after row creation. The Edge Function and frontend should use that timestamp to hide expired files and deny downloads.

**No scheduled physical cleanup is currently configured or verified.** An expired item may therefore remain as a row in Postgres and an object in the private `pastebox-files` bucket after the app stops exposing it. This can continue to use Storage. Implement and test a scheduled purge that deletes expired objects and then their metadata rows before describing the six-hour lifecycle as automatic deletion.

The UI updates countdowns periodically and refreshes the list while the View tab is open. A stale list display does not make an expired download valid if server-side expiry checks are working.

## Incident response

- **A file should no longer be available:** until an app-level delete flow exists, the project owner can remove the object from Supabase Storage and its corresponding row from `public.files`. Verify both were removed. This does not erase copies recipients already downloaded.
- **A credential is exposed:** revoke or rotate it in Supabase first. Then review repository history, Actions logs, function settings, and local files. Deleting a GitHub file alone does not revoke a credential.
- **Abuse or unexpectedly high usage:** uploads and reads are public, with no rate limit or per-person quota. Review Supabase function logs and Storage/database usage; disable or restrict the public function while investigating if necessary.
- **Backend requests fail:** the Pages interface may still load while upload/list/download fail. Check whether the function URL is reachable, then inspect Edge Function logs, CORS, function invocation configuration, private bucket access, and table schema.
- **Managed network closes the connection:** if the request shows `ERR_CONNECTION_CLOSED` without an HTTP status, test from another network. If it works there, request outbound HTTPS access to the project host from the network administrator.

## Data handling

- File objects should remain in a private Supabase Storage bucket and be served through the Edge Function.
- The database stores public-facing metadata and an internal Storage path.
- Metadata is visible to anyone who can access the public app/API.
- Downloaded copies and files saved outside Pastebox are not controlled by Pastebox.
- Supabase is a third-party processor for the function, database, and object storage. Review applicable plan, retention, and service terms before uploading anything sensitive.

## Current operational gaps

- Scheduled physical deletion of expired records and objects is not configured/verified.
- No rate limiting, quotas, abuse reporting, monitoring alert, or admin console.
- No scanner, moderation queue, user authentication, or manual-delete UI.
- The deployed function source is not versioned in this repository.
- No automated backend integration test or recovery/backup policy is documented.

These are first-version limitations. Public sharing is suitable only for files the group is comfortable making downloadable to anyone who can reach the service.
