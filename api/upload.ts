import { put } from '@vercel/blob';
import { BLOB_PATH } from './blobPath';

const MAX_BYTES = 4_500_000;

function json(data: object, status: number, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

/**
 * Must be a default **function** (not `export default { fetch: ... }`), per Vercel Node runtime.
 */
export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405, { Allow: 'POST' });
  }

  try {
    const token = process.env.BLOB_READ_WRITE_TOKEN;
    if (!token) {
      return json({ error: 'Server missing BLOB_READ_WRITE_TOKEN' }, 500);
    }

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return json({ error: 'Could not read form data' }, 400);
    }

    const entry = formData.get('image');
    if (!entry || typeof entry === 'string') {
      return json({ error: 'No image file in request (field name: image)' }, 400);
    }

    const file = entry as File;
    if (!file.type.startsWith('image/')) {
      return json({ error: 'Only image uploads are allowed' }, 400);
    }

    const buf = Buffer.from(await file.arrayBuffer());
    if (buf.length > MAX_BYTES) {
      return json({ error: 'File too large' }, 413);
    }

    await put(BLOB_PATH, buf, {
      access: 'public',
      contentType: file.type || 'image/jpeg',
      addRandomSuffix: false,
      token,
    });

    return Response.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Upload failed';
    return json({ error: message }, 500);
  }
}
