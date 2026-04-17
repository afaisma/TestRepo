import { BlobNotFoundError, head } from '@vercel/blob';
import { BLOB_PATH } from './blobPath';

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
  }

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    return Response.json({ error: 'Server missing BLOB_READ_WRITE_TOKEN' }, { status: 500 });
  }

  try {
    const blob = await head(BLOB_PATH, { token });
    if (request.method === 'HEAD') {
      return new Response(null, {
        status: 200,
        headers: { 'Content-Type': blob.contentType || 'image/jpeg' },
      });
    }
    return Response.redirect(blob.url, 307);
  } catch (e: unknown) {
    if (e instanceof BlobNotFoundError) {
      if (request.method === 'HEAD') {
        return new Response(null, { status: 404 });
      }
      return Response.json({ error: 'No image uploaded yet' }, { status: 404 });
    }
    const message = e instanceof Error ? e.message : 'Error';
    return Response.json({ error: message }, { status: 500 });
  }
}
