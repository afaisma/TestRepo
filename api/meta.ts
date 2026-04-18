import type { VercelRequest, VercelResponse } from '@vercel/node';
import { BlobNotFoundError, head } from '@vercel/blob';
import { META_PATH } from './blobPath.js';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'GET') {
    res.status(405).setHeader('Allow', 'GET').json({ error: 'Method not allowed' });
    return;
  }

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    res.status(500).json({ error: 'Server missing BLOB_READ_WRITE_TOKEN' });
    return;
  }

  try {
    const blob = await head(META_PATH, { token });
    const r = await fetch(blob.url);
    if (!r.ok) {
      res.status(502).json({ error: 'Could not read metadata blob' });
      return;
    }
    const data: unknown = await r.json();
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(data);
  } catch (e: unknown) {
    if (e instanceof BlobNotFoundError) {
      res.status(404).json({ error: 'No metadata yet' });
      return;
    }
    const message = e instanceof Error ? e.message : 'Error';
    res.status(500).json({ error: message });
  }
}
