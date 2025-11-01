const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("path");
const { spawn } = require("child_process");
const fs = require("fs");
const ffmpegPath = path.join( "ffmpeg", "ffmpeg.exe");
const ffprobePath = path.join( "ffmpeg", "ffprobe.exe");

let mainWindow;
const activeProcesses = new Map(); // Track running FFmpeg jobs

app.on("ready", () => {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 1000,
    resizable: true,
    icon: path.join(__dirname, "icon.png"),
    title: "ვიდეო კომპრესორი",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.removeMenu();
  mainWindow.loadFile("index.html");
});

// ----------------------------
// Native file dialog
// ----------------------------
ipcMain.handle("open-file-dialog", async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile"],
    filters: [{ name: "Videos", extensions: ["mp4", "mov", "mkv", "avi", "webm"] }],
  });
  if (canceled) return null;
  return filePaths[0];
});

// ----------------------------
// Auto-increment filename
// ----------------------------
function getAvailableFilename(filePath) {
  const dir = path.dirname(filePath);
  const ext = path.extname(filePath);
  const base = path.basename(filePath, ext);
  let counter = 1;
  let newPath = path.join(dir, base + ext);
  while (fs.existsSync(newPath)) {
    newPath = path.join(dir, `${base} (${counter})${ext}`);
    counter++;
  }
  return newPath;
}

// ----------------------------
// Detect NVENC/AMF hardware encoders
// ----------------------------
function detectHardwareEncoders() {
  try {
    const result = require("child_process").spawnSync(ffmpegPath, ["-encoders"]);
    const output = result.stdout.toString() + result.stderr.toString();
    return {
      nvenc: {
        h264: output.includes("h264_nvenc") ? "h264_nvenc" : null,
        hevc: output.includes("hevc_nvenc") ? "hevc_nvenc" : null,
      },
      amf: {
        h264: output.includes("h264_amf") ? "h264_amf" : null,
        hevc: output.includes("hevc_amf") ? "hevc_amf" : null,
      },
    };
  } catch {
    return {};
  }
}

// ----------------------------
// Video compression
// ----------------------------
ipcMain.on("compress-video", async (event, options) => {
  const {
    filePath, gpuType, videoEncoder, method,
    crf, bitrate, preset, resolution,
    framerate, audioBitrate,
  } = options;

  if (!filePath || !fs.existsSync(filePath)) {
    return event.reply("compression-error", "Invalid file path.");
  }

  let outputPath = getAvailableFilename(path.join(
    path.dirname(filePath),
    `compressed_${path.basename(filePath)}`
  ));

  const hardware = detectHardwareEncoders();

  let encoder = videoEncoder;
  if (gpuType === "nvidia") {
    if (videoEncoder === "libx264") encoder = hardware.nvenc.h264 || "libx264";
    else if (videoEncoder === "libx265") encoder = hardware.nvenc.hevc || "libx265";
  } else if (gpuType === "amd") {
    if (videoEncoder === "libx264") encoder = hardware.amf.h264 || "libx264";
    else if (videoEncoder === "libx265") encoder = hardware.amf.hevc || "libx265";
  }

  const ffmpegArgs = ["-i", filePath, "-c:v", encoder];
  const isHardware = encoder.includes("nvenc") || encoder.includes("amf");

  const safeCRF = crf || 23;
  const safeBitrate = bitrate || 1000;

  if (isHardware) {
    const hwPresets = ["default","slow","medium","fast","hp","hq","bd","ll","llhq","llhp","lossless"];
    ffmpegArgs.push("-preset", hwPresets.includes(preset) ? preset : "default");
    if (method === "CRF") ffmpegArgs.push("-cq", safeCRF);
    else
      ffmpegArgs.push("-b:v", `${safeBitrate}k`, "-maxrate", `${Math.floor(safeBitrate * 1.1)}k`, "-bufsize", `${safeBitrate*2}k`);
  } else {
    if (method === "CRF") ffmpegArgs.push("-crf", safeCRF);
    else ffmpegArgs.push("-b:v", `${safeBitrate}k`);
    if (preset) ffmpegArgs.push("-preset", preset);
  }

  if (resolution && resolution !== "source") ffmpegArgs.push("-vf", `scale=${resolution}`);
  if (framerate && framerate !== "source") ffmpegArgs.push("-r", framerate);
  ffmpegArgs.push("-c:a", "aac", "-b:a", audioBitrate || "128k");
  ffmpegArgs.push("-movflags", "+faststart", outputPath);

  console.log("FFMPEG CMD:", [ffmpegPath, ...ffmpegArgs].join(" "));

  // Get duration using ffprobe-static
  let duration = 0;
  try {
    const durResult = require("child_process").spawnSync(ffprobePath, [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      filePath
    ]);
    duration = parseFloat(durResult.stdout.toString());
  } catch {}

  const startTime = Date.now();
  const ffmpeg = spawn(ffmpegPath, ffmpegArgs);
  activeProcesses.set(filePath, { process: ffmpeg, outputPath });

  ffmpeg.on("error", (err) => {
    console.error("FFmpeg failed to start:", err);
    event.reply("compression-error", "FFmpeg failed to start: " + err.message);
  });

  ffmpeg.stderr.on("data", (data) => {
    const msg = data.toString();
    const match = msg.match(/time=(\d+):(\d+):(\d+\.\d+)/);
    if (match && duration) {
      const hours = parseInt(match[1]);
      const minutes = parseInt(match[2]);
      const seconds = parseFloat(match[3]);
      const currentTime = hours*3600 + minutes*60 + seconds;
      let percent = Math.floor((currentTime / duration) * 100);
      if (percent > 100) percent = 100;

      const elapsed = (Date.now() - startTime)/1000;
      const estimatedTotal = (elapsed / currentTime) * duration;
      const remaining = Math.max(0, estimatedTotal - elapsed);

      let currentSize = 0;
      try { if (fs.existsSync(outputPath)) currentSize = fs.statSync(outputPath).size; } catch {}

      event.reply("compression-progress", { percent, remainingTime: remaining, currentSize });
    }
  });

  ffmpeg.on("close", (code) => {
    activeProcesses.delete(filePath);
    if (code === 0) {
      let finalSize = 0;
      try { finalSize = fs.statSync(outputPath).size; } catch {}
      event.reply("compression-complete", { path: outputPath, size: finalSize });
    } else if (code === null) {
      try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch {}
      event.reply("compression-canceled");
    } else {
      event.reply("compression-error", "FFmpeg exited with code " + code);
    }
  });
});

// ----------------------------
// Cancel compression
// ----------------------------
ipcMain.on("cancel-compression", (event, filePath) => {
  const job = activeProcesses.get(filePath);
  if (job && job.process) {
    job.process.kill("SIGKILL");
    try { if (fs.existsSync(job.outputPath)) fs.unlinkSync(job.outputPath); } catch {}
    activeProcesses.delete(filePath);
    event.reply("compression-canceled");
  } else {
    event.reply("compression-error", "No active compression found.");
  }
});

ipcMain.handle("show-item-in-folder", (_, filePath) => {
  shell.showItemInFolder(filePath);
});
