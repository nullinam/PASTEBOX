# Operations and maintenance

## Expiration and cleanup

The public API checks expiry on each share resolution and download. When `expires_at` is reached, it rejects access immediately.

Supabase Cron runs `pastebox-cleanup` every five minutes. The secret-only function processes up to 100 expired shares and 100 abandoned pending uploads per run. For each record it removes the private Storage object first, then deletes metadata. A failed object removal leaves the row for retry. Cleanup also removes old HMAC rate-limit windows. Physical deletion may lag expiry by one schedule interval or longer if Supabase reports a Storage failure; review Cron run results and function logs.

The six-hour lifetime begins after Storage confirms upload completion. Pending uploads are not shareable and are cleaned after the 30-minute pending window.

## Monitoring

- Check Supabase Edge Function invocation/runtime logs for status and error trends. Do not log request bodies, share tokens, file contents, or raw IP addresses.
- Review Supabase Cron job run details for cleanup failures and duration.
- Monitor Storage usage and project limits. Public uploads can increase resource use even with a per-IP rate limit.
- Check the private bucket and its 50 MiB object cap if users receive storage errors.

## Incident response

- **A share link leaks:** anyone with it can download before expiry. Use the separate private revoke key from the uploader screen to block future access. A previously issued signed download URL can remain valid for up to 60 seconds; cleanup removes the object on its next run.
- **A secret key leaks:** rotate it in Supabase immediately, update the Vault cron secret if that key was used there, then assess Git history, Actions logs, and local files. Deleting a file does not invalidate a key.
- **Unexpected upload activity:** review function invocation and Storage usage, consider tightening upload limits or disabling the public upload function while investigating.
- **Download or upload failures:** check Edge Function logs, RLS/grants, bucket privacy/size limit, and GitHub Pages variables. A managed network may block `YOUR_PROJECT_REF.supabase.co`; test from a second network before changing application code.
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
