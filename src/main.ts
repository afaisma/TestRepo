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

function defaultLocalDatetime(): string {
  const d = new Date();
  const p = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

type Route = 'capture' | 'view' | 'admin' | 'browse';

type PhotoMeta = {
  date_time: string;
  location: string;
  notes: string;
};

function currentRoute(): Route {
  let h = window.location.hash.replace(/^#/, '');
  const q = h.indexOf('?');
  if (q >= 0) h = h.slice(0, q);
  h = h.replace(/^\/+/, '').replace(/\/+$/, '');
  const seg = (h || 'capture').toLowerCase();
  if (seg === 'view') return 'view';
  if (seg === 'admin') return 'admin';
  if (seg === 'browse') return 'browse';
  return 'capture';
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
      <nav><a href="#/view">View last</a> · <a href="#/browse">Browse</a> · <a href="#/admin">Locations</a></nav>
    </header>
    <div class="preview-wrap" id="previewBox">
      <span class="preview-placeholder" id="placeholder">Camera preview</span>
      <video id="previewVideo" playsinline muted style="display:none"></video>
      <img id="previewImg" alt="Preview" style="display:none" />
    </div>
    <div class="meta-panel" id="metaPanel" style="display: none">
      <label>
        Date and time
        <input type="datetime-local" id="metaDateTime" required />
      </label>
      <label>
        Location
        <select id="metaLocation" required disabled>
          <option value="">Loading locations…</option>
        </select>
      </label>
      <label>
        Notes <span style="color: #64748b">(optional)</span>
        <textarea id="metaNotes" maxlength="2000" rows="3" placeholder="Add notes…"></textarea>
      </label>
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
  const metaPanel = root.querySelector<HTMLDivElement>('#metaPanel')!;
  const metaDateTime = root.querySelector<HTMLInputElement>('#metaDateTime')!;
  const metaLocation = root.querySelector<HTMLSelectElement>('#metaLocation')!;
  const metaNotes = root.querySelector<HTMLTextAreaElement>('#metaNotes')!;
  const statusEl = root.querySelector<HTMLParagraphElement>('#status')!;

  fetch('/api/locations')
    .then(async (r) => {
      if (!r.ok) throw new Error('Could not load locations');
      const data = (await r.json()) as { locations?: unknown };
      const locs = Array.isArray(data.locations)
        ? data.locations.filter((x): x is string => typeof x === 'string')
        : [];
      metaLocation.disabled = false;
      metaLocation.innerHTML =
        '<option value="">Select location…</option>' +
        locs.map((loc) => {
          const label = escapeHtml(loc);
          const val = escapeHtmlAttr(loc);
          return `<option value="${val}">${label}</option>`;
        }).join('');
    })
    .catch((e) => {
      metaLocation.disabled = false;
      metaLocation.innerHTML =
        '<option value="">Select location…</option><option value="" disabled>(failed to load list)</option>';
      setStatus(e instanceof Error ? e.message : 'Could not load locations', 'error');
    });

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
    metaPanel.style.display = review ? 'flex' : 'none';
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
    metaDateTime.value = defaultLocalDatetime();
    metaLocation.value = '';
    metaNotes.value = '';
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
      const res = await fetch('/api/diagnostic');
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
    if (!metaDateTime.value) {
      setStatus('Please set date and time.', 'error');
      return;
    }
    if (!metaLocation.value) {
      setStatus('Please select a location.', 'error');
      return;
    }
    uploadBtn.disabled = true;
    setStatus('Preparing…');
    try {
      const toSend = await compressImageForUpload(currentFile);
      setStatus('Uploading…');
      const body = new FormData();
      body.append('image', toSend, toSend.name || 'photo.jpg');
      body.append('date_time', metaDateTime.value);
      body.append('location', metaLocation.value);
      body.append('notes', metaNotes.value.trim());
      body.append(
        'client_info',
        JSON.stringify({
          userAgent: navigator.userAgent,
          language: navigator.language,
          platform: navigator.platform,
        }),
      );
      const res = await fetch('/api/upload', {
        method: 'POST',
        body,
      });
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
              ? 'Server function crashed — open Vercel → Deployment → Logs, or use “Check server setup” and /api/diagnostic.'
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
      <nav><a href="#/capture">Capture</a> · <a href="#/browse">Browse</a> · <a href="#/admin">Locations</a></nav>
    </header>
    <div class="view-frame" id="frame">
      <img id="shot" alt="Last uploaded image" style="display:none" />
      <p class="empty-msg" id="empty">No image uploaded yet</p>
    </div>
    <div class="meta-display" id="metaDisplay" style="display: none"></div>
  `;

  const img = root.querySelector<HTMLImageElement>('#shot')!;
  const empty = root.querySelector<HTMLParagraphElement>('#empty')!;
  const metaDisplay = root.querySelector<HTMLDivElement>('#metaDisplay')!;

  const showEmpty = () => {
    img.style.display = 'none';
    empty.style.display = 'block';
  };

  const showImg = () => {
    img.style.display = '';
    empty.style.display = 'none';
  };

  const showMeta = (m: PhotoMeta) => {
    const when = new Date(m.date_time);
    const dateStr = Number.isNaN(when.getTime())
      ? m.date_time
      : when.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    const notesHtml =
      m.notes && m.notes.trim()
        ? `<p><strong>Notes</strong> ${escapeHtml(m.notes.trim())}</p>`
        : '';
    metaDisplay.innerHTML = `
      <p><strong>Date and time</strong> ${escapeHtml(dateStr)}</p>
      <p><strong>Location</strong> ${escapeHtml(m.location)}</p>
      ${notesHtml}
    `;
    metaDisplay.style.display = 'block';
  };

  img.onload = () => showImg();
  img.onerror = () => {
    showEmpty();
    metaDisplay.style.display = 'none';
  };
  img.src = `/api/image?t=${bust}`;

  fetch(`/api/meta?t=${bust}`)
    .then(async (r) => {
      if (!r.ok) {
        metaDisplay.style.display = 'none';
        return;
      }
      const data = (await r.json()) as PhotoMeta;
      if (data && typeof data.date_time === 'string' && typeof data.location === 'string') {
        showMeta(data);
      }
    })
    .catch(() => {
      metaDisplay.style.display = 'none';
    });
}

type SubmissionItem = {
  id: string;
  capturedAt: string;
  createdAt: string;
  location: string;
  notes: string;
  imageUrl: string;
};

function renderBrowse(root: HTMLDivElement) {
  root.innerHTML = `
    <header>
      <h1>Browse</h1>
      <nav><a href="#/capture">Capture</a> · <a href="#/view">View last</a> · <a href="#/admin">Locations</a></nav>
    </header>
    <p class="browse-hint">Provide a <strong>location</strong> and/or a calendar day in <strong>UTC</strong> (same rules as <code>GET /api/submissions</code>).</p>
    <div class="browse-filters">
      <label>
        Location (optional if day is set)
        <select id="browseLocation" disabled>
          <option value="">Loading…</option>
        </select>
      </label>
      <label>
        Day (UTC, optional)
        <input type="date" id="browseDate" />
      </label>
      <button type="button" class="btn-primary" id="browseLoad">List submissions</button>
    </div>
    <p class="status" id="browseStatus" aria-live="polite"></p>
    <div class="submission-grid" id="browseGrid"></div>
  `;

  const locSel = root.querySelector<HTMLSelectElement>('#browseLocation')!;
  const dateInp = root.querySelector<HTMLInputElement>('#browseDate')!;
  const loadBtn = root.querySelector<HTMLButtonElement>('#browseLoad')!;
  const statusEl = root.querySelector<HTMLParagraphElement>('#browseStatus')!;
  const grid = root.querySelector<HTMLDivElement>('#browseGrid')!;

  const setStatus = (text: string, kind: '' | 'error' | 'ok' | 'info' = '') => {
    statusEl.textContent = text;
    statusEl.className = `status${kind ? ` ${kind}` : ''}`;
  };

  fetch('/api/locations')
    .then(async (r) => {
      if (!r.ok) throw new Error('Could not load locations');
      const data = (await r.json()) as { locations?: unknown };
      const locs = Array.isArray(data.locations)
        ? data.locations.filter((x): x is string => typeof x === 'string')
        : [];
      locSel.disabled = false;
      locSel.innerHTML =
        '<option value="">Any location</option>' +
        locs.map((loc) => {
          const label = escapeHtml(loc);
          const val = escapeHtmlAttr(loc);
          return `<option value="${val}">${label}</option>`;
        }).join('');
    })
    .catch((e) => {
      locSel.disabled = false;
      locSel.innerHTML = '<option value="">(failed to load locations)</option>';
      setStatus(e instanceof Error ? e.message : 'Could not load locations', 'error');
    });

  const load = async () => {
    const location = locSel.value.trim();
    const day = dateInp.value.trim();
    if (!location && !day) {
      setStatus('Choose a location and/or a UTC day.', 'error');
      return;
    }
    const params = new URLSearchParams({ limit: '50' });
    if (location) params.set('location', location);
    if (day) params.set('date', day);
    loadBtn.disabled = true;
    setStatus('Loading…', 'info');
    grid.innerHTML = '';
    try {
      const res = await fetch(`/api/submissions?${params}`);
      const raw = await res.text();
      let payload: { error?: string; submissions?: SubmissionItem[] };
      try {
        payload = JSON.parse(raw) as { error?: string; submissions?: SubmissionItem[] };
      } catch {
        throw new Error(raw.slice(0, 200));
      }
      if (!res.ok) {
        throw new Error(payload.error || `HTTP ${res.status}`);
      }
      const items = payload.submissions ?? [];
      if (items.length === 0) {
        setStatus('No submissions match.', 'ok');
        return;
      }
      setStatus(`${items.length} submission(s).`, 'ok');
      const bust = Date.now();
      grid.innerHTML = items
        .map((s) => {
          const when = new Date(s.capturedAt);
          const dateStr = Number.isNaN(when.getTime())
            ? s.capturedAt
            : when.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
          const notes =
            s.notes && s.notes.trim()
              ? `<p class="submission-notes">${escapeHtml(s.notes.trim())}</p>`
              : '';
          const imgHref = `${s.imageUrl}${s.imageUrl.includes('?') ? '&' : '?'}_=${bust}`;
          return `
            <article class="submission-card">
              <a href="${escapeHtmlAttr(imgHref)}" target="_blank" rel="noopener noreferrer">
                <img src="${escapeHtmlAttr(imgHref)}" alt="" loading="lazy" width="400" height="300" />
              </a>
              <p class="submission-meta"><strong>${escapeHtml(dateStr)}</strong> · ${escapeHtml(s.location)}</p>
              ${notes}
            </article>
          `;
        })
        .join('');
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Request failed', 'error');
    } finally {
      loadBtn.disabled = false;
    }
  };

  loadBtn.addEventListener('click', () => void load());
}

function renderAdmin(root: HTMLDivElement) {
  root.innerHTML = `
    <header>
      <h1>Locations</h1>
      <nav><a href="#/capture">Capture</a> · <a href="#/view">View last</a> · <a href="#/browse">Browse</a></nav>
    </header>
    <p class="admin-note">POC: saving is not authenticated — anyone who can open this URL can change the list.</p>
    <div id="locList" class="loc-list"></div>
    <div class="actions">
      <button type="button" class="btn-secondary" id="addLoc">Add row</button>
      <button type="button" class="btn-primary" id="saveLoc">Save</button>
    </div>
    <p class="status" id="adminStatus" aria-live="polite"></p>
  `;

  const locList = root.querySelector<HTMLDivElement>('#locList')!;
  const saveBtn = root.querySelector<HTMLButtonElement>('#saveLoc')!;
  const statusEl = root.querySelector<HTMLParagraphElement>('#adminStatus')!;

  const setStatus = (text: string, kind: '' | 'error' | 'ok' | 'info' = '') => {
    statusEl.textContent = text;
    statusEl.className = `status${kind ? ` ${kind}` : ''}`;
  };

  function addRow(value = '') {
    const row = document.createElement('div');
    row.className = 'loc-row';
    row.innerHTML = `
      <input type="text" class="loc-input" maxlength="200" value="${escapeHtmlAttr(value)}" placeholder="Location label" />
      <button type="button" class="btn-secondary btn-row-remove" aria-label="Remove row">Remove</button>
    `;
    const rm = row.querySelector<HTMLButtonElement>('.btn-row-remove')!;
    rm.addEventListener('click', () => {
      row.remove();
      if (!locList.querySelector('.loc-row')) {
        addRow('');
      }
    });
    locList.appendChild(row);
  }

  root.querySelector<HTMLButtonElement>('#addLoc')!.addEventListener('click', () => addRow(''));

  saveBtn.addEventListener('click', async () => {
    const inputs = [...root.querySelectorAll<HTMLInputElement>('.loc-input')];
    const locations = inputs.map((i) => i.value.trim()).filter(Boolean);
    if (locations.length === 0) {
      setStatus('Add at least one non-empty location.', 'error');
      return;
    }
    saveBtn.disabled = true;
    setStatus('Saving…', 'info');
    try {
      const res = await fetch('/api/locations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locations }),
      });
      const raw = await res.text();
      let serverError: string | undefined;
      try {
        serverError = (JSON.parse(raw) as { error?: string }).error;
      } catch {
        serverError = raw ? raw.slice(0, 300) : undefined;
      }
      if (!res.ok) {
        throw new Error(serverError || `Save failed (${res.status})`);
      }
      setStatus('Saved.', 'ok');
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Save failed', 'error');
    } finally {
      saveBtn.disabled = false;
    }
  });

  fetch('/api/locations')
    .then(async (r) => {
      if (!r.ok) throw new Error('Could not load locations');
      const data = (await r.json()) as { locations?: unknown };
      const locs = Array.isArray(data.locations)
        ? data.locations.filter((x): x is string => typeof x === 'string')
        : [];
      locList.innerHTML = '';
      if (locs.length === 0) addRow('');
      else locs.forEach((l) => addRow(l));
    })
    .catch((e) => {
      setStatus(e instanceof Error ? e.message : 'Could not load locations', 'error');
      locList.innerHTML = '';
      addRow('');
    });
}

function escapeHtmlAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function render() {
  const route = currentRoute();
  document.documentElement.dataset.route = route;
  if (route !== 'capture') {
    stopCaptureStream();
  }
  const root = app;
  if (route === 'view') {
    renderView(root);
  } else if (route === 'browse') {
    renderBrowse(root);
  } else if (route === 'admin') {
    renderAdmin(root);
  } else {
    renderCapture(root);
  }
}

window.addEventListener('hashchange', render);
render();
