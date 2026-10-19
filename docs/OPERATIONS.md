# Operations and maintenance

## Expiry and cleanup

The Worker denies access at the six-hour expiry timestamp. The configured `*/15 * * * *` Cron Trigger attempts cleanup every 15 minutes, deleting expired R2 objects and then their D1 rows in batches of 100. If cleanup fails before deleting the D1 row, a later run can retry. Storage errors can delay physical removal; monitor Worker logs and Cloudflare D1/R2 usage for persistent errors.

The UI refreshes the public file list every minute while the View tab is open and updates countdown text every 30 seconds. A page left open may briefly display stale metadata; the backend still denies downloads after expiry.

## Incident response

- **A file should not be public:** this version has no public manual-delete operation. Use the Cloudflare dashboard or CLI as the resource owner to remove the R2 object and corresponding D1 row. Treat any downloaded copies as outside the service's control.
- **A credential is exposed:** revoke/rotate it at the provider first. Then remove it from the repository and review Git history, Actions logs, and local files. A Git commit deletion alone does not revoke it.
- **Abuse or unexpectedly high usage:** because uploads are open and there is no rate limiting, review Worker analytics, R2 storage/operations, and D1 activity. Temporarily disable the Worker or tighten routing at Cloudflare while investigating.
- **A backend deployment is broken:** the Pages interface may still load, but upload/list/download can fail. Check Worker logs, D1 migration status, binding names, `ALLOWED_ORIGIN`, and the Actions variable used for the frontend build.

## Data handling

- Active objects are private in R2 and are accessed through the Worker.
- The D1 table contains public metadata and an internal object key.
- Expired entries are blocked immediately and cleaned up on schedule.
- Downloaded copies and browser/device caches outside the `no-store` response behavior are not guaranteed to be erased by Pastebox.
- Cloudflare is a third-party processor for the Worker, database, and object storage. Review its current plan, retention, and service terms before using the app for anything sensitive.

## Current operational gaps

- No rate limiting, quotas, abuse reporting, monitoring alert, or admin console.
- No scanner, moderation queue, user authentication, or manual-delete UI.
- No automated backend integration test or recovery/backup policy is included.
- Public sharing is suitable only for files the group is comfortable making downloadable to anyone who can reach the site.

These are known first-version boundaries, not guarantees of protection.
