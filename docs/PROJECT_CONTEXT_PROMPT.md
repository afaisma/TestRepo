# Context prompt: NourishFlow / Camera POC (for architecture & next steps)

Copy this document (or attach it) when asking Claude to recommend **next steps**, **architecture**, or **tradeoffs**. Update the “Current state” section as the repo evolves.

---

## One-line summary

**Mobile-first web prototype:** staff capture a photo in the browser, attach **when**, **where** (from an allowlist), and **notes**, upload to **Vercel**, store images in **Vercel Blob**, index each submission in **Neon Postgres**, and browse/filter history by **location** and/or **UTC calendar day**. Legacy **single “latest”** image + JSON metadata remain for a simple “last upload” view.

---

## Product intent (prototype goals)

1. **Low-friction capture** on phones: camera or gallery, preview, retake, optional compression under serverless body limits (~4.5 MB).
2. **Structured metadata** tied to each photo: **captured time** (user-editable `datetime-local`), **room/location** (server-driven allowlist), **free-text notes**.
3. **Operational truth over time:** not only “the last picture globally,” but **queryable history** — e.g. latest for a given room, all submissions for a room, all submissions on a given **UTC** day (first iteration uses UTC; org-local timezone is a known gap).
4. **Configurable locations** without redeploy: admin-style editor (POC **unauthenticated** — acceptable only for private demos).
5. **Lightweight audit / device context (POC):** optional `client_info` JSON + `User-Agent` stored with each submission for support/debugging — not a substitute for real identity or compliance.

## Broader project goals (beyond current code)

- **Reliability:** predictable uploads, clear errors, observability (logs, diagnostics).
- **Security & governance (production):** authenticate **admin** and any **destructive** APIs; protect secrets; consider retention, access control, and regulatory context if used in healthcare-adjacent settings.
- **Scalability:** many submissions, pagination, maybe retention policies; Blob for bytes, Postgres (or similar) for **queryable metadata**.
- **Portability:** core design is “object storage + DB”; hosting is currently **Vercel + Blob + Neon** but could move with a storage + DB abstraction.

---

## Current technical state (stack)

| Layer | Choice |
|--------|--------|
| Frontend | **Vite**, **TypeScript**, **hash routing** (`#/capture`, `#/view`, `#/browse`, `#/admin`) |
| Hosting | **Vercel** (static `dist/` + `/api/*.ts` serverless) |
| Object storage | **Vercel Blob** (`@vercel/blob`) |
| Database | **Neon Postgres** via **`@neondatabase/serverless`** + `DATABASE_URL` |
| Multipart upload | **busboy** on raw Node request stream |
| Critical env | `BLOB_READ_WRITE_TOKEN`, `DATABASE_URL`, **`NODEJS_HELPERS=0`** (required so busboy sees the full stream) |

---

## Data model (as implemented)

### Blob paths (stable keys)

- **Legacy global latest (still updated each upload):** `camera-poc/latest`, `camera-poc/meta.json`
- **Allowlist:** `camera-poc/locations.json`
- **Per submission (when DB enabled):** `camera-poc/submissions/{uuid}.{ext}` (ext from MIME: jpg/png/webp/gif)

### Postgres table: `submissions`

- `id` (UUID, PK), `captured_at` (timestamptz, from form), `location`, `notes`, `image_path`, `user_agent`, `client_info` (TEXT, JSON string), `created_at` (default now)
- Indexes on `(location, captured_at DESC)` and `(captured_at DESC)`
- Migration file: `db/migrations/001_submissions.sql` (must be applied in Neon)

### Behavior when `DATABASE_URL` is missing

- Upload still writes **legacy** `latest` + `meta.json`; **no** per-submission blob row path in that mode (implementation skips submission blob + INSERT).

---

## HTTP API (high level)

- **`POST /api/upload`** — multipart: `image`, `date_time`, `location`, `notes`, optional `client_info` (JSON string). Validates location against allowlist. If DB configured: put submission image + INSERT; always updates legacy latest + meta. Returns `{ ok, submissionId? }`.
- **`GET|POST /api/locations`** — read/write allowlist JSON in Blob (POST is **unauthenticated** in POC).
- **`GET /api/submissions`** — query `location` and/or `date` (`YYYY-MM-DD` UTC), `limit` (default 50, max 200).
- **`GET /api/submissions/latest`** — `location` required; latest row or `null`.
- **`GET|HEAD /api/submission-image`** — `id` (UUID); resolves `image_path` from DB, then Blob `head` + redirect.
- **`GET|HEAD /api/image`**, **`GET /api/meta`** — legacy global latest.
- **`GET /api/diagnostic`** — sanity JSON (includes blob + DB env presence, not values).

---

## Frontend routes

- **`#/capture`** — camera/gallery → review form → upload.
- **`#/view`** — global last image + meta from legacy Blob endpoints.
- **`#/browse`** — filter submissions by location and/or UTC day; thumbnails link to `submission-image`.
- **`#/admin`** — edit location allowlist (POC: no auth).

---

## Known gaps / intentional POC debt

- **No authentication** on admin or submission writes; **not** production-safe on a public URL.
- **“Today” / filters** are **UTC**-day based in API; hospital-local timezone policy not finalized.
- **Orphan blobs** if DB INSERT fails after Blob put (error message guides operator to migration).
- **Production hardening:** IAM-style least privilege, secret rotation, rate limits, virus scanning, and formal retention are **out of scope** for the current POC unless explicitly added.
- **Deployment health** should be verified on Vercel (logs, env vars, successful deploy of `main`).

---

## Questions Claude should use to steer architecture

When proposing next steps, explicitly address:

1. **Identity & authorization** — who may upload, who may edit locations, who may read which submissions?
2. **Timezone & reporting** — how is “today” and “per site” defined for filters and exports?
3. **Data lifecycle** — retention, deletion, and legal hold for images + metadata.
4. **Multi-tenant / multi-site** — single DB with `site_id` vs separate projects.
5. **Client upload strategy** — keep server-mediated Blob `put` vs presigned direct uploads for very large media.
6. **Observability** — structured logging, correlation ids, alerting on `FUNCTION_INVOCATION_FAILED` or upload error rates.

---

## How to use this prompt

**Example instruction to Claude:**

> Read `docs/PROJECT_CONTEXT_PROMPT.md`. Given the current state and goals, propose a phased roadmap (POC → pilot → production). For each phase, list architecture decisions, risks, and the minimal set of features. Call out breaking changes to the existing Blob paths or API.

Replace file paths or hostnames if you fork the repo.
