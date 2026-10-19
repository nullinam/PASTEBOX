# Security and privacy

## Public sharing is intentional

Pastebox is a public, open-upload file board in this first version. Anyone who can visit the site can:

- Read the list of active filenames, uploader names, purposes, sizes, and timestamps.
- Download any active file.
- Upload additional files using any self-entered name and purpose.

There is no sign-in, membership check, password, invite code, admin role, or manual removal control. The current implementation does not restrict use to a particular friend group. Anyone with the public URL, and automated clients, can access the service.

Do not upload confidential, personal, financial, medical, work-sensitive, or otherwise private files. Do not rely on the six-hour retention period to prevent a recipient from keeping a downloaded copy.

## No scanner or file inspection

Pastebox deliberately does not scan or inspect uploaded bytes. It accepts arbitrary file formats and serves them as opaque attachments. This reduces file processing but does not make uploaded files safe. Download only from people you trust and use appropriate endpoint protection before opening a download.

The Worker forces downloads with an `application/octet-stream` content type, attachment disposition, `nosniff`, and no-store cache headers. This lowers the risk that the browser will render active content in the Pastebox origin; it is not malware detection and is not a guarantee that a downloaded file is harmless.

## Credentials and public repository

- Never commit Cloudflare API tokens, account secrets, passwords, access keys, `.env` files, `.dev.vars`, real uploads, or private data.
- `worker/wrangler.toml` is a template with a placeholder D1 ID. Put account-specific values in the ignored `worker/wrangler.local.toml` described in [deployment](DEPLOYMENT.md).
- Authenticate Wrangler through `npx wrangler login`; the interactive login is handled outside the repository. Do not paste a token into a source file or command committed to shell history.
- The GitHub Actions `VITE_API_URL` variable is a public URL compiled into the site. It is not a secret and must not contain credentials.
- D1 and R2 are bound only to the Worker. No database or storage key is shipped to the browser.
- A D1 database ID and R2 bucket name are identifiers, not authentication secrets, but keep account-specific configuration out of the public template as requested.

## Limits of current protections

- Name and purpose checks are input hygiene only; names are unverified and text is not moderated.
- The small placeholder denylist cannot reliably detect fake or offensive names.
- There is no rate limit, CAPTCHA, abuse reporting, quota per person, or upload moderation. The public endpoint may be abused and storage/operation costs may increase.
- CORS does not block direct API clients.
- There is no manual delete endpoint. Expired objects are removed by scheduled cleanup; an administrator can only manage resources using Cloudflare's own dashboard/CLI.
- No independent security audit has been performed.

## Reporting an issue

Do not publish credentials, private files, or sensitive personal data in a public GitHub issue. Rotate any credential that is accidentally exposed, remove it from active use, then assess Git history and logs separately; deleting the visible file alone does not revoke a leaked credential.
