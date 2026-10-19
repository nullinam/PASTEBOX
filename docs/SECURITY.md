# Security and privacy

## Public sharing is intentional

Pastebox is a public open-upload file board in this first version. Anyone who can reach the site and its Edge Function can attempt to:

- Read active filenames, uploader names, purposes, sizes, and timestamps.
- Download active files.
- Upload files using any self-entered name and purpose.

There is no sign-in, membership check, password, invite code, admin role, or user-facing manual removal control. The product is not restricted to the intended friend group. Public endpoint access and automated abuse are possible.

Do not upload confidential, personal, financial, medical, work-sensitive, or otherwise private files. A six-hour expiry cannot prevent recipients from keeping downloaded copies.

## No scanning or preview

Pastebox accepts arbitrary formats and treats the bytes as opaque data. It does not scan, preview, execute, or convert files. This does not make uploaded files safe. Download only files from people you trust and use appropriate endpoint protection before opening them.

Downloads should be served as attachments with an octet-stream content type, `nosniff`, and no-store caching. These headers reduce browser rendering risk but are not malware detection.

## Supabase access and credentials

- The Supabase Storage bucket `pastebox-files` must remain private.
- RLS is enabled on `public.files`; direct anonymous table grants and direct public Storage download policies were removed during setup.
- Public app operations go through the `pastebox-upload` Edge Function. Any privileged Supabase key is used only server-side by the function.
- Never put a service-role key, secret, password, access token, or private upload in GitHub source, the frontend bundle, GitHub Actions variables, or issue reports.
- `VITE_API_URL` is a public function URL, not a credential. It is compiled into the public site.
- The deployed Edge Function source is currently maintained in the Supabase dashboard and is not versioned in this repository. Keep a secure, reviewed source copy for reproducible maintenance, without secret values.

## Limits of current protections

- Uploader names are unverified; placeholder checks and purpose-length checks are input hygiene, not identity or content verification.
- There is no rate limit, CAPTCHA, abuse reporting, per-person quota, authentication, or moderation. Public upload can be abused and storage/operation costs can increase.
- CORS is a browser policy, not access control.
- No malware scanner or independent security audit is provided.
- Expired files are intended to become inaccessible after six hours, but scheduled physical deletion of Storage objects and rows is not configured yet. Do not treat expiry as verified deletion until a purge is implemented and tested.
- The app cannot delete copies downloaded by recipients.

## Reporting an issue

Do not publish credentials, private files, or sensitive personal data in a public GitHub issue. If a credential is exposed, revoke or rotate it at Supabase first, then assess Git history, logs, and local files. Deleting the visible file alone does not invalidate a leaked credential.
