# Pastebox

Pastebox is a small, shared file box for a friend group. People can upload a file with a name and purpose, then anyone visiting the site can view the active uploads and download them. Uploads are temporary: they become unavailable six hours after upload and are then removed from storage.

**Live website:** <https://nullinam.github.io/PASTEBOX/>  
**Repository:** <https://github.com/nullinam/PASTEBOX>

## Current status

- The React frontend is published with GitHub Pages.
- The Worker API, D1 schema, R2 binding, and scheduled cleanup code are in this repository.
- The Cloudflare resources have to be provisioned and the Worker deployed before upload and view can use persistent storage. Until `VITE_API_URL` is configured, the page reports that its file service is not connected.
- The first version has no malware scanner, no accounts, no admin, and no manual delete feature.

## How Pastebox works

1. The uploader selects one file, enters a display name, and explains the purpose.
2. The browser and Worker enforce a 25 MiB maximum. The Worker also validates the name and purpose.
3. The Worker writes the bytes to a private R2 bucket and the record to D1. Pastebox treats the file as opaque data; it does not scan or open it.
4. The View tab lists unexpired records with the filename, purpose, uploader, timestamp, size, and countdown.
5. A download request passes through the Worker. The Worker checks the expiry time and serves the file as a download.
6. At six hours after upload, the list omits the file and the download endpoint rejects it. A cleanup job runs every 15 minutes to remove the stored object and database row; cleanup can be delayed by a storage error, but the API already blocks expired files.

The service does not promise that recipients delete copies they downloaded. Expiry removes Pastebox's copy and prevents future downloads through the app.

## Product rules

- Any file extension and format is accepted, up to 25 MiB per file. Empty files are rejected.
- Files are downloads only. Pastebox does not preview, execute, convert, or scan them.
- Name is self-entered and unverified. It must be 2–60 characters and cannot be a small set of common placeholders.
- Purpose must be 10–240 characters. This is a length check, not proof that the description is truthful.
- Uploads appear immediately after the storage and database writes succeed.
- Expiry is calculated by the server as upload receipt time plus six hours.
- Anyone can list and download active files. Anyone can also upload; there is no membership check.
- There is no user-facing manual deletion, keep option, administrator role, or access code.

## Technology

| Layer | Technology | Responsibility |
|---|---|---|
| Frontend | React, TypeScript, Vite | Upload and View screens, validation hints, list, countdown, download controls |
| Static hosting | GitHub Pages and GitHub Actions | Build and publish the frontend |
| API | Cloudflare Workers | Validate requests, handle upload/list/download, enforce expiry |
| Metadata | Cloudflare D1 | Store filenames, uploader/purpose text, timestamps, sizes, and opaque R2 object keys |
| File bytes | Cloudflare R2 | Keep uploaded objects private and serve them only through the Worker |
| Cleanup | Workers Cron Trigger | Periodically remove expired R2 objects and D1 rows |

See [the architecture guide](docs/ARCHITECTURE.md), [API reference](docs/API.md), [security and privacy notes](docs/SECURITY.md), [deployment guide](docs/DEPLOYMENT.md), and [operations guide](docs/OPERATIONS.md).

## Quick start

Install Node.js 22 or newer. For local frontend work, run from the repository root:

```sh
npm install
npm run dev
```

The interface can be explored without a backend, but upload/list/download require the Cloudflare Worker. Follow [the deployment guide](docs/DEPLOYMENT.md) to create D1 and R2, prepare a local Wrangler configuration, deploy the Worker, configure `VITE_API_URL`, and connect GitHub Pages.

## Public repository and sensitive configuration

The repository is public. Do not commit API tokens, credentials, passwords, Cloudflare account secrets, private file contents, or real user uploads. The tracked `worker/wrangler.toml` contains only a placeholder database ID; create an ignored `worker/wrangler.local.toml` for account-specific configuration. `.gitignore` excludes that file and common environment files. `VITE_API_URL` is a public service URL, not a secret; store it as a GitHub Actions variable.

The D1 database and R2 bucket have no public credentials in the frontend. They are bound to the Worker server-side. CORS restricts browser origins, but CORS is not authentication: non-browser clients can call the public API too.

## Repository map

```text
src/                         React user interface
.github/workflows/pages.yml  GitHub Pages build/deploy workflow
worker/src/index.ts          Cloudflare Worker API and expiry enforcement
worker/migrations/           D1 database schema
worker/wrangler.toml         Tracked Worker configuration template
docs/                        Architecture, API, security, deployment, operations
```

## License

No license is currently declared. Until a license is added, do not assume this project is available for reuse or redistribution.
