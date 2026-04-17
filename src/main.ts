import './styles.css';

const el = document.getElementById('app');
if (!el || !(el instanceof HTMLDivElement)) {
  throw new Error('#app missing');
}
const app = el;

/** Stopped when leaving capture route or starting a new take. */
let activeCaptureStream: MediaStream | null = null;

function stopCaptureStream() {
  activeCaptureStream?.getTracks().forEach((t) => t.stop());
  activeCaptureStream = null;
}

async function openCameraStream(): Promise<MediaStream> {
  const attempts: MediaStreamConstraints[] = [
    { video: { facingMode: { ideal: 'environment' } }, audio: false },
    { video: { facingMode: 'environment' }, audio: false },
    { video: true, audio: false },
  ];
  let last: unknown;
  for (const constraints of attempts) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      activeCaptureStream = stream;
      return stream;
    } catch (e) {
      last = e;
    }
  }
  throw last instanceof Error ? last : new Error('Camera not available');
}

/** Vercel serverless body limit is ~4.5MB — stay under so uploads are accepted. */
const MAX_UPLOAD_BYTES = 4_000_000;

async function videoToJpegFile(video: HTMLVideoElement): Promise<File> {
  const w0 = video.videoWidth;
  const h0 = video.videoHeight;
  if (w0 === 0 || h0 === 0) {
    throw new Error('Camera not ready yet');
  }
  const maxEdge = 1920;
  const scale = Math.min(1, maxEdge / Math.max(w0, h0));
  const w = Math.round(w0 * scale);
  const h = Math.round(h0 * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Could not capture image');
  }
  ctx.drawImage(video, 0, 0, w, h);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Could not capture image'));
          return;
        }
        resolve(new File([blob], `camera-${Date.now()}.jpg`, { type: 'image/jpeg' }));
      },
      'image/jpeg',
      0.88,
    );
  });
}

/**
 * Shrinks JPEG dimensions/quality until under Vercel's limit (large gallery picks / high-res).
 */
async function compressImageForUpload(file: File): Promise<File> {
  if (file.size <= MAX_UPLOAD_BYTES) {
    return file;
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('Could not read this image — try another format (JPEG/PNG).');
  }

  let maxSide = 2048;
  let quality = 0.85;

  try {
    for (let round = 0; round < 18; round++) {
      const w = bitmap.width;
      const h = bitmap.height;
      const scale = Math.min(1, maxSide / Math.max(w, h));
      const tw = Math.max(1, Math.round(w * scale));
      const th = Math.max(1, Math.round(h * scale));

      const canvas = document.createElement('canvas');
      canvas.width = tw;
      canvas.height = th;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error('Could not process image');
      }
      ctx.drawImage(bitmap, 0, 0, tw, th);

      const blob: Blob | null = await new Promise((resolve) =>
        canvas.toBlob((b) => resolve(b), 'image/jpeg', quality),
      );
      if (!blob) {
        throw new Error('Could not compress image');
      }
      if (blob.size <= MAX_UPLOAD_BYTES) {
        return new File([blob], 'upload.jpg', { type: 'image/jpeg' });
      }
      if (quality > 0.48) {
        quality -= 0.06;
      } else {
        maxSide = Math.max(640, Math.floor(maxSide * 0.88));
        quality = 0.82;
      }
    }
    throw new Error('Image is still too large — try a smaller photo.');
  } finally {
    bitmap.close();
  }
}

type Route = 'capture' | 'view';

function currentRoute(): Route {
  const h = window.location.hash.replace(/^#\/?/, '') || 'capture';
  return h === 'view' ? 'view' : 'capture';
}

function renderCapture(root: HTMLDivElement) {
  let previewObjectUrl: string | null = null;
  /** Image ready to upload (from camera snapshot or file picker). */
  let currentFile: File | null = null;
  /** 'idle' | 'live' (camera on) | 'review' (frozen frame / file chosen) */
  let phase: 'idle' | 'live' | 'review' = 'idle';

  const revokePreview = () => {
    if (previewObjectUrl) {
      URL.revokeObjectURL(previewObjectUrl);
      previewObjectUrl = null;
    }
  };

  root.innerHTML = `
    <header>
      <h1>Capture</h1>
      <nav><a href="#/view">View last</a></nav>
    </header>
    <div class="preview-wrap" id="previewBox">
      <span class="preview-placeholder" id="placeholder">Camera preview</span>
      <video id="previewVideo" playsinline muted style="display:none"></video>
      <img id="previewImg" alt="Preview" style="display:none" />
    </div>
    <div class="actions" id="actionsIdle">
      <button type="button" class="btn-primary" id="takePhoto">Take photo</button>
    </div>
    <div class="actions actions-row" id="actionsLive" style="display:none">
      <button type="button" class="btn-secondary" id="cancelLive">Cancel</button>
      <button type="button" class="btn-primary" id="shutter">Capture</button>
    </div>
    <div class="actions" id="actionsReview" style="display:none">
      <button type="button" class="btn-secondary" id="retake">Retake</button>
      <button type="button" class="btn-primary" id="upload">Upload</button>
    </div>
    <p class="fallback-link">
      <input id="file" type="file" accept="image/*" class="sr-only" tabindex="-1" />
      <button type="button" class="btn-secondary" id="pickGallery" style="width: 100%">
        Choose from gallery
      </button>
    </p>
    <p class="status" id="status" aria-live="polite"></p>
    <p class="setup-tools">
      <button type="button" class="setup-link" id="checkSetup">Check server setup</button>
    </p>
  `;

  const placeholder = root.querySelector<HTMLSpanElement>('#placeholder')!;
  const previewVideo = root.querySelector<HTMLVideoElement>('#previewVideo')!;
  const previewImg = root.querySelector<HTMLImageElement>('#previewImg')!;
  const actionsIdle = root.querySelector<HTMLDivElement>('#actionsIdle')!;
  const actionsLive = root.querySelector<HTMLDivElement>('#actionsLive')!;
  const actionsReview = root.querySelector<HTMLDivElement>('#actionsReview')!;
  const takePhotoBtn = root.querySelector<HTMLButtonElement>('#takePhoto')!;
  const cancelLiveBtn = root.querySelector<HTMLButtonElement>('#cancelLive')!;
  const shutterBtn = root.querySelector<HTMLButtonElement>('#shutter')!;
  const retakeBtn = root.querySelector<HTMLButtonElement>('#retake')!;
  const uploadBtn = root.querySelector<HTMLButtonElement>('#upload')!;
  const fileInput = root.querySelector<HTMLInputElement>('#file')!;
  const pickGalleryBtn = root.querySelector<HTMLButtonElement>('#pickGallery')!;
  const checkSetupBtn = root.querySelector<HTMLButtonElement>('#checkSetup')!;
  const statusEl = root.querySelector<HTMLParagraphElement>('#status')!;

  const setStatus = (text: string, kind: '' | 'error' | 'ok' | 'info' = '') => {
    statusEl.textContent = text;
    statusEl.className = `status${kind ? ` ${kind}` : ''}`;
  };

  const showPhase = () => {
    const idle = phase === 'idle';
    const live = phase === 'live';
    const review = phase === 'review';
    actionsIdle.style.display = idle ? 'flex' : 'none';
    actionsLive.style.display = live ? 'flex' : 'none';
    actionsReview.style.display = review ? 'flex' : 'none';
    pickGalleryBtn.disabled = live;
  };

  const clearReview = () => {
    revokePreview();
    currentFile = null;
    previewImg.style.display = 'none';
    previewImg.removeAttribute('src');
  };

  const enterIdle = () => {
    stopCaptureStream();
    previewVideo.srcObject = null;
    previewVideo.style.display = 'none';
    clearReview();
    placeholder.style.display = '';
    placeholder.textContent = 'Camera preview';
    phase = 'idle';
    showPhase();
  };

  const enterReview = (file: File) => {
    stopCaptureStream();
    previewVideo.srcObject = null;
    previewVideo.style.display = 'none';
    revokePreview();
    currentFile = file;
    previewObjectUrl = URL.createObjectURL(file);
    previewImg.src = previewObjectUrl;
    previewImg.style.display = '';
    placeholder.style.display = 'none';
    phase = 'review';
    showPhase();
  };

  takePhotoBtn.addEventListener('click', async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus('Camera API not supported — use “Choose from gallery”.', 'error');
      return;
    }
    setStatus('Starting camera…');
    takePhotoBtn.disabled = true;
    pickGalleryBtn.disabled = true;
    try {
      const stream = await openCameraStream();
      previewVideo.srcObject = stream;
      previewVideo.style.display = '';
      placeholder.style.display = 'none';
      previewImg.style.display = 'none';
      await previewVideo.play();
      phase = 'live';
      setStatus('');
      showPhase();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not open camera';
      setStatus(`${msg} — try “Choose from gallery” or check permissions.`, 'error');
      enterIdle();
    } finally {
      takePhotoBtn.disabled = false;
      pickGalleryBtn.disabled = false;
    }
  });

  cancelLiveBtn.addEventListener('click', () => {
    setStatus('');
    enterIdle();
  });

  shutterBtn.addEventListener('click', async () => {
    try {
      const file = await videoToJpegFile(previewVideo);
      enterReview(file);
      setStatus('');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Capture failed';
      setStatus(msg, 'error');
    }
  });

  retakeBtn.addEventListener('click', () => {
    setStatus('');
    fileInput.value = '';
    enterIdle();
  });

  pickGalleryBtn.addEventListener('click', () => {
    fileInput.click();
  });

  checkSetupBtn.addEventListener('click', async () => {
    checkSetupBtn.disabled = true;
    setStatus('Checking…', 'info');
    try {
      const res = await fetch('/api/blob-status');
      const raw = await res.text();
      let payload: unknown;
      try {
        payload = JSON.parse(raw);
      } catch {
        payload = raw.slice(0, 400);
      }
      const line = typeof payload === 'object' && payload !== null
        ? JSON.stringify(payload, null, 2)
        : String(payload);
      setStatus(res.ok ? line : `HTTP ${res.status}\n${line}`, res.ok ? 'info' : 'error');
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Request failed', 'error');
    } finally {
      checkSetupBtn.disabled = false;
    }
  });

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    setStatus('');
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setStatus('Please choose an image file.', 'error');
      return;
    }
    enterReview(file);
  });

  uploadBtn.addEventListener('click', async () => {
    if (!currentFile) return;
    uploadBtn.disabled = true;
    setStatus('Preparing…');
    try {
      const toSend = await compressImageForUpload(currentFile);
      setStatus('Uploading…');
      const body = new FormData();
      body.append('image', toSend, toSend.name);
      const res = await fetch('/api/upload', { method: 'POST', body });
      const raw = await res.text();
      let serverError: string | undefined;
      try {
        serverError = (JSON.parse(raw) as { error?: string }).error;
      } catch {
        serverError = raw ? raw.slice(0, 300) : undefined;
      }
      if (!res.ok) {
        console.error('[upload] failed', { status: res.status, body: raw.slice(0, 500) });
        throw new Error(
          serverError ||
            (raw.includes('FUNCTION_INVOCATION_FAILED')
              ? 'Server function crashed — open Vercel → Deployment → Logs, or use “Check server setup” and /api/blob-status.'
              : `Upload failed (${res.status})`),
        );
      }
      revokePreview();
      stopCaptureStream();
      setStatus('Uploaded.', 'ok');
      window.location.hash = '#/view';
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Upload failed';
      setStatus(msg, 'error');
      uploadBtn.disabled = false;
    }
  });

  showPhase();
}

function renderView(root: HTMLDivElement) {
  const bust = Date.now();
  root.innerHTML = `
    <header>
      <h1>Last upload</h1>
      <nav><a href="#/capture">Capture</a></nav>
    </header>
    <div class="view-frame" id="frame">
      <img id="shot" alt="Last uploaded image" style="display:none" />
      <p class="empty-msg" id="empty">No image uploaded yet</p>
    </div>
  `;

  const img = root.querySelector<HTMLImageElement>('#shot')!;
  const empty = root.querySelector<HTMLParagraphElement>('#empty')!;

  const showEmpty = () => {
    img.style.display = 'none';
    empty.style.display = 'block';
  };

  const showImg = () => {
    img.style.display = '';
    empty.style.display = 'none';
  };

  img.onload = () => showImg();
  img.onerror = () => showEmpty();
  img.src = `/api/image?t=${bust}`;
}

function render() {
  const route = currentRoute();
  if (route !== 'capture') {
    stopCaptureStream();
  }
  const root = app;
  if (route === 'view') {
    renderView(root);
  } else {
    renderCapture(root);
  }
}

window.addEventListener('hashchange', render);
render();
