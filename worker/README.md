# Pastebox API

The Worker keeps R2 private and is the only path to upload or download files. D1 contains metadata only. No credential is needed in the frontend or repository.

## Provision

1. Install Node.js 22 or newer and authenticate Wrangler with `npx wrangler login`.
2. Create the resources:

   ```sh
   npx wrangler d1 create pastebox
   npx wrangler r2 bucket create pastebox-files
   ```

3. Copy the returned D1 `database_id` into `database_id` in `wrangler.toml`. This ID is resource configuration, not a secret. Keep account API tokens out of this file.
4. Apply the schema and deploy:

   ```sh
   npx wrangler d1 migrations apply pastebox --remote
   npx wrangler deploy
   ```

5. Set `ALLOWED_ORIGIN` in `wrangler.toml` to the published Pages origin (normally `https://nullinam.github.io`).
6. In the GitHub repository settings, add the Actions **variable** `VITE_API_URL` with the Worker base URL, such as `https://pastebox-api.<your-subdomain>.workers.dev`.

The API URL is public configuration, not a key. D1 and R2 access is provided by Worker bindings. Never add Cloudflare API tokens, database passwords, or file data to the repository. For local development, use `npx wrangler dev` from this directory and set the frontend `.env.local` `VITE_API_URL` to `http://localhost:8787`.

## Behavior and limits

- `POST /api/files` accepts multipart fields `file`, `name`, and `purpose`.
- Files are limited to 25 MiB, stored as opaque bytes, and served only as downloads.
- Uploaders enter unverified names. Names must be 2–60 characters and cannot be common placeholder values. Purpose must be 10–240 characters.
- `GET /api/files` returns only unexpired metadata. `GET /api/files/:id/download` denies expired files even if scheduled cleanup has not run yet.
- A 15-minute Cron Trigger removes expired R2 objects and D1 rows. The API hides files at the exact expiry time; physical cleanup follows on the next scheduled run.
- This first version deliberately has no malware scanning, user accounts, admin, or manual delete feature. Anyone with access to the public site can download a file during its six-hour window.
- Configure `ALLOWED_ORIGIN` to the one Pages origin. Localhost origins are permitted for development only.
