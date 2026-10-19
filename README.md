# Pastebox

A small shared file box for a friend group. Upload a file, add your name and a short purpose, and let the group download it for six hours.

## First-version rules

- Any file format is accepted, up to **25 MB**. Pastebox treats each upload as opaque data and offers it as a download; it does not scan or preview files.
- Uploader name is self-entered and unverified. Placeholder names and blank values are rejected; purpose must explain the share in at least 10 characters.
- Files become visible immediately after upload and expire exactly six hours after upload.
- Expired files are hidden and downloads are denied immediately. A scheduled task removes the bytes and metadata within 15 minutes.
- There are no accounts, admin controls, or manual delete controls. Anyone who can access the public page can download currently available files.

## Technology

- React, TypeScript, and Vite frontend, published with GitHub Pages.
- Cloudflare Worker API, D1 metadata database, and private R2 object storage.
- A 15-minute Worker Cron Trigger handles expired-file cleanup.

## Publish the website

The `Build and deploy Pastebox` GitHub Actions workflow builds `main` and publishes it to Pages. In repository Settings → Pages, choose **GitHub Actions** as the build and deployment source. Add the Actions variable `VITE_API_URL` with the public Worker URL. It is a URL, not a secret. Details for creating the backend are in [`worker/README.md`](worker/README.md).

## Public repository and security

This repository contains application source only. User uploads go to private R2 storage, never Git. D1 and R2 are bound to the Worker server-side and have no public credentials. Do not commit `.env`, `.dev.vars`, API tokens, access keys, database passwords, or uploaded files. `.env.example` files contain placeholders only. The app serves every accepted file as `application/octet-stream` with `Content-Disposition: attachment` and `nosniff` so a browser will download it instead of rendering active content.

**Sharing is public:** do not upload private, confidential, or sensitive files. The uploader name is not verified. The six-hour window is a retention limit, not a guarantee that recipients cannot keep copies after downloading.
