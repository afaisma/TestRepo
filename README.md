# Camera capture POC

Small mobile-first web app: capture a photo in the browser, preview and retake, upload a single image to the server, and view the latest upload on a separate screen.

## Design

- **Frontend**: Vite + TypeScript, hash routing (`#/capture`, `#/view`, `#/admin`). Live camera via `getUserMedia`, preview, optional gallery pick. In review, the user sets **date/time**, **location** (options loaded from the server), and optional **notes**, then uploads via `multipart/form-data` (fields: `image`, `date_time`, `location`, `notes`). **`#/admin`** edits the allowed location list (POC: **no authentication** on `POST /api/locations` — fine for private demos, not for public production).
- **Backend**: Vercel Serverless Functions under `/api`:
  - `GET /api/locations` — returns `{ "locations": string[] }` from Blob **`camera-poc/locations.json`**, or built-in defaults (Loc1–Loc10) if the file is missing.
  - `POST /api/locations` — JSON body `{ "locations": string[] }` overwrites that blob (POC: unauthenticated).
  - `POST /api/upload` — parses multipart with [busboy](https://github.com/mscdex/busboy), validates `location` against the current allowlist, writes the image to **`camera-poc/latest`** and JSON metadata to **`camera-poc/meta.json`** ([api/blobPath.ts](api/blobPath.ts)); both overwrite on each upload.
  - `GET /api/meta` — returns the last metadata JSON from Blob, or **404** if none.
  - `GET|HEAD /api/image` — `head()` the image pathname; if it exists, **redirects** to the public blob URL (or returns headers on `HEAD`); if not, **404** so the view page can show “No image uploaded yet”.
- **Why Blob, not a local file on the VM**: Free serverless hosts usually do not give you durable disk; a single blob with a stable key matches the “one image, overwrite” requirement and works on Vercel’s free tier.

**Limits**: Vercel Functions accept bodies up to about **4.5 MB** for server uploads; larger camera photos may need client-side compression or client uploads (out of scope for this POC).

## Run locally (full stack)

You need a **Vercel Blob** store and `BLOB_READ_WRITE_TOKEN` (see [Vercel Blob server uploads](https://vercel.com/docs/vercel-blob/server-upload)).

1. Install dependencies:

   ```bash
   npm install
   ```

2. Install the [Vercel CLI](https://vercel.com/docs/cli) globally or use `npx vercel`.

3. Link the folder to a Vercel project (creates `.vercel/`):

   ```bash
   npx vercel link
   ```

4. In the Vercel dashboard: **Storage → Create** → **Blob**, attach it to this project so `BLOB_READ_WRITE_TOKEN` is created (or pull env):

   ```bash
   npx vercel env pull
   ```

   That writes `.env.local` with `BLOB_READ_WRITE_TOKEN`.

5. Run the app with API routes (not plain Vite alone):

   ```bash
   npm run dev:full
   ```

   Or: `npx vercel dev`

6. Open the URL the CLI prints (often `http://localhost:3000`). On a phone, use your machine’s LAN IP and the same port if the CLI binds to `0.0.0.0` (check CLI output), or use a tunnel (e.g. `ngrok`) for HTTPS if the browser blocks camera on insecure origins—**mobile camera often requires HTTPS** except on `localhost`.

**Frontend only** (no upload/view API): `npm run dev` → Vite on port 5173; `/api/*` will not exist locally.

## Build

```bash
npm run build
```

Output: `dist/`. API routes stay as `/api/*.ts` for Vercel.

## Deploy to Vercel (free Hobby)

1. Push this repo to **GitHub** (see section below).
2. In [Vercel](https://vercel.com): **Add New → Project → Import** your GitHub repository.
3. Use defaults: **Build Command** `npm run build`, **Output Directory** `dist` (or rely on [vercel.json](vercel.json)).
4. Ensure **Blob** is connected to the project and `BLOB_READ_WRITE_TOKEN` is present for Production (and Preview if you want previews to work).
5. Deploy. Your **deployed test URL** will look like `https://<project-name>.vercel.app` (shown on the deployment and in **Project → Domains**).

You must copy that URL into your own notes or README; it is assigned by Vercel after the first successful deploy.

## Push to GitHub

From this directory (if not already a git repo):

```bash
git init
git add .
git commit -m "Add camera capture POC"
```

Create an empty repository on GitHub (no README if you already have one locally), then:

```bash
git remote add origin https://github.com/<your-username>/<your-repo>.git
git branch -M main
git push -u origin main
```

Use SSH instead of HTTPS if you prefer `git@github.com:...`.

## Project layout

| Path | Role |
|------|------|
| [src/main.ts](src/main.ts) | Hash router, capture + view UI |
| [src/styles.css](src/styles.css) | Layout and theme |
| [api/upload.ts](api/upload.ts) | `POST /api/upload` |
| [api/locations.ts](api/locations.ts) | `GET|POST /api/locations` |
| [api/locationsStore.ts](api/locationsStore.ts) | Read/write allowlist JSON in Blob |
| [api/image.ts](api/image.ts) | `GET|HEAD /api/image` |
| [api/blobPath.ts](api/blobPath.ts) | Blob pathnames (image, meta, locations) |
| [vercel.json](vercel.json) | Build output + SPA rewrite (excluding `/api/*`) |

## License

Private / POC — use as you like.
