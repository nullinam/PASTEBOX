# Deployment guide

Pastebox has a static React frontend on GitHub Pages and a Supabase Edge Function backed by Postgres and private Storage. The frontend contains only the public function URL. Never place a privileged Supabase key in this public repository or frontend.

## Prerequisites

- Access to the GitHub repository `nullinam/PASTEBOX`.
- A Supabase project with the `public.files` table, private `pastebox-files` bucket, and deployed `pastebox-upload` Edge Function.
- Node.js 22 or newer for local frontend development.

## 1. Configure Supabase

In the Supabase project:

1. Create the `pastebox-files` Storage bucket and keep it private. Set its upload limit to 25 MiB.
2. Create the `public.files` table with the fields documented in [architecture](ARCHITECTURE.md), including a unique Storage path and `expires_at` defaulting to six hours after creation.
3. Enable Row Level Security on the table. Do not grant direct anonymous access to the table or Storage objects; the deployed function performs data operations server-side.
4. Deploy the `pastebox-upload` Edge Function with list, multipart upload, expiry-checked download, CORS, and server-side privileged access.
5. The function must be callable by the public app without exposing a service-role key. Keep privileged values in Supabase's server-side function environment only.
6. Configure CORS to permit `https://nullinam.github.io`. Include local development origins only if needed.

The deployed function source is currently dashboard-managed and is not tracked in this repository. Save a reviewed source copy in version control before changing or redeploying it, and ensure that copy contains no secret values.

## 2. Configure GitHub Pages

1. In GitHub, open **Settings → Pages** and select **GitHub Actions** as the source if it is not already enabled.
2. Open **Settings → Secrets and variables → Actions → Variables**.
3. Add or update repository variable `VITE_API_URL` with the function endpoint:
   `https://YOUR_PROJECT_REF.supabase.co/functions/v1/pastebox-upload`
4. Do not put a service-role key or any secret in this variable. It should contain only the public URL.
5. In **Actions**, run **Build and deploy Pastebox**, or push a source change to `main`. A variable update does not change an already-built site; the workflow must run again.
6. Open <https://nullinam.github.io/PASTEBOX/>.

The GitHub Actions workflow injects `VITE_API_URL` while building the public JavaScript bundle.

## 3. Verify the live flow

Use harmless test content only:

1. Open the function URL in a browser. A successful GET should return JSON for active files (possibly an empty list).
2. Visit the Pages site and confirm the storage-not-connected message is absent.
3. Upload a non-sensitive file below 25 MiB with a name and a purpose of at least 10 characters.
4. Confirm the file appears in View with uploader, purpose, timestamp, and countdown.
5. Download it and compare it with the original.
6. Verify that an expired item is omitted and its download is denied.
7. **Physical deletion is not yet automated.** Do not consider the retention lifecycle complete until a scheduled cleanup removes both the Storage object and its metadata row and this removal is verified.

Do not upload confidential or malicious test files. Pastebox does not scan uploads.

## Local frontend development

From the repository root:

```sh
npm install
```

Create an ignored local `.env.local` containing the public function URL:

```text
VITE_API_URL=https://YOUR_PROJECT_REF.supabase.co/functions/v1/pastebox-upload
```

Then run:

```sh
npm run dev
```

Local browser requests also need to be allowed by the function's CORS configuration. Do not put any privileged key in `.env.local` or expose it to Vite.

## Troubleshooting

- **Site says storage is disconnected:** check the GitHub Actions variable name/value and rerun the Pages workflow.
- **`ERR_CONNECTION_CLOSED` with no HTTP status:** the browser did not receive an HTTP response. Test the function URL on another network; a managed firewall/proxy may be closing HTTPS to `YOUR_PROJECT_REF.supabase.co`. Ask the network administrator to allow outbound HTTPS (port 443) to the project's Supabase host.
- **CORS error with an HTTP request visible:** confirm the exact Pages origin is allowed by the function and that OPTIONS preflight is handled.
- **HTTP 401/403:** review the Edge Function's public invocation/JWT configuration. Do not solve it by putting a service-role key in the browser.
- **HTTP 5xx or storage/database error:** inspect Supabase Edge Function logs, confirm required server-side secrets/bindings, table schema, RLS, and private bucket name.
- **Upload fails:** confirm file size is at most 25 MiB and the private bucket limit matches. Check Edge Function logs for the server response.
- **Expired files remain in Storage:** this is expected until a scheduled physical cleanup is implemented and verified.
