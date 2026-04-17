/**
 * Safe diagnostics (no secrets). Open GET /api/health in the browser to verify
 * the function runs and whether BLOB_READ_WRITE_TOKEN is present at runtime.
 */
export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'GET') {
    return new Response(null, { status: 405, headers: { Allow: 'GET' } });
  }

  const hasBlobToken = Boolean(process.env.BLOB_READ_WRITE_TOKEN);

  return Response.json({
    ok: true,
    time: new Date().toISOString(),
    /** Whether the env var exists in this deployment (value is never returned). */
    blobReadWriteToken: hasBlobToken ? 'configured' : 'missing',
  });
}
