const LATENCY_TARGET_MS = 5000;
const CONCURRENCY = 3;

const sampleFiles = [
  "pass-distilled-spirits.png",
  "fail-warning-case.png",
  "fail-abv-mismatch.png",
  "fail-missing-net-contents.png",
  "fail-brand-mismatch.png"
];

const els = {
  sharedText: document.querySelector("#sharedText"),
  fileInput: document.querySelector("#fileInput"),
  pickFilesButton: document.querySelector("#pickFilesButton"),
  dropZone: document.querySelector("#dropZone"),
  loadSamplesButton: document.querySelector("#loadSamplesButton"),
  verifyButton: document.querySelector("#verifyButton"),
  clearButton: document.querySelector("#clearButton"),
  downloadButton: document.querySelector("#downloadButton"),
  queueList: document.querySelector("#queueList"),
  queueCount: document.querySelector("#queueCount"),
  statusText: document.querySelector("#statusText"),
  statusDetail: document.querySelector("#statusDetail"),
  resultsBody: document.querySelector("#resultsBody"),
  detailPanel: document.querySelector("#detailPanel"),
  processedMetric: document.querySelector("#processedMetric"),
  medianMetric: document.querySelector("#medianMetric"),
  hitRateMetric: document.querySelector("#hitRateMetric"),
  averageMetric: document.querySelector("#averageMetric"),
  p95Metric: document.querySelector("#p95Metric"),
  passRateMetric: document.querySelector("#passRateMetric")
};

const state = {
  items: [],
  running: false,
  results: []
};

function uid() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function setStatus(text, detail = "") {
  els.statusText.textContent = text;
  els.statusDetail.textContent = detail;
}

function formatMs(ms) {
  if (!Number.isFinite(ms)) {
    return "-";
  }
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`;
}

function percentile(values, p) {
  if (!values.length) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
}

function statusClass(status) {
  if (status === "pass") {
    return "pass";
  }
  if (status === "fail") {
    return "fail";
  }
  if (status === "error") {
    return "error";
  }
  if (status === "running" || status === "preparing") {
    return "running";
  }
  return "";
}

function renderQueue() {
  els.queueCount.textContent = `${state.items.length} image${state.items.length === 1 ? "" : "s"}`;
  els.queueList.innerHTML = "";

  for (const item of state.items) {
    const row = document.createElement("article");
    row.className = "queue-item";
    row.innerHTML = `
      <img alt="" src="${item.previewUrl}" />
      <div class="queue-meta">
        <div class="queue-title">
          <span class="file-name" title="${item.file.name}">${item.file.name}</span>
          <span class="status-pill ${statusClass(item.status)}">${item.statusLabel || "Queued"}</span>
        </div>
        <textarea data-item-text="${item.id}" spellcheck="false">${item.applicationText}</textarea>
      </div>
    `;
    els.queueList.append(row);
  }

  for (const textarea of els.queueList.querySelectorAll("[data-item-text]")) {
    textarea.addEventListener("input", (event) => {
      const item = state.items.find((candidate) => candidate.id === event.currentTarget.dataset.itemText);
      if (item) {
        item.applicationText = event.currentTarget.value;
      }
    });
  }

  els.verifyButton.disabled = state.running || state.items.length === 0;
}

function renderMetrics() {
  const completed = state.results.filter((result) => result.ok);
  const timings = completed
    .map((result) => result.timing?.clientMs ?? result.timing?.serverMs)
    .filter((value) => Number.isFinite(value));
  const passes = completed.filter((result) => result.verification?.verdict === "pass").length;
  const targetHits = timings.filter((value) => value <= LATENCY_TARGET_MS).length;
  const average = timings.length ? timings.reduce((sum, value) => sum + value, 0) / timings.length : null;

  els.processedMetric.textContent = String(completed.length);
  els.medianMetric.textContent = formatMs(percentile(timings, 50));
  els.hitRateMetric.textContent = timings.length ? `${Math.round((targetHits / timings.length) * 100)}%` : "-";
  els.averageMetric.textContent = formatMs(average);
  els.p95Metric.textContent = formatMs(percentile(timings, 95));
  els.passRateMetric.textContent = completed.length ? `${Math.round((passes / completed.length) * 100)}%` : "-";
  els.downloadButton.disabled = state.results.length === 0;
}

function renderResults() {
  els.resultsBody.innerHTML = "";

  if (!state.results.length) {
    els.resultsBody.innerHTML = '<tr class="empty-row"><td colspan="4">No results yet</td></tr>';
    renderMetrics();
    return;
  }

  for (const result of state.results) {
    const verdict = result.ok ? result.verification.verdict : "error";
    const failedChecks = result.ok
      ? result.verification.checks.filter((check) => check.status === "fail")
      : [];
    const row = document.createElement("tr");
    row.innerHTML = `
      <td><span class="verdict ${verdict}">${verdict.toUpperCase()}</span></td>
      <td>
        <span class="result-name">${result.fileName}</span>
        <span class="result-sub">${result.ok ? result.model : result.message}</span>
        <button class="detail-button" data-detail="${result.itemId}" type="button">Details</button>
      </td>
      <td>
        <strong>${formatMs(result.timing?.clientMs ?? result.timing?.serverMs)}</strong>
        <span class="result-sub">server ${formatMs(result.timing?.serverMs)} / model ${formatMs(result.timing?.modelMs)}</span>
      </td>
      <td>
        <div class="check-list">
          ${
            result.ok
              ? failedChecks.length
                ? failedChecks.map((check) => `<span class="check-chip fail">${check.label}</span>`).join("")
                : '<span class="check-chip">All checks passed</span>'
              : '<span class="check-chip fail">Analysis error</span>'
          }
        </div>
      </td>
    `;
    els.resultsBody.append(row);
  }

  for (const button of els.resultsBody.querySelectorAll("[data-detail]")) {
    button.addEventListener("click", () => {
      const result = state.results.find((candidate) => candidate.itemId === button.dataset.detail);
      if (result) {
        showDetails(result);
      }
    });
  }

  renderMetrics();
}

function showDetails(result) {
  els.detailPanel.hidden = false;
  const checks = result.ok ? result.verification.checks : [];
  els.detailPanel.innerHTML = `
    <h3>${result.fileName}</h3>
    <div class="detail-grid">
      <div class="detail-box">
        <h4>Checks</h4>
        <pre>${escapeHtml(JSON.stringify(checks, null, 2))}</pre>
      </div>
      <div class="detail-box">
        <h4>Extraction</h4>
        <pre>${escapeHtml(JSON.stringify(result.extraction ?? result.detail ?? result, null, 2))}</pre>
      </div>
    </div>
  `;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not load image."));
    image.src = dataUrl;
  });
}

async function compressImage(file) {
  const original = await fileToDataUrl(file);
  const image = await loadImage(original);
  const maxSide = 1400;
  const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", 0.82);
}

function addFiles(files, applicationText = els.sharedText.value) {
  for (const file of files) {
    if (!file.type.startsWith("image/") && !file.name.toLowerCase().endsWith(".svg")) {
      continue;
    }
    state.items.push({
      id: uid(),
      file,
      previewUrl: URL.createObjectURL(file),
      applicationText,
      status: "queued",
      statusLabel: "Queued"
    });
  }
  renderQueue();
}

async function loadSamples() {
  setStatus("Loading samples");
  const applicationText = await fetch("/test-labels/application-distilled-spirits.txt").then((res) =>
    res.text()
  );
  els.sharedText.value = applicationText.trim();
  const files = [];
  for (const name of sampleFiles) {
    const response = await fetch(`/test-labels/${name}`);
    const blob = await response.blob();
    files.push(new File([blob], name, { type: blob.type || "image/png" }));
  }
  addFiles(files, els.sharedText.value);
  setStatus("Samples loaded", `${files.length} images`);
}

async function analyzeItem(item) {
  item.status = "preparing";
  item.statusLabel = "Preparing";
  renderQueue();

  const started = performance.now();
  const imageDataUrl = await compressImage(item.file);

  item.status = "running";
  item.statusLabel = "Running";
  renderQueue();

  const response = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fileName: item.file.name,
      applicationText: item.applicationText,
      imageDataUrl
    })
  });

  const payload = await response.json();
  const clientMs = performance.now() - started;
  const result = {
    ...payload,
    ok: response.ok && payload.ok,
    itemId: item.id,
    fileName: item.file.name,
    timing: {
      ...(payload.timing ?? {}),
      clientMs,
      targetMs: LATENCY_TARGET_MS,
      meetsTarget: clientMs <= LATENCY_TARGET_MS
    }
  };

  item.status = result.ok ? result.verification.verdict : "error";
  item.statusLabel = result.ok ? result.verification.verdict.toUpperCase() : "Error";
  state.results.push(result);
  renderQueue();
  renderResults();
}

async function runWithConcurrency(items, limit, worker) {
  let index = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = items[index];
      index += 1;
      await worker(current);
    }
  });
  await Promise.all(runners);
}

async function verifyBatch() {
  if (state.running || !state.items.length) {
    return;
  }

  state.running = true;
  state.results = [];
  els.detailPanel.hidden = true;
  for (const item of state.items) {
    item.status = "queued";
    item.statusLabel = "Queued";
  }
  renderQueue();
  renderResults();
  setStatus("Running verification", `${Math.min(CONCURRENCY, state.items.length)} concurrent`);

  const batchStarted = performance.now();
  try {
    await runWithConcurrency(state.items, CONCURRENCY, analyzeItem);
    const batchMs = performance.now() - batchStarted;
    const timings = state.results
      .map((result) => result.timing?.clientMs)
      .filter((value) => Number.isFinite(value));
    const targetHits = timings.filter((value) => value <= LATENCY_TARGET_MS).length;
    setStatus(
      "Batch complete",
      `${formatMs(batchMs)} total, ${targetHits}/${timings.length} images within target`
    );
  } finally {
    state.running = false;
    renderQueue();
  }
}

function clearAll() {
  for (const item of state.items) {
    URL.revokeObjectURL(item.previewUrl);
  }
  state.items = [];
  state.results = [];
  els.detailPanel.hidden = true;
  renderQueue();
  renderResults();
  setStatus("Ready");
}

function downloadResults() {
  const blob = new Blob([JSON.stringify(state.results, null, 2)], {
    type: "application/json"
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `ttb-label-results-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

els.pickFilesButton.addEventListener("click", () => els.fileInput.click());
els.fileInput.addEventListener("change", (event) => addFiles(event.target.files));
els.loadSamplesButton.addEventListener("click", loadSamples);
els.verifyButton.addEventListener("click", verifyBatch);
els.clearButton.addEventListener("click", clearAll);
els.downloadButton.addEventListener("click", downloadResults);

for (const eventName of ["dragenter", "dragover"]) {
  els.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    els.dropZone.classList.add("dragging");
  });
}

for (const eventName of ["dragleave", "drop"]) {
  els.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    els.dropZone.classList.remove("dragging");
  });
}

els.dropZone.addEventListener("drop", (event) => {
  addFiles(event.dataTransfer.files);
});

renderQueue();
renderResults();
