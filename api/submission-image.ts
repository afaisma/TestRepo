import type { VercelRequest, VercelResponse } from '@vercel/node';
import { BlobNotFoundError, head } from '@vercel/blob';
import { imagePathForSubmissionId } from './submissionsQuery.js';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function q1(val: string | string[] | undefined): string | undefined {
  if (Array.isArray(val)) return val[0];
  return val;
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.status(405).setHeader('Allow', 'GET, HEAD').end();
    return;
  }

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    res.status(500).json({ error: 'Server missing BLOB_READ_WRITE_TOKEN' });
    return;
  }

  if (!process.env.DATABASE_URL?.trim()) {
    res.status(500).json({ error: 'Server missing DATABASE_URL' });
    return;
  }

  const id = q1(req.query.id)?.trim();
  if (!id || !UUID_RE.test(id)) {
    res.status(400).json({ error: 'Valid id (UUID) query parameter is required' });
    return;
  }

  try {
    const pathname = await imagePathForSubmissionId(id);
    if (!pathname) {
      if (req.method === 'HEAD') {
        res.status(404).end();
        return;
      }
      res.status(404).json({ error: 'Submission not found' });
      return;
    }

    const blob = await head(pathname, { token });
    if (req.method === 'HEAD') {
      res.status(200).setHeader('Content-Type', blob.contentType || 'image/jpeg').end();
      return;
    }
    res.redirect(307, blob.url);
  } catch (e: unknown) {
    if (e instanceof BlobNotFoundError) {
      if (req.method === 'HEAD') {
        res.status(404).end();
        return;
      }
      res.status(404).json({ error: 'Image not found' });
      return;
    }
    const message = e instanceof Error ? e.message : 'Error';
    res.status(500).json({ error: message });
  }
}
