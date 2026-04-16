import './styles.css';

const el = document.getElementById('app');
if (!el || !(el instanceof HTMLDivElement)) {
  throw new Error('#app missing');
}
const app = el;

type Route = 'capture' | 'view';

function currentRoute(): Route {
  const h = window.location.hash.replace(/^#\/?/, '') || 'capture';
  return h === 'view' ? 'view' : 'capture';
}

function renderCapture(root: HTMLDivElement) {
  let objectUrl: string | null = null;

  const revoke = () => {
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    }
  };

  root.innerHTML = `
    <header>
      <h1>Capture</h1>
      <nav><a href="#/view">View last</a></nav>
    </header>
    <div class="preview-wrap" id="previewBox">
      <span class="preview-placeholder" id="placeholder">No photo yet</span>
    </div>
    <div class="actions">
      <label class="file-trigger">
        <span class="sr-only">Take or choose photo</span>
        <input id="file" type="file" accept="image/*" capture="environment" />
        Take / choose photo
      </label>
      <button type="button" class="btn-secondary" id="retake" disabled>Retake</button>
      <button type="button" class="btn-primary" id="upload" disabled>Upload</button>
    </div>
    <p class="status" id="status" aria-live="polite"></p>
  `;

  const fileInput = root.querySelector<HTMLInputElement>('#file')!;
  const previewBox = root.querySelector<HTMLDivElement>('#previewBox')!;
  const placeholder = root.querySelector<HTMLSpanElement>('#placeholder')!;
  const retakeBtn = root.querySelector<HTMLButtonElement>('#retake')!;
  const uploadBtn = root.querySelector<HTMLButtonElement>('#upload')!;
  const statusEl = root.querySelector<HTMLParagraphElement>('#status')!;

  const setStatus = (text: string, kind: '' | 'error' | 'ok' = '') => {
    statusEl.textContent = text;
    statusEl.className = `status${kind ? ` ${kind}` : ''}`;
  };

  const updatePreview = () => {
    const file = fileInput.files?.[0];
    revoke();
    previewBox.querySelector('img')?.remove();
    if (!file) {
      placeholder.style.display = '';
      retakeBtn.disabled = true;
      uploadBtn.disabled = true;
      return;
    }
    objectUrl = URL.createObjectURL(file);
    const img = document.createElement('img');
    img.src = objectUrl;
    img.alt = 'Preview';
    placeholder.style.display = 'none';
    previewBox.appendChild(img);
    retakeBtn.disabled = false;
    uploadBtn.disabled = false;
  };

  fileInput.addEventListener('change', () => {
    setStatus('');
    updatePreview();
  });

  retakeBtn.addEventListener('click', () => {
    fileInput.value = '';
    setStatus('');
    updatePreview();
  });

  uploadBtn.addEventListener('click', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    uploadBtn.disabled = true;
    setStatus('Uploading…');
    try {
      const body = new FormData();
      body.append('image', file, file.name);
      const res = await fetch('/api/upload', { method: 'POST', body });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(data.error || res.statusText || 'Upload failed');
      }
      setStatus('Uploaded.', 'ok');
      revoke();
      window.location.hash = '#/view';
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Upload failed';
      setStatus(msg, 'error');
      uploadBtn.disabled = false;
    }
  });

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
  const root = app;
  if (route === 'view') {
    renderView(root);
  } else {
    renderCapture(root);
  }
}

window.addEventListener('hashchange', render);
render();
