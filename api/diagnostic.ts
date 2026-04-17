import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Legacy Node handler — Web `Request` handlers were hanging on this Vite deployment;
 * `@vercel/node` + `res.json()` is the reliable path.
 */
export default function handler(req: VercelRequest, res: VercelResponse): void {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    ok: true,
    time: new Date().toISOString(),
    blobReadWriteToken: process.env.BLOB_READ_WRITE_TOKEN ? 'configured' : 'missing',
  });
}
