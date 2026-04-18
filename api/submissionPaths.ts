/** Blob pathname for a submission image (stable key, no random suffix). */
export function submissionImageBlobPath(id: string, mime: string): string {
  const ext = mimeToExt(mime);
  return `camera-poc/submissions/${id}.${ext}`;
}

function mimeToExt(mime: string): string {
  const m = mime.toLowerCase().split(';')[0].trim();
  if (m === 'image/png') return 'png';
  if (m === 'image/webp') return 'webp';
  if (m === 'image/gif') return 'gif';
  return 'jpg';
}
