import type { VercelRequest, VercelResponse } from '@vercel/node';
import { randomUUID } from 'node:crypto';
import busboy from 'busboy';
import { put } from '@vercel/blob';
import { BLOB_PATH, META_PATH } from './blobPath.js';
import { readAllowedLocations } from './locationsStore.js';
import { submissionImageBlobPath } from './submissionPaths.js';
import { insertSubmission } from './submissionsRepo.js';

const MAX_BYTES = 4_500_000;
const MAX_NOTES_LEN = 2000;
const MAX_CLIENT_INFO_LEN = 4000;
const MAX_USER_AGENT_LEN = 512;

type ParsedMultipart = {
  image: { buffer: Buffer; mime: string };
  fields: Record<string, string>;
};

function parseMultipart(req: VercelRequest): Promise<ParsedMultipart> {
  return new Promise((resolve, reject) => {
    const bb = busboy({
      headers: req.headers,
      limits: { fileSize: MAX_BYTES, files: 1, fields: 20 },
    });

    const fields: Record<string, string> = {};
    let imageBuffer: Buffer | null = null;
    let imageMime = 'application/octet-stream';
    let imageDone: Promise<void> = Promise.resolve();

    bb.on('file', (name, file, info) => {
      if (name !== 'image') {
        file.resume();
        return;
      }
      const chunks: Buffer[] = [];
      imageDone = new Promise<void>((res, rej) => {
        file.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
        });
        file.on('limit', () => rej(new Error('File too large')));
        file.on('end', () => {
          imageBuffer = Buffer.concat(chunks);
          imageMime = info.mimeType || 'application/octet-stream';
          res();
        });
        file.on('error', rej);
      });
    });

    bb.on('field', (name, val) => {
      fields[name] = val;
    });

    bb.on('error', reject);
    bb.on('finish', async () => {
      try {
        await imageDone;
        if (!imageBuffer?.length) {
          reject(new Error('No image in request (field name: image)'));
          return;
        }
        resolve({ image: { buffer: imageBuffer, mime: imageMime }, fields });
      } catch (e) {
        reject(e);
      }
    });

    req.pipe(bb);
  });
}

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
  if (!rawCt.toLowerCase().includes('multipart/form-data')) {
    res.status(400).json({ error: 'Content-Type must be multipart/form-data' });
    return;
  }

  try {
    const { image, fields } = await parseMultipart(req);

    if (!image.mime.startsWith('image/')) {
      res.status(400).json({ error: 'Image must be an image/* type' });
      return;
    }

    const dateRaw = (fields.date_time || '').trim();
    const location = (fields.location || '').trim();
    const notes = (fields.notes || '').trim();

    if (!dateRaw) {
      res.status(400).json({ error: 'date_time is required' });
      return;
    }
    const dateParsed = new Date(dateRaw);
    if (Number.isNaN(dateParsed.getTime())) {
      res.status(400).json({ error: 'date_time is invalid' });
      return;
    }
    const date_time = dateParsed.toISOString();

    if (!location) {
      res.status(400).json({ error: 'location is required' });
      return;
    }
    const allowed = await readAllowedLocations(token);
    if (!allowed.includes(location)) {
      res.status(400).json({ error: 'location must be one of the allowed values' });
      return;
    }

    if (notes.length > MAX_NOTES_LEN) {
      res.status(400).json({ error: `notes must be at most ${MAX_NOTES_LEN} characters` });
      return;
    }

    const clientRaw = (fields.client_info || '').trim();
    if (clientRaw.length > MAX_CLIENT_INFO_LEN) {
      res.status(400).json({ error: `client_info must be at most ${MAX_CLIENT_INFO_LEN} characters` });
      return;
    }
    let clientInfoJson: string | null = null;
    if (clientRaw) {
      try {
        JSON.parse(clientRaw);
        clientInfoJson = clientRaw;
      } catch {
        res.status(400).json({ error: 'client_info must be valid JSON' });
        return;
      }
    }

    const meta = {
      date_time,
      location,
      notes,
    };

    const hasDb = Boolean(process.env.DATABASE_URL?.trim());
    const submissionId = randomUUID();
    const imagePath = submissionImageBlobPath(submissionId, image.mime);
    const uaRaw = req.headers['user-agent'];
    const userAgent =
      typeof uaRaw === 'string' ? uaRaw.slice(0, MAX_USER_AGENT_LEN) : null;

    if (hasDb) {
      await put(imagePath, image.buffer, {
        access: 'public',
        contentType: image.mime,
        addRandomSuffix: false,
        token,
      });
      try {
        await insertSubmission({
          id: submissionId,
          capturedAt: dateParsed,
          location,
          notes,
          imagePath,
          userAgent,
          clientInfoJson,
        });
      } catch (dbErr) {
        const dbMsg = dbErr instanceof Error ? dbErr.message : 'Database error';
        res.status(500).json({
          error: `Image stored but database save failed: ${dbMsg}. Ensure migrations ran (db/migrations/001_submissions.sql).`,
        });
        return;
      }
    }

    await put(BLOB_PATH, image.buffer, {
      access: 'public',
      contentType: image.mime,
      addRandomSuffix: false,
      token,
    });

    await put(META_PATH, JSON.stringify(meta), {
      access: 'public',
      contentType: 'application/json; charset=utf-8',
      addRandomSuffix: false,
      token,
    });

    res.status(200).json({ ok: true, submissionId: hasDb ? submissionId : undefined });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Upload failed';
    const lower = message.toLowerCase();
    const status =
      lower.includes('too large') || lower.includes('limit') ? 413 : lower.includes('no image') ? 400 : 500;
    res.status(status).json({ error: message });
  }
}
