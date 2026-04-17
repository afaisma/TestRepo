import type { VercelRequest, VercelResponse } from '@vercel/node';
import getRawBody from 'raw-body';
import { put } from '@vercel/blob';
import { BLOB_PATH } from './blobPath.js';

const MAX_BYTES = 4_500_000;

/**
 * Raw image bytes in POST body (see client: `fetch` with `body: file` + Content-Type).
 * Requires an unconsumed request stream; if uploads fail with empty body, set
 * `NODEJS_HELPERS=0` for the project on Vercel (see VERCEL_CHECKLIST.md).
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).setHeader('Allow', 'POST').json({ error: 'Method not allowed' });
    return;
  }

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    res.status(500).json({ error: 'Server missing BLOB_READ_WRITE_TOKEN' });
    return;
  }

  const rawCt = String(req.headers['content-type'] || '');
  const contentType = rawCt.split(';')[0].trim().toLowerCase();
  if (!contentType.startsWith('image/')) {
    res.status(400).json({ error: 'Content-Type must be an image/* type' });
    return;
  }

  try {
    const buffer = await getRawBody(req, {
      limit: MAX_BYTES,
      length: req.headers['content-length']
        ? Number.parseInt(String(req.headers['content-length']), 10)
        : undefined,
    });

    if (!buffer.length) {
      res.status(400).json({
        error:
          'Empty body — if this persists, add env var NODEJS_HELPERS=0 on Vercel and redeploy.',
      });
      return;
    }

    await put(BLOB_PATH, buffer, {
      access: 'public',
      contentType,
      addRandomSuffix: false,
      token,
    });
    res.status(200).json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Upload failed';
    const status = message.toLowerCase().includes('limit') || message.includes('too large') ? 413 : 500;
    res.status(status).json({ error: message });
  }
}
