const $ = id => document.getElementById(id);

const url = $("url");
const paste = $("paste");
const type = $("type");
const quality = $("quality");
const qualityWrap = $("quality-wrap");
const fileName = $("file-name");
const folder = $("folder");
const browse = $("browse");
const download = $("download");
const pause = $("pause");
const cancel = $("cancel");
const progress = $("progress");
const track = $("track");
const status = $("status");
const error = $("error");
const preview = $("preview");
const thumbnail = $("thumbnail");
const videoTitle = $("video-title");
const videoUploader = $("video-uploader");
const historyBox = $("history");
const clearHistory = $("clear-history");

const LAST_FOLDER_KEY = "ttr.lastFolder";

let busy = false;
let paused = false;
let infoTimer = null;
let infoToken = 0;        // ignores out-of-date info responses
let lastInfoUrl = "";     // avoids reading the same URL several times
let currentTitle = "";    // title of the video currently previewed
let autoName = "";        // last file name that WE filled in (not typed by the user)

// ---------- UI state ----------

function setState(state) {
  track.dataset.state = state; // idle | working | paused | done | error
}

function setProgress(value) {
  const raw = Number(value);
  const safe = Math.max(0, Math.min(100, Number.isFinite(raw) ? raw : 0));
  const percent = safe > 0 ? Math.min(100, Math.max(1, Math.round(safe))) : 0;
  progress.style.width = `${percent}%`;
  progress.setAttribute("aria-valuenow", String(percent));
  progress.textContent = percent ? `${percent}%` : "";
}

function setBusy(value) {
  busy = value;
  download.disabled = value;
  cancel.disabled = !value;
  pause.disabled = !value;
  paste.disabled = value;
  browse.disabled = value;
  type.disabled = value;
  quality.disabled = value;
  fileName.disabled = value;
  url.disabled = value;
  if (!value) paused = false;
  pause.textContent = paused ? "Resume" : "Pause";
  if (value) setState(paused ? "paused" : "working");
}

function setStatus(text, working = false) {
  status.textContent = text;
  status.classList.toggle("working", working);
}

function showError(message) {
  error.textContent = message || "";
  if (message && !busy) setState("error");
}

// ---------- Video info / preview ----------

function loadThumbnail(list) {
  const queue = [...list];
  const tryNext = () => {
    const next = queue.shift();
    if (next) {
      thumbnail.src = next;
    } else {
      thumbnail.onerror = null;
      thumbnail.src = "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="100%" height="100%" fill="#e9e9e9"/><text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" fill="#777" font-family="Segoe UI,Arial" font-size="22">Thumbnail unavailable</text></svg>'
      );
    }
  };
  thumbnail.onerror = tryNext;
  tryNext();
}

function showPreview(data) {
  if (!data || !data.thumbnails || !data.thumbnails.length) {
    preview.hidden = true;
    return;
  }
  loadThumbnail(data.thumbnails);
  videoTitle.textContent = data.title || "";
  videoUploader.textContent = data.uploader || "";
  // Re-trigger the fade-in animation.
  preview.hidden = false;
  preview.classList.remove("show");
  void preview.offsetWidth;
  preview.classList.add("show");
}

async function loadInfo() {
  const value = url.value.trim();
  if (!value || busy || value === lastInfoUrl) return;

  lastInfoUrl = value;
  const token = ++infoToken;
  setStatus("Reading video information...", true);
  try {
    const info = await window.downloader.getInfo(value);
    if (token !== infoToken) return; // a newer URL replaced this one
    currentTitle = info.title || "";
    showPreview(info);
    // Fill the name automatically, but never overwrite something the user typed.
    if (info.title && (!fileName.value.trim() || fileName.value === autoName)) {
      fileName.value = info.title;
      autoName = info.title;
    }
    setStatus("Ready.");
  } catch {
    if (token !== infoToken) return;
    lastInfoUrl = "";
    currentTitle = "";
    preview.hidden = true;
    setStatus("Ready.");
  }
}

function scheduleInfo(delay) {
  clearTimeout(infoTimer);
  infoTimer = setTimeout(loadInfo, delay);
}

paste.onclick = async () => {
  const text = await window.downloader.paste();
  if (text) {
    url.value = text.trim();
    scheduleInfo(0);
  }
};

browse.onclick = async () => {
  const selected = await window.downloader.chooseFolder();
  if (selected) {
    folder.value = selected;
    try { localStorage.setItem(LAST_FOLDER_KEY, selected); } catch {}
    if (!busy) setStatus("Ready.");
  }
};

type.onchange = () => {
  // "" restores the stylesheet value; "block" used to break the row layout.
  qualityWrap.style.display = type.value === "MP3 Audio" ? "none" : "";
};

url.addEventListener("blur", () => scheduleInfo(0));
url.addEventListener("input", () => {
  const value = url.value.trim();
  if (!value) {
    lastInfoUrl = "";
    preview.hidden = true;
    return;
  }
  if (/^https?:\/\//i.test(value)) scheduleInfo(700);
});
url.addEventListener("keydown", e => {
  if (e.key === "Enter") download.click();
});

// ---------- Download controls ----------

download.onclick = async () => {
  if (busy) return;
  showError("");
  setState("idle");
  setProgress(0);
  if (!url.value.trim()) return showError("Please enter a video URL.");
  if (!folder.value.trim()) return showError("Please choose a save folder.");

  paused = false;
  setBusy(true);
  setStatus("Preparing download...", true);
  try {
    const result = await window.downloader.start({
      url: url.value.trim(),
      type: type.value,
      quality: quality.value,
      fileName: fileName.value.trim(),
      title: currentTitle,
      folder: folder.value
    });
    setBusy(false);
    if (result && result.ok) {
      setState("done");
    } else if (result && result.cancelled) {
      setState("idle");
      setProgress(0);
    } else {
      showError((result && result.error) || "Download failed.");
      setStatus("Download failed.");
    }
  } catch (e) {
    setBusy(false);
    showError("Unexpected error: " + ((e && e.message) || e));
  }
};

pause.onclick = async () => {
  if (!busy) return;
  pause.disabled = true; // pausing takes a moment on Windows
  if (paused) await window.downloader.resume(); else await window.downloader.pause();
  pause.disabled = !busy;
};

cancel.onclick = async () => {
  await window.downloader.cancel();
};

// ---------- History ----------

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", "\"": "&quot;" }[c]));
}

function renderHistory(items) {
  historyBox.innerHTML = "";
  if (!items.length) {
    historyBox.innerHTML = '<div class="empty-history">No completed downloads yet.</div>';
    return;
  }
  items.forEach((item, index) => {
    const row = document.createElement("div");
    row.className = "history-item";
    row.style.animationDelay = `${Math.min(index, 8) * 30}ms`;
    const date = item.completedAt ? new Date(item.completedAt).toLocaleString() : "";
    const meta = [item.type, item.quality, date].filter(Boolean).join(" • ");
    row.innerHTML = `
      <div class="history-main">
        <strong title="${escapeHtml(item.fileName || "")}">${escapeHtml(item.fileName || "Download")}</strong>
        <span>${escapeHtml(meta)}</span>
        <small>${escapeHtml(item.url || "")}</small>
      </div>
      <div class="history-actions">
        <button class="reuse" data-url="${escapeHtml(item.url || "")}">Use URL</button>
        <button class="open-folder" data-folder="${escapeHtml(item.folder || "")}">Folder</button>
      </div>`;
    historyBox.appendChild(row);
  });
}

// One delegated listener instead of re-binding buttons on every render.
historyBox.addEventListener("click", async e => {
  const btn = e.target.closest("button");
  if (!btn) return;
  if (btn.classList.contains("reuse") && !busy) {
    url.value = btn.dataset.url;
    lastInfoUrl = "";
    fileName.value = "";
    autoName = "";
    scheduleInfo(0);
    window.scrollTo({ top: 0, behavior: "smooth" });
  } else if (btn.classList.contains("open-folder")) {
    const ok = await window.downloader.openFolder(btn.dataset.folder);
    if (!ok) {
      showError("That folder no longer exists.");
      setState("idle");
    }
  }
});

clearHistory.onclick = async () => {
  await window.downloader.clearHistory();
};

// ---------- Events from the main process ----------

window.downloader.onProgress(value => setProgress(value));
window.downloader.onStatus(message => {
  const finished = message === "Download completed." || message === "Download cancelled." || message === "Download failed.";
  setStatus(message, !finished && !/paused/i.test(message));
});
window.downloader.onError(message => showError(message)); // does NOT unlock the UI: the download may still be running
window.downloader.onPaused(value => {
  paused = Boolean(value);
  pause.textContent = paused ? "Resume" : "Pause";
  if (busy) setState(paused ? "paused" : "working");
  status.classList.toggle("working", busy && !paused);
});
window.downloader.onHistory(renderHistory);

// ---------- Startup ----------

window.downloader.getHistory().then(renderHistory);

(async () => {
  let saved = "";
  try { saved = localStorage.getItem(LAST_FOLDER_KEY) || ""; } catch {}
  if (saved && await window.downloader.folderExists(saved)) {
    folder.value = saved;
    setStatus("Ready.");
  } else {
    setStatus("Ready. Choose a save folder to begin.");
  }
})();
