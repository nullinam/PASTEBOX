# Deployment guide

This guide deploys the frontend to GitHub Pages and the data API to Cloudflare Workers. The frontend can be public without secrets. Cloudflare resource configuration stays in an ignored local Wrangler file.

## Prerequisites

- A GitHub account with access to `nullinam/PASTEBOX`.
- A Cloudflare account with Workers, D1, and R2 access.
- Node.js 22 or newer and npm.
- Wrangler invoked through `npx`; authenticate locally using `npx wrangler login`.

Do not store an API token or password in the repository. Wrangler's browser login stores credentials in the local user environment, outside this project.

## 1. Create Cloudflare resources

From the repository root:

```sh
cd worker
npx wrangler login
npx wrangler d1 create pastebox
npx wrangler r2 bucket create pastebox-files
```

Cloudflare returns a D1 database ID. Copy the tracked template to a local-only file and configure it there:

```sh
cp wrangler.toml wrangler.local.toml
```

On PowerShell, use `Copy-Item wrangler.toml wrangler.local.toml` instead. Replace the placeholder `database_id` in `wrangler.local.toml` with the D1 ID. Set `ALLOWED_ORIGIN` to `https://nullinam.github.io`. The local file is ignored by Git. Keep the tracked `wrangler.toml` as a placeholder template.

The R2 bucket must remain private. Do not enable public bucket access or configure a public R2 domain.

## 2. Apply the database migration and deploy the Worker

Still from `worker/`:

```sh
npx wrangler d1 migrations apply pastebox --remote --config wrangler.local.toml
npx wrangler deploy --config wrangler.local.toml
```

Record the deployed Worker URL. Check it by requesting `<WORKER_URL>/api/health`; it should return `{ "ok": true }`. A successful health check alone does not confirm the D1 migration or R2 binding; use a controlled upload/list/download check after deploying the frontend.

The tracked template already declares the D1 binding, private R2 binding, file-size limit, allowed origin, and a 15-minute Cron Trigger. Cloudflare deploys the Worker and schedule from the local configuration.

## 3. Configure and publish GitHub Pages

The repository workflow is `.github/workflows/pages.yml` and builds `main` on each push.

1. In GitHub, open **Settings → Pages** and select **GitHub Actions** as the source if not already enabled.
2. Open **Settings → Secrets and variables → Actions → Variables**.
3. Add `VITE_API_URL` with the Worker base URL, e.g. `https://pastebox-api.<your-subdomain>.workers.dev`. This URL is public runtime configuration, not a secret.
4. In **Actions**, run **Build and deploy Pastebox** (or push a source change). The workflow builds with Vite and deploys the output to Pages.
5. Open <https://nullinam.github.io/PASTEBOX/>. The backend-not-connected message should no longer appear when `VITE_API_URL` was included in the build.

If the API endpoint changes, update the Actions variable and run the workflow again. A variable change does not rewrite an already-published static bundle.

## 4. Verify the live flow

Use a harmless test file, not sensitive content:

1. Upload a file smaller than 25 MiB with a non-placeholder name and a purpose of at least 10 characters.
2. Confirm it appears in View with the server upload time and six-hour countdown.
3. Download it and compare the downloaded file with the original.
4. Confirm that an expired record is absent from the public list and its download returns `404`.
5. Verify the R2 object and D1 row are removed after the next scheduled cleanup run.

Do not test by uploading a real malicious file. This product has no malware scanner.

## Local development

Run the frontend and Worker in separate terminals. From the repository root:

```sh
npm install
```

Create a local frontend `.env.local` (ignored by `.gitignore`) containing:

```text
VITE_API_URL=http://localhost:8787
```

Run `npm run dev` in the repository root. In a second terminal, from `worker/`, run:

```sh
npx wrangler dev --config wrangler.local.toml
```

For local D1/R2 emulation, use Wrangler's local resources. To test against remote Cloudflare resources, explicitly configure Wrangler remote bindings and be careful not to upload private test data. Localhost CORS is allowed by the Worker.

## Deployment troubleshooting

- **Page says service is disconnected:** confirm `VITE_API_URL` exists as a GitHub Actions variable and rerun the frontend workflow.
- **Browser CORS error:** set Worker `ALLOWED_ORIGIN` exactly to `https://nullinam.github.io`, redeploy Worker, and reload the site.
- **Worker returns database errors:** confirm the local Wrangler config points to the right D1 database and apply migrations remotely.
- **Uploads fail:** confirm the `FILES` R2 binding targets the private `pastebox-files` bucket and file size is under 25 MiB.
- **No cleanup:** confirm the deployed Worker's Cron Trigger is active. Expired files should already be blocked by API checks even while physical cleanup is pending.
