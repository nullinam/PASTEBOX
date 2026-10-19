# Pastebox

Pastebox is a public shared file board for a friend group. Visitors can upload a file with a name and purpose, view active uploads, and download files from another device.

**Live website:** <https://nullinam.github.io/PASTEBOX/>  
**Repository:** <https://github.com/nullinam/PASTEBOX>

## Current status

- The React frontend is published with GitHub Pages.
- The frontend calls a Supabase Edge Function named `pastebox-upload` for upload, list, and download operations.
- Supabase Storage bucket `pastebox-files` is private; file operations are mediated by the Edge Function.
- The public Supabase endpoint is configured through the GitHub Actions variable `VITE_API_URL`.
- The app hides expired files and denies downloads after six hours.
- **Physical automatic deletion of expired Storage objects and metadata rows is not yet configured.** Expiry currently means inaccessible through the app; it does not yet guarantee the bytes and row are deleted at six hours.

## How Pastebox works

1. The uploader selects one file and enters a display name and purpose.
2. The frontend and Edge Function enforce a 25 MiB maximum; empty files are rejected.
3. The Edge Function validates the request, stores file bytes in the private bucket, and writes metadata to `public.files`.
4. The View tab requests active records and shows filename, purpose, uploader, timestamp, size, and remaining time.
5. Downloads go through the Edge Function, which checks expiry before returning the file as an attachment.
6. At six hours, the app should no longer list or serve the file. A scheduled purge still needs to be added and verified to physically remove both the Storage object and database row.

Pastebox cannot remove copies recipients downloaded to their own devices.

## Product rules

- Any file format is accepted up to 25 MiB. Empty files are rejected.
- Files are treated as opaque data: Pastebox does not preview, execute, convert, or scan them.
- Uploader names are self-entered and unverified. Basic checks reject short names and common placeholders.
- Purpose is self-entered and length-checked; Pastebox does not verify its truth.
- Anyone can upload, list, and download active files. There are no accounts, invite codes, admin role, manual delete control, or keep option.
- Uploaded metadata is visible to anyone who can reach the public site and API.
- No malware scanning or rate limiting is currently provided.

## Technology

| Layer | Technology | Responsibility |
|---|---|---|
| Frontend | React, TypeScript, Vite | Upload and View screens, validation, list, countdown, download controls |
| Static hosting | GitHub Pages and GitHub Actions | Build and publish the frontend |
| API | Supabase Edge Function (`pastebox-upload`) | Validate requests; upload, list, and download |
| Metadata | Supabase Postgres (`public.files`) | Store filename, uploader/purpose, timestamp, size, Storage path, and expiry |
| File bytes | Supabase Storage (`pastebox-files`, private) | Store uploaded file objects |
| Cleanup | Not configured yet | Expired files are blocked by expiry checks; physical purge remains outstanding |

See [architecture](docs/ARCHITECTURE.md), [API reference](docs/API.md), [security and privacy](docs/SECURITY.md), [deployment](docs/DEPLOYMENT.md), and [operations](docs/OPERATIONS.md).

## Quick start

Install Node.js 22 or newer, then from the repository root:

```sh
npm install
npm run dev
```

For frontend-only development, the app can run without the service but upload/list/download require the Supabase Edge Function. Set `VITE_API_URL` to the public function endpoint when building:

```text
VITE_API_URL=https://YOUR_PROJECT_REF.supabase.co/functions/v1/pastebox-upload
```

See [deployment](docs/DEPLOYMENT.md) for the Supabase and GitHub Pages setup.

## Public repository and sensitive configuration

This repository is public. Do not commit service-role keys, Supabase secrets, passwords, tokens, private uploads, or real user data. The function endpoint URL is public configuration, not a secret; it is embedded in the frontend bundle. GitHub Actions stores it as a repository variable named `VITE_API_URL`.

Any privileged Supabase key must remain in Supabase's server-side Edge Function environment and must never be placed in frontend code, GitHub Pages assets, repository variables, or committed files. The database and Storage bucket should remain protected by RLS and private-bucket settings; the public app accesses them through the function.

## Repository map

```text
src/                         React user interface
.github/workflows/pages.yml  GitHub Pages build/deploy workflow
docs/                        Architecture, API, security, deployment, operations
.env.example                 Public function endpoint template
```

The deployed Edge Function source is currently managed in the Supabase dashboard and is not versioned in this repository. Keep a reviewed source copy in the repository before making future function changes.

## License

No license is currently declared. Until a license is added, do not assume this project is available for reuse or redistribution.
