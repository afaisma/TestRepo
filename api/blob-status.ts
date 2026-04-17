/**
 * GET /api/blob-status — safe diagnostics (no secrets).
 * Named to avoid any edge case with paths like /api/health on the platform/CDN.
 */
export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'GET') {
    return new Response(null, { status: 405, headers: { Allow: 'GET' } });
  }

  const hasBlobToken = Boolean(process.env.BLOB_READ_WRITE_TOKEN);

  return Response.json(
    {
      ok: true,
      time: new Date().toISOString(),
      blobReadWriteToken: hasBlobToken ? 'configured' : 'missing',
    },
    {
      headers: {
        'Cache-Control': 'no-store',
      },
    },
  );
}
