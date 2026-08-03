// ---------- IndexedDB setup ----------
const DB_NAME = 'ledger-db';
const STORE_NAME = 'entries';
let db;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const database = req.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function addEntry(entry) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).add(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function deleteEntry(id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function getAllEntries() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve(req.result.sort((a, b) => b.createdAt - a.createdAt));
    req.onerror = () => reject(req.error);
  });
}

// ---------- State ----------
let pendingFiles = []; // { file, kind: 'photo'|'video'|'audio' }
let mediaRecorder = null;
let recordedChunks = [];

// ---------- DOM refs ----------
const textInput = document.getElementById('text-input');
const saveBtn = document.getElementById('save-btn');
const pendingMediaEl = document.getElementById('pending-media');
const timelineEl = document.getElementById('timeline');
const fileInput = document.getElementById('file-input');
const micBtn = document.getElementById('mic-btn');
const storageNote = document.getElementById('storage-note');

// ---------- Helpers ----------
function kindFromMime(mime) {
  if (mime.startsWith('image/')) return 'photo';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'file';
}

function renderPendingChips() {
  pendingMediaEl.innerHTML = '';
  pendingFiles.forEach((item, i) => {
    const chip = document.createElement('div');
    chip.className = 'pending-chip';
    chip.innerHTML = `<span>${item.kind} · ${(item.file.size / 1024).toFixed(0)}kb</span>`;
    const btn = document.createElement('button');
    btn.textContent = '✕';
    btn.onclick = () => { pendingFiles.splice(i, 1); renderPendingChips(); updateSaveState(); };
    chip.appendChild(btn);
    pendingMediaEl.appendChild(chip);
  });
}

function updateSaveState() {
  saveBtn.disabled = textInput.value.trim().length === 0 && pendingFiles.length === 0;
}

function formatTimestamp(ts) {
  const d = new Date(ts);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// ---------- Upload flow ----------
fileInput.addEventListener('change', () => {
  Array.from(fileInput.files).forEach((file) => {
    pendingFiles.push({ file, kind: kindFromMime(file.type) });
  });
  fileInput.value = '';
  renderPendingChips();
  updateSaveState();
});

textInput.addEventListener('input', updateSaveState);

// ---------- Mic capture ----------
micBtn.addEventListener('click', async () => {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recordedChunks = [];
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.ondataavailable = (e) => recordedChunks.push(e.data);
    mediaRecorder.onstop = () => {
      const blob = new Blob(recordedChunks, { type: 'audio/webm' });
      const file = new File([blob], `voice-note-${Date.now()}.webm`, { type: 'audio/webm' });
      pendingFiles.push({ file, kind: 'audio' });
      renderPendingChips();
      updateSaveState();
      stream.getTracks().forEach((t) => t.stop());
      micBtn.classList.remove('recording');
    };
    mediaRecorder.start();
    micBtn.classList.add('recording');
  } catch (err) {
    alert('Could not access microphone: ' + err.message);
  }
});

// ---------- Save entry ----------
saveBtn.addEventListener('click', async () => {
  const text = textInput.value.trim();
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const createdAt = Date.now();

  if (text) {
    await addEntry({ id: id + '-text', type: 'text', content: text, createdAt, synced: false });
  }
  for (const item of pendingFiles) {
    const entryId = `${id}-${item.kind}-${Math.random().toString(36).slice(2, 6)}`;
    await addEntry({
      id: entryId,
      type: item.kind,
      blob: item.file,
      mimeType: item.file.type,
      createdAt: createdAt,
      synced: false
    });
  }

  textInput.value = '';
  pendingFiles = [];
  renderPendingChips();
  updateSaveState();
  await renderTimeline();
});

// ---------- Delete entry ----------
async function handleDelete(id) {
  await deleteEntry(id);
  await renderTimeline();
}

// ---------- Render timeline ----------
async function renderTimeline() {
  const entries = await getAllEntries();
  timelineEl.innerHTML = '';

  if (entries.length === 0) {
    timelineEl.innerHTML = '<div class="empty-state">Nothing logged yet. Write something, or attach a photo, clip, or voice note above.</div>';
    updateStorageEstimate();
    return;
  }

  entries.forEach((entry) => {
    const el = document.createElement('div');
    el.className = 'entry';

    const tag = document.createElement('div');
    tag.className = 'entry-tag';
    tag.innerHTML = `<span class="dot"></span><span>${entry.type}</span><span>${formatTimestamp(entry.createdAt)}</span>`;

    const body = document.createElement('div');
    body.className = 'entry-body';

    if (entry.type === 'text') {
      const p = document.createElement('p');
      p.textContent = entry.content;
      body.appendChild(p);
    } else {
      const url = URL.createObjectURL(entry.blob);
      let media;
      if (entry.type === 'photo') {
        media = document.createElement('img');
        media.src = url;
      } else if (entry.type === 'video') {
        media = document.createElement('video');
        media.src = url;
        media.controls = true;
      } else if (entry.type === 'audio') {
        media = document.createElement('audio');
        media.src = url;
        media.controls = true;
      }
      if (media) body.appendChild(media);
    }

    const footer = document.createElement('div');
    footer.className = 'entry-footer';
    const status = document.createElement('span');
    status.className = 'sync-status';
    status.textContent = entry.synced ? 'synced' : 'stored on this device';
    const del = document.createElement('button');
    del.className = 'delete-link';
    del.textContent = 'delete';
    del.onclick = () => handleDelete(entry.id);
    footer.appendChild(status);
    footer.appendChild(del);
    body.appendChild(footer);

    el.appendChild(tag);
    el.appendChild(body);
    timelineEl.appendChild(el);
  });

  updateStorageEstimate();
}

async function updateStorageEstimate() {
  if (navigator.storage && navigator.storage.estimate) {
    const { usage, quota } = await navigator.storage.estimate();
    const usedMB = (usage / (1024 * 1024)).toFixed(1);
    const quotaMB = (quota / (1024 * 1024 * 1024)).toFixed(1);
    storageNote.textContent = `${usedMB} MB used on this device · ~${quotaMB} GB available`;
  }
}

// ---------- Init ----------
(async function init() {
  db = await openDB();
  updateSaveState();
  await renderTimeline();
})();
