# Vercel: verify Blob, env vars, and logs

Use this when uploads fail or you see `FUNCTION_INVOCATION_FAILED`.

## 1. Environment variable `BLOB_READ_WRITE_TOKEN`

1. Open [Vercel Dashboard](https://vercel.com/dashboard) → your **project** (the one connected to this repo).
2. **Settings** → **Environment Variables**.
3. Find **`BLOB_READ_WRITE_TOKEN`**.
   - It must exist for **Production** (and **Preview** if you test preview URLs).
   - The **value** is a secret token from Blob (you never paste it in the app code).
4. If you **just added** or **changed** it: **Deployments** → open the latest deployment → **⋯** → **Redeploy** (env vars apply on deploy).

## 2. Blob store linked to this project

1. In the same project, open **Storage** (or **Create** → **Blob** if none exists).
2. Confirm a **Blob** store exists and is **connected / linked** to **this** project (not only another project).
3. Creating the store usually creates `BLOB_READ_WRITE_TOKEN` automatically; if not, add it manually from the Blob store settings.

## 3. Public access (for viewing images in the browser)

For this POC, images are shown via a **public URL** from Blob. When creating the store, **Public** access (or equivalent) is appropriate for “last image” in an `<img>`. If the store is **Private**-only, viewing by URL may fail until you adjust access or serve images through a token-backed route.

## 4. Runtime checks (no dashboard)

After deploy, open in the browser (replace with your real host):

- **`https://YOUR_DEPLOYMENT.vercel.app/api/blob-status`**  
  Should return JSON like `{ "ok": true, "blobReadWriteToken": "configured" }`.  
  If it says **`"missing"`**, the token is not set for that deployment — fix step 1 and redeploy.

- In the app **Capture** screen, tap **“Check server setup”** — same JSON appears in the status area.

If **`/api/blob-status` itself** fails or hangs, the problem is broader (build, routing, or runtime), not only Blob. Use step 5.

## 5. Function logs (find the real error)

1. **Vercel** → project → **Deployments** → latest successful (or failed) deployment.
2. Open **Functions** or **Logs** (wording varies).
3. Filter or search for **`/api/upload`** or **`/api/blob-status`** and the time of your request.
4. Copy the **stack trace** or error message — that line explains the crash (e.g. missing module, thrown error inside the handler).

## 6. Browser devtools (client-side)

- **Desktop:** DevTools → **Console** — failed uploads log `[upload] failed` with status and response snippet.
- **Mobile:** use remote debugging (Safari Web Inspector / Chrome `chrome://inspect`) or reproduce on desktop.

## 7. Git ↔ Vercel project

Confirm this GitHub repo is the one **imported** under **Settings** → **Git** for the project you’re testing. The wrong project may deploy old code or miss env vars.
