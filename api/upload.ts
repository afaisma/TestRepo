import type { VercelRequest, VercelResponse } from '@vercel/node';
import busboy from 'busboy';
import { put } from '@vercel/blob';
import { BLOB_PATH } from './blobPath';

export const config = {
  api: {
    bodyParser: false,
  },
};

const MAX_BYTES = 4_500_000; // Vercel function body limit

function parseImage(req: VercelRequest): Promise<{ buffer: Buffer; contentType: string } | null> {
  return new Promise((resolve, reject) => {
    const bb = busboy({
      headers: req.headers,
      limits: { fileSize: MAX_BYTES },
    });

    let settled = false;

    const finishEmpty = () => {
      if (!settled) {
        settled = true;
        resolve(null);
      }
    };

    bb.on('file', (name, file, info) => {
      if (name !== 'image' || settled) {
        file.resume();
        return;
      }
      const chunks: Buffer[] = [];
      file.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });
      file.on('limit', () => {
        if (!settled) {
          settled = true;
          reject(new Error('File too large'));
        }
      });
      file.on('end', () => {
        if (settled) return;
        const buffer = Buffer.concat(chunks);
        const contentType = info.mimeType || 'application/octet-stream';
        if (!contentType.startsWith('image/')) {
          settled = true;
          reject(new Error('Only image uploads are allowed'));
          return;
        }
        settled = true;
        resolve({ buffer, contentType });
      });
    });

    bb.on('error', (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });
    bb.on('finish', finishEmpty);

    req.pipe(bb);
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).setHeader('Allow', 'POST').json({ error: 'Method not allowed' });
    return;
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    res.status(500).json({ error: 'Server missing BLOB_READ_WRITE_TOKEN' });
    return;
  }

  try {
    const parsed = await parseImage(req);
    if (!parsed) {
      res.status(400).json({ error: 'No image file in request (field name: image)' });
      return;
    }

    await put(BLOB_PATH, parsed.buffer, {
      access: 'public',
      contentType: parsed.contentType,
      addRandomSuffix: false,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });

    res.status(200).json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Upload failed';
    const status =
      message.includes('too large') || message.includes('large')
        ? 413
        : message.includes('Only image')
          ? 400
          : 500;
    res.status(status).json({ error: message });
  }
}
