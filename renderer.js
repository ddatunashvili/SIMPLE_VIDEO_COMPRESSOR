const dropArea = document.getElementById("drop-area");
const fileElem = document.getElementById("fileElem");
const progressContainer = document.getElementById("progress-container");
const progressBar = document.getElementById("progress-bar");
const progressText = document.getElementById("progress-text");
const remainingText = document.getElementById("remaining-text");
const currentSizeText = document.getElementById("current-size-text");
const outputDiv = document.getElementById("output");
const outputLink = document.getElementById("output-link");

// Cancel elements
const cancelContainer = document.getElementById("cancel-container");
const cancelBtn = document.getElementById("cancelBtn");

let currentFilePath = null;

// Options
const videoEncoderSelect = document.getElementById("video-encoder");
const methodSelect = document.getElementById("method");
const crfInput = document.getElementById("crf");
const bitrateInput = document.getElementById("bitrate");
const presetSelect = document.getElementById("preset");
const resolutionSelect = document.getElementById("resolution");
const framerateInput = document.getElementById("framerate");
const audioBitrateSelect = document.getElementById("audio-bitrate");

// ----------------------
// Drag & Drop
// ----------------------
["dragenter", "dragover", "dragleave", "drop"].forEach(eventName => {
  dropArea.addEventListener(eventName, e => e.preventDefault());
});

["dragenter", "dragover"].forEach(eventName => {
  dropArea.classList.add("highlight");
});

["dragleave", "drop"].forEach(eventName => {
  dropArea.classList.remove("highlight");
});

dropArea.addEventListener("drop", e => {
  const file = e.dataTransfer.files[0];
  if (file && file.path) handleFile(file.path);
  else showToast("⚠️ ფაილის მისამართი ვერ მოიძებნა","info");
});

// ----------------------
// Click to open file dialog
// ----------------------
dropArea.addEventListener("click", async () => {
  const filePath = await window.electronAPI.openFileDialog();
  if (filePath) handleFile(filePath);
});

// ----------------------
// Handle file compression
// ----------------------
async function handleFile(filePath) {
  if (!filePath) return;
  currentFilePath = filePath;

  // Reset UI
  progressContainer.classList.remove("hidden");
  cancelContainer.classList.remove("hidden"); // show cancel
  cancelBtn.disabled = false;

  progressBar.value = 0;
  progressText.textContent = "იწყება კომპრესირება...";
  remainingText.textContent = "";
  currentSizeText.textContent = "";
  outputDiv.classList.add("hidden");

  const options = {
    filePath,
    videoEncoder: videoEncoderSelect.value,
    method: methodSelect.value,
    crf: crfInput.value,
    bitrate: bitrateInput.value,
    preset: presetSelect.value,
    resolution: resolutionSelect.value,
    framerate: framerateInput.value || "source",
    audioBitrate: audioBitrateSelect.value,
  };

  window.electronAPI.compressVideo(options);
}

// ----------------------
// Method toggle (CRF vs Bitrate)
// ----------------------
methodSelect.addEventListener("change", () => {
  if (methodSelect.value === "CRF") {
    crfInput.disabled = false;
    bitrateInput.disabled = true;
  } else {
    crfInput.disabled = true;
    bitrateInput.disabled = false;
  }
});

// ----------------------
// IPC Handlers
// ----------------------
window.electronAPI.onProgress(({ percent, remainingTime, currentSize }) => {
  progressBar.value = percent;
  progressText.textContent = `მიმდინარეობს კომპრესირება... ${percent}%`;

  if (remainingTime !== undefined) {
    const minutes = Math.floor(remainingTime / 60);
    const seconds = Math.floor(remainingTime % 60);
    remainingText.textContent = `⏳ დარჩენილი დრო: ${minutes} წუთი და ${seconds} წამი`;
  }

  if (currentSize !== undefined && currentSize > 0) {
    currentSizeText.textContent = `📦 ამჟამინდელი ფაილის ზომა: ${(currentSize / 1024 / 1024).toFixed(2)} MB`;
  }
});

window.electronAPI.onComplete(({ path, size }) => {
  progressContainer.classList.add("hidden");
  cancelContainer.classList.add("hidden"); // hide cancel
  outputDiv.classList.remove("hidden");

  outputLink.textContent = path;
  outputLink.href = `file://${path}`;

  currentSizeText.textContent = `✅ საბოლოო ზომა: ${(size / 1024 / 1024).toFixed(2)} MB`;
  remainingText.textContent = "";
});

window.electronAPI.onError(error => {
  progressContainer.classList.add("hidden");
  cancelContainer.classList.add("hidden"); // hide cancel
  showToast("❌ კომპრესია ვერ მოხდა: " + error, "error");
});

// ----------------------
// Cancel Compression
// ----------------------
cancelBtn.addEventListener("click", () => {
  if (currentFilePath) {
    cancelBtn.disabled = true;
    window.electronAPI.cancelCompression(currentFilePath);
  }
});

window.electronAPI.onCanceled(() => {
  progressContainer.classList.add("hidden");
  cancelContainer.classList.add("hidden");
  outputDiv.classList.add("hidden");
  showToast("❌ კომპრესია გაუქმდა","error");
});


function showToast(message, type = "info", duration = 3000) {
  const container = document.getElementById("toast-container");

  const toast = document.createElement("div");
  toast.classList.add("toast", type);
  toast.textContent = message;

  container.appendChild(toast);

  // Remove after duration
  setTimeout(() => {
    toast.style.animation = "fadeOut 0.5s forwards";
    toast.addEventListener("animationend", () => toast.remove());
  }, duration);
}

const showButton = document.getElementById("show-in-folder");

showButton.addEventListener("click", () => {
  const filePath = outputLink.textContent;
  if (filePath) {
    window.electronAPI.showItemInFolder(filePath);
  }
});