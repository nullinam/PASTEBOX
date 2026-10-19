# Pastebox Worker

The Cloudflare Worker is Pastebox's API. It binds a private D1 database (`DB`) and private R2 bucket (`FILES`) and handles upload, public listing, download, expiry checks, and scheduled cleanup.

## Behavior

- `GET /api/health` checks Worker reachability.
- `GET /api/files` returns up to 200 unexpired records.
- `POST /api/files` accepts multipart `file`, `name`, and `purpose` fields; files must be non-empty and at most 25 MiB.
- `GET /api/files/{uuid}/download` serves an attachment only while unexpired.
- The Worker calculates expiry as server upload receipt time plus six hours.
- The Cron Trigger is scheduled every 15 minutes. It deletes expired R2 objects and corresponding D1 rows in batches. API expiry checks make files unavailable before physical cleanup runs.
- There is no scan, authentication, admin, manual delete endpoint, rate limiting, or abuse moderation.

## Setup

Follow the full [deployment guide](../docs/DEPLOYMENT.md). Important configuration rule: keep account-specific settings local in ignored `wrangler.local.toml`; do not replace the placeholder in tracked `wrangler.toml` with an account-specific value.

The D1 binding ID is not an authentication secret, but this project keeps even that account-specific identifier out of the public repo. Wrangler login credentials are stored outside the repository. The public frontend needs only the Worker URL in the GitHub Actions variable `VITE_API_URL`.

The D1 schema is in [`migrations/0001_create_files.sql`](migrations/0001_create_files.sql). The detailed endpoint definitions are in [the API reference](../docs/API.md), and security limitations are in [SECURITY.md](../docs/SECURITY.md).

## Resource bindings

| Binding | Resource | Purpose |
|---|---|---|
| `DB` | Cloudflare D1 | File metadata and expiry timestamps |
| `FILES` | Cloudflare R2 | Private file bytes |

Do not make the R2 bucket public. The application intentionally serves objects through a Worker route that checks expiry and sets download-safe response headers.

## Configuration template

`wrangler.toml` is tracked and contains only a placeholder D1 ID. Copy it to ignored `wrangler.local.toml` and use that local file with Wrangler's `--config` option for migrations and deployment. `.gitignore` excludes the local configuration. Do not commit it.
