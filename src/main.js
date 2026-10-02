const { app, BrowserWindow, ipcMain, dialog, clipboard, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn, spawnSync, execFile } = require("child_process");

let mainWindow;
let activeProcess = null;
let paused = false;
let currentDownload = null;
let cancelRequested = false;

const HISTORY_LIMIT = 30;
const DEFAULT_TEMPLATE = "%(title)s [%(id)s]";

// ---------- Window ----------

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 740,
    minWidth: 760,
    minHeight: 600,
    backgroundColor: "#f4f4f4",
    title: "TTR Video Downloader",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, "index.html"));

  // Never let the UI navigate away or open new windows inside the app.
  mainWindow.webContents.on("will-navigate", e => e.preventDefault());
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
}

// Only allow one instance (two instances would fight over the history file).
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// ---------- History ----------

function historyFile() {
  return path.join(app.getPath("userData"), "download-history.json");
}

function readHistory() {
  try {
    const data = JSON.parse(fs.readFileSync(historyFile(), "utf8"));
    return Array.isArray(data) ? data.slice(0, HISTORY_LIMIT) : [];
  } catch {
    return [];
  }
}

function writeHistory(items) {
  fs.mkdirSync(app.getPath("userData"), { recursive: true });
  fs.writeFileSync(historyFile(), JSON.stringify(items.slice(0, HISTORY_LIMIT), null, 2), "utf8");
}

function addHistory(item) {
  const items = readHistory();
  items.unshift(item);
  writeHistory(items);
  sendToRenderer("history-updated", items.slice(0, HISTORY_LIMIT));
}

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

app.whenReady().then(() => {
  createWindow();
  ipcMain.handle("clipboard-read", () => clipboard.readText());

  ipcMain.handle("choose-folder", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openDirectory", "createDirectory"]
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle("get-history", () => readHistory());
  ipcMain.handle("clear-history", () => {
    writeHistory([]);
    sendToRenderer("history-updated", []);
    return true;
  });

  ipcMain.handle("open-folder", async (_event, folder) => {
    try {
      if (!folder || !fs.statSync(folder).isDirectory()) return false;
    } catch {
      return false;
    }
    const result = await shell.openPath(folder);
    return !result;
  });

  ipcMain.handle("folder-exists", (_event, folder) => {
    try { return Boolean(folder) && fs.statSync(folder).isDirectory(); } catch { return false; }
  });

  ipcMain.handle("get-video-info", async (_event, url) => getVideoInfo(url));
  ipcMain.handle("start-download", async (_event, options) => startDownload(options));
  ipcMain.handle("pause-download", () => setPaused(true));
  ipcMain.handle("resume-download", () => setPaused(false));
  ipcMain.handle("cancel-download", () => cancelDownload());
});

// ---------- Helpers ----------

// Packaged app: <install>/resources/bin. Dev (`npm start`): <project>/bin.
function binDir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "bin")
    : path.join(__dirname, "..", "bin");
}

function findExecutable(name) {
  const file = process.platform === "win32" ? `${name}.exe` : name;
  const local = path.join(binDir(), file);
  if (fs.existsSync(local)) return local;
  return name; // fall back to PATH
}

function sendStatus(message) { sendToRenderer("download-status", message); }
function sendProgress(value) { sendToRenderer("download-progress", Math.max(0, Math.min(100, value))); }
function sendError(message) { sendToRenderer("download-error", message); }

// Prefer H.264/AAC so the MP4 plays everywhere; cap by height.
function formatArgs(quality) {
  const heights = { "1080p": 1080, "720p": 720, "480p": 480, "360p": 360 };
  const h = heights[quality];
  if (!h) return ["-f", "bv*+ba/b"]; // Best: highest quality, any codec
  return [
    "-f", `bv*[height<=${h}]+ba/b[height<=${h}]/bv*+ba/b`,
    "-S", "res,vcodec:h264,acodec:m4a"
  ];
}

function youtubeId(url) {
  try {
    const u = new URL(url);
    let id = "";
    if (u.hostname.includes("youtu.be")) {
      id = u.pathname.slice(1).split("/")[0];
    } else if (u.hostname.includes("youtube.com")) {
      id = u.searchParams.get("v") || "";
      if (!id && u.pathname.startsWith("/shorts/")) id = u.pathname.split("/")[2] || "";
      if (!id && u.pathname.startsWith("/embed/")) id = u.pathname.split("/")[2] || "";
      if (!id && u.pathname.startsWith("/live/")) id = u.pathname.split("/")[2] || "";
    }
    return /^[\w-]{6,}$/.test(id) ? id : "";
  } catch {
    return "";
  }
}

function validateUrl(value) {
  try {
    const parsed = new URL(String(value || "").trim());
    return ["http:", "https:"].includes(parsed.protocol);
  } catch {
    return false;
  }
}

// Returns a name that is safe on Windows AND safe inside a yt-dlp output template.
function safeFilename(value) {
  const cleaned = String(value || "")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, 150)
    .replace(/[. ]+$/g, "");
  if (!cleaned || /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(cleaned)) return "";
  return cleaned.replace(/%/g, "%%"); // '%' would otherwise be read as a template field
}

function getVideoInfo(url) {
  return new Promise((resolve, reject) => {
    if (!validateUrl(url)) return reject(new Error("Please enter a valid video URL."));
    const ytdlp = findExecutable("yt-dlp");
    execFile(ytdlp, ["--dump-single-json", "--skip-download", "--no-playlist", "--no-warnings", url], {
      windowsHide: true,
      maxBuffer: 20 * 1024 * 1024,
      timeout: 45000
    }, (error, stdout, stderr) => {
      if (error) return reject(new Error((stderr || "").trim() || "Could not read video information."));
      try {
        const data = JSON.parse(stdout);
        const id = youtubeId(data.webpage_url || url);
        // Try several thumbnails in order; the renderer falls through on load errors.
        const thumbnails = [
          id && `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`,
          data.thumbnail,
          id && `https://i.ytimg.com/vi/${id}/mqdefault.jpg`
        ].filter(Boolean);
        resolve({
          title: data.title || "",
          uploader: data.uploader || data.channel || "",
          duration: Number(data.duration) || 0,
          thumbnails,
          webpage_url: data.webpage_url || url
        });
      } catch {
        reject(new Error("Could not read video information."));
      }
    });
  });
}

// ---------- Pause / resume ----------

function runPowerShell(script) {
  return new Promise((resolve, reject) => {
    if (process.platform !== "win32") return reject(new Error("Windows only"));
    const encoded = Buffer.from(script, "utf16le").toString("base64");
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
      { windowsHide: true, timeout: 15000 },
      error => (error ? reject(error) : resolve()));
  });
}

// Windows PowerShell 5.1 has no Suspend-Process, so use ntdll directly and
// walk the whole process tree (yt-dlp.exe -> yt-dlp.exe -> ffmpeg.exe ...).
function windowsSuspendScript(pid, suspend) {
  const fn = suspend ? "NtSuspendProcess" : "NtResumeProcess";
  return `
$ErrorActionPreference = 'Stop'
Add-Type -Namespace TTR -Name Native -MemberDefinition '[DllImport("ntdll.dll")] public static extern int NtSuspendProcess(System.IntPtr h); [DllImport("ntdll.dll")] public static extern int NtResumeProcess(System.IntPtr h);'
$procs = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId
$ids = New-Object System.Collections.Generic.List[int]
$queue = New-Object System.Collections.Generic.Queue[int]
$queue.Enqueue(${Number(pid)})
while ($queue.Count -gt 0) {
  $current = $queue.Dequeue()
  $ids.Add($current)
  foreach ($p in $procs) { if ([int]$p.ParentProcessId -eq $current) { $queue.Enqueue([int]$p.ProcessId) } }
}
$ok = 0
foreach ($id in $ids) {
  try {
    $proc = [System.Diagnostics.Process]::GetProcessById($id)
    [void][TTR.Native]::${fn}($proc.Handle)
    $ok++
  } catch {}
}
if ($ok -eq 0) { throw 'No process could be changed' }
`;
}

async function setPaused(nextPaused) {
  if (!activeProcess) return false;
  if (nextPaused === paused) return true;

  try {
    if (process.platform === "win32") {
      await runPowerShell(windowsSuspendScript(activeProcess.pid, nextPaused));
    } else {
      process.kill(activeProcess.pid, nextPaused ? "SIGSTOP" : "SIGCONT");
    }
    paused = nextPaused;
  } catch {
    sendError("Pause/Resume failed. You can Cancel and Download again; the .part file will be resumed.");
    return false;
  }

  sendStatus(paused ? "Download paused." : "Download resumed.");
  sendToRenderer("download-paused", paused);
  return true;
}

function killTree(proc) {
  if (!proc) return;
  try {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/PID", String(proc.pid), "/T", "/F"], { windowsHide: true });
    } else {
      proc.kill("SIGCONT"); // a stopped process cannot handle SIGTERM
      proc.kill("SIGTERM");
    }
  } catch {}
}

function cancelDownload() {
  if (!activeProcess) return false;
  cancelRequested = true;
  paused = false;
  sendStatus("Cancelling download...");
  sendToRenderer("download-paused", false);
  killTree(activeProcess);
  return true;
}

// ---------- Download ----------

function startDownload(options) {
  return new Promise(resolve => {
    const fail = message => resolve({ ok: false, error: message });

    if (activeProcess) return fail("A download is already running.");

    const url = String(options.url || "").trim();
    const type = options.type === "MP3 Audio" ? "MP3 Audio" : "MP4 Video";
    const quality = options.quality || "720p";
    const folder = String(options.folder || "").trim();
    const customName = safeFilename(options.fileName);

    if (!validateUrl(url)) return fail("Please enter a valid video URL.");
    try {
      if (!folder || !fs.statSync(folder).isDirectory()) throw new Error();
    } catch {
      return fail("Please choose a valid save folder.");
    }

    const ytdlp = findExecutable("yt-dlp");
    const ffmpeg = findExecutable("ffmpeg");
    const output = path.join(folder, `${customName || DEFAULT_TEMPLATE}.%(ext)s`);

    const args = [
      "--newline",
      "--no-playlist",
      "--color", "never",
      "--progress",
      "--progress-template",
      "download:TTRPROG|%(progress._percent_str)s|%(progress._eta_str)s|%(progress._speed_str)s",
      "--continue",
      "--retries", "5",
      "--fragment-retries", "5",
      "--retry-sleep", "http:1"
    ];

    // Only pass an ffmpeg path when we really have a bundled copy
    // (a bare "ffmpeg" would make dirname() return "." and break merging).
    if (path.isAbsolute(ffmpeg)) args.push("--ffmpeg-location", path.dirname(ffmpeg));

    if (type === "MP3 Audio") {
      args.push("-f", "ba/b", "-x", "--audio-format", "mp3", "--audio-quality", "192K");
    } else {
      args.push(...formatArgs(quality), "--merge-output-format", "mp4");
    }

    args.push("-o", output, url);

    sendProgress(0);
    sendStatus("Starting download...");
    paused = false;
    cancelRequested = false;
    currentDownload = {
      url,
      type,
      quality: type === "MP3 Audio" ? "" : quality,
      folder,
      fileName: customName ? customName.replace(/%%/g, "%") : String(options.title || "").trim() || url,
      startedAt: new Date().toISOString()
    };

    const proc = spawn(ytdlp, args, { windowsHide: true, shell: false });
    activeProcess = proc;
    let errors = "";
    let buffer = "";
    let processing = false;

    function handleLine(raw) {
      const line = raw.trim();
      if (!line) return;

      if (line.startsWith("TTRPROG|")) {
        const [, pct, eta, speed] = line.split("|");
        const percent = parseFloat(String(pct || "").replace("%", ""));
        if (Number.isFinite(percent) && !processing) {
          sendProgress(percent);
          if (!paused) {
            const clean = v => { v = (v || "").trim(); return v && !/^(NA|N\/A|Unknown.*)$/i.test(v) ? v : ""; };
            const e = clean(eta), s = clean(speed);
            sendStatus(`Downloading... ${percent.toFixed(1)}%${e ? ` • ETA ${e}` : ""}${s ? ` • ${s}` : ""}`);
          }
        }
        return;
      }

      // After the last byte is downloaded FFmpeg still has to merge / convert.
      if (/^\[(Merger|ExtractAudio|VideoConvertor|FixupM4a|FixupM3u8|FixupStretched|Metadata)\]/.test(line)) {
        processing = true;
        sendProgress(99);
        if (!paused) sendStatus(/^\[ExtractAudio\]/.test(line) ? "Converting to MP3..." : "Merging with FFmpeg...");
        return;
      }

      if (/^ERROR:/i.test(line)) errors += line + "\n";
    }

    function feed(text) {
      buffer += text;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      lines.forEach(handleLine);
    }

    proc.stdout.on("data", chunk => feed(chunk.toString()));
    proc.stderr.on("data", chunk => feed(chunk.toString()));

    proc.on("error", () => {
      activeProcess = null;
      paused = false;
      currentDownload = null;
      sendToRenderer("download-paused", false);
      fail("Could not start yt-dlp. Check that yt-dlp is bundled in the app (bin folder).");
    });

    proc.on("close", code => {
      if (buffer) handleLine(buffer);
      buffer = "";
      activeProcess = null;
      const finished = currentDownload;
      currentDownload = null;
      paused = false;
      sendToRenderer("download-paused", false);

      if (cancelRequested) {
        cancelRequested = false;
        sendProgress(0);
        sendStatus("Download cancelled.");
        resolve({ ok: false, cancelled: true });
      } else if (code === 0) {
        sendProgress(100);
        sendStatus("Download completed.");
        addHistory({ ...finished, completedAt: new Date().toISOString() });
        resolve({ ok: true });
      } else {
        let message = errors.trim().split("\n").slice(-2).join(" ").replace(/^ERROR:\s*/i, "");
        if (/HTTP Error 403|403: Forbidden/i.test(message)) {
          message = "HTTP 403: the site refused the request. yt-dlp is probably out of date. Rebuild the app (or replace bin/yt-dlp.exe with the newest version) and try again.";
        }
        fail(message || "Download failed. Check yt-dlp and FFmpeg.");
      }
    });
  });
}

app.on("before-quit", () => {
  if (activeProcess) killTree(activeProcess);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
