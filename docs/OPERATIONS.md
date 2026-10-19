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

- **A share link leaks:** anyone with it can download before expiry. For immediate revocation, use an authorized owner process to remove the matching Storage object and metadata row. The current UI has no manual delete control.
- **A secret key leaks:** rotate it in Supabase immediately, update the Vault cron secret if that key was used there, then assess Git history, Actions logs, and local files. Deleting a file does not invalidate a key.
- **Unexpected upload activity:** review function invocation and Storage usage, consider tightening upload limits or disabling the public upload function while investigating.
- **Download or upload failures:** check Edge Function logs, RLS/grants, bucket privacy/size limit, and GitHub Pages variables. A managed network may block `YOUR_PROJECT_REF.supabase.co`; test from a second network before changing application code.
- **Cleanup backlog:** inspect Cron history and function errors. Retry the job after correcting access; expired links remain denied while physical cleanup is pending.

## Data handling

- Postgres stores uploader name, purpose, original filename, size, timestamps, token hash, and internal Storage path.
- The rate-limit table stores a keyed HMAC of client IP, not raw IP.
- File bytes are private until a validated share token produces a short-lived signed download URL.
- User-submitted metadata is visible to anyone with the corresponding share link. Do not place sensitive data in the name/purpose fields.
- Supabase is a third-party data processor for API, database, and Storage operations. Review plan, region, retention, and terms before use.
- Pastebox cannot erase recipient downloads, screenshots, browser history, or copies outside its control.

## Known limitations

- No accounts, CAPTCHA, malware scanning, moderation, public listing, manual delete UI, or recovery/backup workflow.
- Link holders can redistribute their share links.
- A per-IP limit can be shared by people behind the same NAT and can be bypassed by distributed clients.
- Edge Function standard uploads above 6 MiB should be load-tested; resumable upload would improve reliability if larger uploads fail on the target plan/network.
- Cron storage/provider errors can delay physical deletion; expiry checks continue to deny app access.

