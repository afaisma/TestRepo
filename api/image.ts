import type { VercelRequest, VercelResponse } from '@vercel/node';
import { BlobNotFoundError, head } from '@vercel/blob';
import { BLOB_PATH } from './blobPath.js';

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

  try {
    const blob = await head(BLOB_PATH, { token });
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
      res.status(404).json({ error: 'No image uploaded yet' });
      return;
    }
    const message = e instanceof Error ? e.message : 'Error';
    res.status(500).json({ error: message });
  }
}
