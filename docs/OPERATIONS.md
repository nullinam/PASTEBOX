# Operations and maintenance

## Expiration and cleanup

The public API checks expiry on each share resolution and download. When `expires_at` is reached, it rejects access immediately.

Supabase Cron runs `pastebox-cleanup` every five minutes. The secret-only function processes up to 100 expired shares and 100 abandoned pending uploads per run. For each record it removes the private Storage object first, then deletes metadata. A failed object removal leaves the row for retry. Cleanup also removes old HMAC rate-limit windows and upload reservations. Physical deletion may lag expiry by one schedule interval or longer if Supabase reports a Storage failure; expired links are rejected immediately regardless.

The six-hour lifetime begins after Storage confirms upload completion. Pending uploads are not shareable and are cleaned after the 30-minute pending window.

## Monitoring

- Check Supabase Edge Function invocation/runtime logs for `pastebox_upload_failure` and `pastebox_cleanup_failure` events. These structured events include only a stage and aggregate count; do not add request bodies, share tokens, file contents, filenames, storage paths, or raw IP addresses to logs.
- Confirm the `pastebox-expiry-cleanup` schedule is running in **Integrations → Cron**. A successful Cron run confirms the SQL job queued the HTTP request; inspect the `pg_net` response to confirm the Edge Function returned success.
- In SQL Editor, inspect the recent HTTP statuses without selecting request headers or response bodies:

  ```sql
  select id, status_code, error_msg, timed_out, created
  from net._http_response
  where created > now() - interval '6 hours'
  order by created desc
  limit 30;
  ```

  The cleanup response is normally HTTP 200. HTTP 503 means cleanup was incomplete and its JSON response contains only aggregate removed/failed counts. If other integrations also use `pg_net`, correlate the response time with the five-minute PasteBox schedule. `pg_net` response retention is time-limited, so check soon after a failure.
- Monitor Storage usage and project limits. Public uploads can increase resource use even with a per-IP rate limit.
- Check the private bucket and its 50 MiB object cap if users receive storage errors.
- For notifications beyond dashboard/runtime logs, configure Supabase log-based alerts or a private log drain if your plan supports them. The existing optional webhook only sends threshold alerts for storage and estimated egress; it does not send upload/cleanup failure notifications.

## Release smoke check

After deploying frontend and Edge Function changes, verify using a harmless, non-sensitive test file:

1. On device A, upload a small file and copy the generated share link.
2. On device B or a private browser session, open the link, confirm the filename/size/timestamps/countdown, then download it.
3. Compare the downloaded file with the original. PasteBox also checks SHA-256 in the browser after download.
4. Confirm **Edge Functions → pastebox-upload → Invocations** shows the resolve and download requests without errors.
5. Confirm the scheduled `pastebox-cleanup` invocation is returning 200 through `net._http_response`. Do not shorten a real share's lifetime to test expiry in production; use a separate test project for deletion checks.

If upload fails, selected files remain in the current page so the user can retry without browsing for them again. The browser cannot preserve a `File` selection after refreshing or closing the page; select it again in that case.

## Incident response

- **A share link leaks:** anyone with it can download before expiry. Use the separate private revoke key from the uploader screen to block future access. A previously issued signed download URL can remain valid for up to 60 seconds; cleanup removes the object on its next run.
- **A secret key leaks:** rotate it in Supabase immediately, update the Vault cron secret if that key was used there, then assess Git history, Actions logs, and local files. Deleting a file does not invalidate a key.
- **Unexpected upload activity:** review function invocation and Storage usage, consider tightening upload limits or disabling the public upload function while investigating.
- **Download or upload failures:** check the on-screen connection guidance, Edge Function logs, RLS/grants, bucket privacy/size limit, and GitHub Pages variables. A managed network may block `YOUR_PROJECT_REF.supabase.co`; test from a second network before changing application code.
- **Cleanup backlog:** inspect Cron history and function errors. Retry the job after correcting access; expired links remain denied while physical cleanup is pending.

## Data handling

- Postgres stores original filename, size, timestamps, token/revoke-token hashes, checksum, download count, deletion setting, and internal Storage path. Legacy uploader-name and purpose columns may contain values from uploads created before those fields were removed; new uploads omit them.
- The rate-limit table stores a keyed HMAC of client IP, not raw IP.
- File bytes are private until a validated share token produces a short-lived signed download URL.
- Share pages display the file name, type, size, upload time, exact expiry, and countdown. They do not collect or display uploader names or purposes.
- Supabase is a third-party data processor for API, database, and Storage operations. Review plan, region, retention, and terms before use.
- Pastebox cannot erase recipient downloads, screenshots, browser history, or copies outside its control.

## Known limitations

- No accounts, CAPTCHA, malware scanning, moderation, public listing, or recovery/backup workflow.
- Link holders can redistribute their share links.
- A per-IP limit can be shared by people behind the same NAT and can be bypassed by distributed clients.
- QR-code generation is not included yet. Do not use a third-party QR image service for share links because that would disclose the bearer token to that service.
- Resumable transfers are not included yet. The current API intentionally validates and stores a complete file on the trusted server path; see the deployment guide for a safe resumable design.
- Download checksum verification buffers the completed file in the browser; the product cap is 50 MiB. Keep the cap in place unless the client adopts an incremental hashing implementation.
- Owner egress figures are estimates based on file size and download count, not exact provider billing usage.
- Cron storage/provider errors can delay physical deletion; expiry checks continue to deny app access.

