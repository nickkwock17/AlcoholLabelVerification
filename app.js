const LATENCY_TARGET_MS = 5000;
const DEFAULT_CONCURRENCY = 3;
const MAX_CONCURRENCY = 8;
const MAX_BATCH_IMAGES = 300;
const LARGE_BATCH_THRESHOLD = 200;
const QUEUE_RENDER_LIMIT = 80;
const IMAGE_MAX_SIDE = 1200;
const IMAGE_JPEG_QUALITY = 0.78;
const API_REQUEST_TIMEOUT_MS = 30_000;
const GOVERNMENT_WARNING =
  "GOVERNMENT WARNING: (1) According to the Surgeon General, women should not drink alcoholic beverages during pregnancy because of the risk of birth defects. (2) Consumption of alcoholic beverages impairs your ability to drive a car or operate machinery, and may cause health problems.";

const requiredFieldLabels = {
  brandName: "Brand Name",
  classType: "Class/Type",
  alcoholContent: "Alcohol Content",
  netContents: "Net Contents",
  producerName: "Producer/Bottler Name",
  producerAddress: "Producer/Bottler Address"
};

const sampleFiles = [
  "pass-distilled-spirits.png",
  "fail-warning-case.png",
  "fail-abv-mismatch.png",
  "fail-missing-net-contents.png",
  "fail-brand-mismatch.png"
];

const els = {
  fields: {
    brandName: document.querySelector("#brandName"),
    classType: document.querySelector("#classType"),
    alcoholContent: document.querySelector("#alcoholContent"),
    netContents: document.querySelector("#netContents"),
    producerName: document.querySelector("#producerName"),
    producerAddress: document.querySelector("#producerAddress"),
    countryOfOrigin: document.querySelector("#countryOfOrigin"),
    beverageType: document.querySelector("#beverageType"),
    governmentWarning: document.querySelector("#governmentWarning")
  },
  fileInput: document.querySelector("#fileInput"),
  csvInput: document.querySelector("#csvInput"),
  pickFilesButton: document.querySelector("#pickFilesButton"),
  pickCsvButton: document.querySelector("#pickCsvButton"),
  csvFileName: document.querySelector("#csvFileName"),
  csvMatchSummary: document.querySelector("#csvMatchSummary"),
  unmatchedPanel: document.querySelector("#unmatchedPanel"),
  dropZone: document.querySelector("#dropZone"),
  loadSamplesButton: document.querySelector("#loadSamplesButton"),
  verifyButton: document.querySelector("#verifyButton"),
  pauseButton: document.querySelector("#pauseButton"),
  retryButton: document.querySelector("#retryButton"),
  clearButton: document.querySelector("#clearButton"),
  downloadButton: document.querySelector("#downloadButton"),
  concurrencyInput: document.querySelector("#concurrencyInput"),
  concurrencyValue: document.querySelector("#concurrencyValue"),
  progressText: document.querySelector("#progressText"),
  etaText: document.querySelector("#etaText"),
  progressFill: document.querySelector("#progressFill"),
  progressBar: document.querySelector(".progress-bar"),
  queueList: document.querySelector("#queueList"),
  queueRenderSummary: document.querySelector("#queueRenderSummary"),
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
  expectedMatchMetric: document.querySelector("#expectedMatchMetric")
};

const state = {
  items: [],
  running: false,
  paused: false,
  activeWorkers: 0,
  runToken: 0,
  batchStartedAt: 0,
  completedThisRun: 0,
  results: [],
  csvRows: [],
  csvFileName: ""
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

async function fetchJsonWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    const payload = await response.json().catch(() => ({
      ok: false,
      message: "API returned a non-JSON response."
    }));
    return { response, payload };
  } catch (error) {
    if (error?.name === "AbortError") {
      const timeoutError = new Error(
        `Analysis timed out after ${Math.round(timeoutMs / 1000)} seconds. Use Retry failed to run this image again.`
      );
      timeoutError.status = 504;
      timeoutError.timeout = true;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
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
  if (status === "paused") {
    return "paused";
  }
  return "";
}

function expectedVerdictForFileName(fileName) {
  const normalized = String(fileName || "").toLowerCase();
  if (normalized.startsWith("pass-")) {
    return "pass";
  }
  if (normalized.startsWith("fail-")) {
    return "fail";
  }
  return null;
}

function actualVerdict(result) {
  return result.ok ? result.verification?.verdict || "error" : "error";
}

function hasLowConfidence(result) {
  return Boolean(
    result.ok &&
      result.verification?.checks?.some(
        (check) => check.id === "ocrConfidence" && check.status === "fail"
      )
  );
}

function resultStatusLabel(result) {
  if (!result.ok) {
    if (
      result.detail?.timedOut ||
      result.detail?.requestAttempts?.some((attempt) => attempt.timedOut)
    ) {
      return "TIMEOUT";
    }
    return "API ERROR";
  }
  if (hasLowConfidence(result)) {
    return "LOW CONF";
  }
  return actualVerdict(result).toUpperCase();
}

function upsertResult(result) {
  const index = state.results.findIndex((candidate) => candidate.itemId === result.itemId);
  if (index >= 0) {
    state.results[index] = result;
  } else {
    state.results.push(result);
  }

  const itemOrder = new Map(state.items.map((item, itemIndex) => [item.id, itemIndex]));
  state.results.sort((a, b) => (itemOrder.get(a.itemId) ?? 0) - (itemOrder.get(b.itemId) ?? 0));
}

function isDoneStatus(status) {
  return status === "pass" || status === "fail" || status === "error";
}

function fileKey(fileName) {
  return String(fileName || "")
    .split(/[\\/]/)
    .pop()
    .trim()
    .toLowerCase();
}

function normalizeCsvKey(value) {
  return String(value || "")
    .replace(/^\ufeff/, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeExpectedVerdict(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "pass" || normalized === "fail") {
    return normalized;
  }
  return null;
}

function csvValue(row, keys) {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && String(value).trim()) {
      return String(value).trim();
    }
  }
  return "";
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        value += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      row.push(value);
      value = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      row.push(value);
      if (row.some((cell) => String(cell).trim())) {
        rows.push(row);
      }
      row = [];
      value = "";
    } else {
      value += char;
    }
  }

  row.push(value);
  if (row.some((cell) => String(cell).trim())) {
    rows.push(row);
  }

  return rows;
}

function parseApplicationCsv(text) {
  const table = parseCsv(text);
  if (table.length < 2) {
    throw new Error("CSV needs a header row and at least one application row.");
  }

  const headers = table[0].map(normalizeCsvKey);
  if (!headers.some((header) => ["file_name", "filename", "file"].includes(header))) {
    throw new Error("CSV must include a file_name column.");
  }

  return table.slice(1).map((values, index) => {
    const raw = {};
    headers.forEach((header, valueIndex) => {
      raw[header] = String(values[valueIndex] || "").trim();
    });

    const fileName = csvValue(raw, ["file_name", "filename", "file"]);
    if (!fileName) {
      throw new Error(`CSV row ${index + 2} is missing file_name.`);
    }

    const fields = {
      brandName: csvValue(raw, ["brand_name", "brand"]),
      classType: csvValue(raw, ["class_type", "class", "type"]),
      alcoholContent: csvValue(raw, ["alcohol_content", "abv"]),
      netContents: csvValue(raw, ["net_contents", "contents"]),
      producerName: csvValue(raw, ["producer_name", "producer", "bottler_name", "importer_name"]),
      producerAddress: csvValue(raw, ["producer_address", "address", "bottler_address", "importer_address"]),
      countryOfOrigin: csvValue(raw, ["country_of_origin", "origin"]),
      beverageType: csvValue(raw, ["beverage_type", "beverage"]) || "Distilled spirits",
      governmentWarning: csvValue(raw, ["government_warning", "government_health_warning"]) || GOVERNMENT_WARNING
    };

    return {
      id: uid(),
      rowNumber: index + 2,
      fileName,
      fileKey: fileKey(fileName),
      raw,
      fields,
      applicationText: applicationFieldsToText(fields),
      expectedVerdict: normalizeExpectedVerdict(csvValue(raw, ["expected_verdict", "expected"]))
    };
  });
}

function requiredMissing(fields) {
  return Object.entries(requiredFieldLabels)
    .filter(([key]) => !fields[key])
    .map(([, label]) => label);
}

function readApplicationFields() {
  return Object.fromEntries(
    Object.entries(els.fields).map(([key, element]) => [key, element.value.trim()])
  );
}

function setApplicationFields(values) {
  for (const [key, value] of Object.entries(values)) {
    if (els.fields[key]) {
      els.fields[key].value = value ?? "";
    }
  }
}

function applicationFieldsToText(fields) {
  const lines = [
    ["Beverage Type", fields.beverageType],
    ["Brand Name", fields.brandName],
    ["Class/Type", fields.classType],
    ["Alcohol Content", fields.alcoholContent],
    ["Net Contents", fields.netContents],
    ["Producer", fields.producerName],
    ["Address", fields.producerAddress],
    ["Country of Origin", fields.countryOfOrigin],
    ["Government Warning", fields.governmentWarning || GOVERNMENT_WARNING]
  ];

  return lines
    .filter(([, value]) => value)
    .map(([label, value]) => `${label}: ${value}`)
    .join("\n");
}

function parseApplicationText(text) {
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const [rawLabel, ...rest] = line.split(":");
    const value = rest.join(":").trim();
    if (!rawLabel || !value) {
      continue;
    }
    const label = rawLabel.trim().toLowerCase();
    if (label === "brand name" || label === "brand") values.brandName = value;
    if (label === "class/type" || label === "class" || label === "type") values.classType = value;
    if (label === "alcohol content" || label === "abv") values.alcoholContent = value;
    if (label === "net contents" || label === "contents") values.netContents = value;
    if (label === "producer" || label === "bottler" || label === "importer") values.producerName = value;
    if (label === "address" || label === "producer address") values.producerAddress = value;
    if (label === "country of origin" || label === "origin") values.countryOfOrigin = value;
    if (label === "beverage type") values.beverageType = value;
  }
  return values;
}

function validateApplicationFields() {
  const fields = readApplicationFields();
  const missing = Object.entries(requiredFieldLabels).filter(([key]) => !fields[key]);
  if (!missing.length) {
    return { ok: true, fields, applicationText: applicationFieldsToText(fields) };
  }

  const [firstMissingKey] = missing[0];
  els.fields[firstMissingKey].focus();
  setStatus(
    "Application fields incomplete",
    `Missing ${missing.map(([, label]) => label).join(", ")}`
  );
  return { ok: false, fields, applicationText: "" };
}

function queueSummary(fields) {
  const chips = [
    fields.brandName,
    fields.classType,
    fields.alcoholContent,
    fields.netContents
  ].filter(Boolean);
  return chips.length ? chips : ["Application fields pending"];
}

function expectedSummary(item) {
  return item.expectedVerdict ? [`Expected ${item.expectedVerdict.toUpperCase()}`] : [];
}

function csvSummary(item) {
  if (!state.csvRows.length) {
    return [];
  }
  if (item.csvStatus === "matched") {
    return [{ text: "CSV matched", className: "success" }];
  }
  return [{ text: "Missing CSV row", className: "fail" }];
}

function queueChips(item) {
  return [
    ...queueSummary(item.applicationFields).map((text) => ({ text, className: "" })),
    ...expectedSummary(item).map((text) => ({ text, className: "warn" })),
    ...csvSummary(item),
    ...(item.errorMessage ? [{ text: item.errorMessage, className: "fail" }] : [])
  ];
}

function renderChip(chip) {
  return `<span class="summary-chip ${chip.className}">${escapeHtml(chip.text)}</span>`;
}

function renderQueueItem(item) {
  const row = document.createElement("article");
  row.className = "queue-item";
  row.innerHTML = `
    <img alt="" src="${item.previewUrl}" />
    <div class="queue-meta">
      <div class="queue-title">
        <span class="file-name" title="${item.file.name}">${item.file.name}</span>
        <span class="status-pill ${statusClass(item.status)}">${item.statusLabel || "Queued"}</span>
      </div>
      <div class="queue-summary">
        ${queueChips(item).map(renderChip).join("")}
      </div>
    </div>
  `;
  return row;
}

function visibleQueueItems() {
  if (state.items.length <= QUEUE_RENDER_LIMIT) {
    return state.items;
  }

  const selected = new Set();
  const visible = [];
  const add = (item) => {
    if (item && !selected.has(item.id) && visible.length < QUEUE_RENDER_LIMIT) {
      selected.add(item.id);
      visible.push(item);
    }
  };

  for (const item of state.items) {
    if (
      item.status === "running" ||
      item.status === "preparing" ||
      item.status === "error" ||
      item.csvStatus === "missing"
    ) {
      add(item);
    }
  }

  for (const item of state.items) {
    if (isDoneStatus(item.status)) {
      add(item);
    }
  }

  for (const item of state.items) {
    add(item);
  }

  return visible;
}

function renderQueueRenderSummary(visibleCount) {
  const total = state.items.length;
  if (!total) {
    els.queueRenderSummary.textContent = "";
    els.queueRenderSummary.hidden = true;
    return;
  }

  const largeBatchText =
    total >= LARGE_BATCH_THRESHOLD
      ? `Large batch mode: all ${total} images will process with ${currentConcurrency()} concurrent workers.`
      : `Batch ready: ${total} image${total === 1 ? "" : "s"}.`;
  const previewText =
    total > visibleCount
      ? ` Showing ${visibleCount} priority queue cards to keep the browser responsive.`
      : "";

  els.queueRenderSummary.textContent = `${largeBatchText}${previewText}`;
  els.queueRenderSummary.hidden = false;
}

function updateCsvPairing() {
  const rowsByFile = new Map();
  for (const row of state.csvRows) {
    row.matchedCount = 0;
    if (!rowsByFile.has(row.fileKey)) {
      rowsByFile.set(row.fileKey, row);
    }
  }

  for (const item of state.items) {
    const row = rowsByFile.get(fileKey(item.file.name));
    if (state.csvRows.length && row) {
      row.matchedCount += 1;
      item.csvRowId = row.id;
      item.csvStatus = "matched";
      item.applicationFields = row.fields;
      item.applicationText = row.applicationText;
      item.expectedVerdict = row.expectedVerdict || expectedVerdictForFileName(item.file.name);
    } else {
      item.csvRowId = null;
      item.csvStatus = state.csvRows.length ? "missing" : "manual";
      item.expectedVerdict = expectedVerdictForFileName(item.file.name);
    }
  }
}

function listPreview(items) {
  const visible = items.slice(0, 20);
  const extra = items.length - visible.length;
  return [
    ...visible.map((item) => `<li>${escapeHtml(item)}</li>`),
    extra > 0 ? `<li>${extra} more</li>` : ""
  ].join("");
}

function renderCsvSummary() {
  els.csvFileName.textContent = state.csvFileName || "No CSV loaded";

  if (!state.csvRows.length) {
    els.csvMatchSummary.textContent = "CSV matching: no CSV loaded";
    els.unmatchedPanel.hidden = true;
    els.unmatchedPanel.innerHTML = "";
    return;
  }

  const missingImages = state.items
    .filter((item) => item.csvStatus === "missing")
    .map((item) => item.file.name);
  const unmatchedRows = state.csvRows
    .filter((row) => !row.matchedCount)
    .map((row) => `${row.fileName} (row ${row.rowNumber})`);
  const matchedImages = state.items.filter((item) => item.csvStatus === "matched").length;

  els.csvMatchSummary.textContent = `CSV matching: ${state.csvRows.length} rows, ${matchedImages}/${state.items.length} images matched`;
  els.unmatchedPanel.hidden = missingImages.length === 0 && unmatchedRows.length === 0;
  els.unmatchedPanel.innerHTML = `
    ${
      missingImages.length
        ? `<div class="unmatched-list"><h4>Images without CSV rows</h4><ul>${listPreview(missingImages)}</ul></div>`
        : ""
    }
    ${
      unmatchedRows.length
        ? `<div class="unmatched-list"><h4>CSV rows without images</h4><ul>${listPreview(unmatchedRows)}</ul></div>`
        : ""
    }
  `;
}

function renderQueue() {
  els.queueCount.textContent = `${state.items.length} image${state.items.length === 1 ? "" : "s"}`;
  els.queueList.innerHTML = "";
  const visibleItems = visibleQueueItems();

  for (const item of visibleItems) {
    els.queueList.append(renderQueueItem(item));
  }

  renderQueueRenderSummary(visibleItems.length);
  renderCsvSummary();
  renderProgress();
  renderControls();
}

function currentConcurrency() {
  const parsed = Number(els.concurrencyInput.value);
  const value = Math.max(1, Math.min(MAX_CONCURRENCY, Number.isFinite(parsed) ? parsed : DEFAULT_CONCURRENCY));
  els.concurrencyInput.value = String(value);
  return value;
}

function failedItems() {
  return state.items.filter((item) => item.status === "fail" || item.status === "error");
}

function inProgressItems() {
  return state.items.filter((item) => item.status === "queued" || item.status === "preparing" || item.status === "running");
}

function formatEta(ms) {
  if (!Number.isFinite(ms) || ms <= 0) {
    return "ETA -";
  }
  const seconds = Math.ceil(ms / 1000);
  if (seconds < 60) {
    return `ETA ${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `ETA ${minutes}m ${remainingSeconds}s`;
}

function renderProgress() {
  const total = state.items.length;
  const complete = state.items.filter((item) => isDoneStatus(item.status)).length;
  const percent = total ? Math.round((complete / total) * 100) : 0;
  const active = state.activeWorkers;
  const remaining = inProgressItems().length;
  const elapsed = state.batchStartedAt ? performance.now() - state.batchStartedAt : 0;
  const average = state.completedThisRun ? elapsed / state.completedThisRun : null;
  const eta = state.running && average ? average * remaining : null;

  els.progressText.textContent = `${complete}/${total} complete${active ? `, ${active} active` : ""}`;
  els.etaText.textContent = formatEta(eta);
  els.progressFill.style.width = `${percent}%`;
  els.progressBar.setAttribute("aria-valuenow", String(percent));
}

function renderControls() {
  const concurrency = currentConcurrency();
  els.concurrencyValue.textContent = `${concurrency} concurrent`;
  els.verifyButton.disabled = state.running || state.items.length === 0;
  els.pauseButton.disabled = !state.running;
  els.pauseButton.textContent = state.paused ? "Resume" : "Pause";
  els.retryButton.disabled = state.running || failedItems().length === 0;
  els.clearButton.disabled = state.running;
  els.loadSamplesButton.disabled = state.running;
  els.pickFilesButton.disabled = state.running;
  els.pickCsvButton.disabled = state.running;
  els.concurrencyInput.disabled = false;
}

function renderMetrics() {
  const completed = state.results.filter((result) => result.ok);
  const processed = state.results.length;
  const timings = completed
    .map((result) => result.timing?.clientMs ?? result.timing?.serverMs)
    .filter((value) => Number.isFinite(value));
  const expectedResults = state.results.filter((result) => result.expectedVerdict);
  const expectedMatches = expectedResults.filter(
    (result) => actualVerdict(result) === result.expectedVerdict
  ).length;
  const targetHits = timings.filter((value) => value <= LATENCY_TARGET_MS).length;
  const average = timings.length ? timings.reduce((sum, value) => sum + value, 0) / timings.length : null;

  els.processedMetric.textContent = String(processed);
  els.medianMetric.textContent = formatMs(percentile(timings, 50));
  els.hitRateMetric.textContent = timings.length ? `${Math.round((targetHits / timings.length) * 100)}%` : "-";
  els.averageMetric.textContent = formatMs(average);
  els.p95Metric.textContent = formatMs(percentile(timings, 95));
  els.expectedMatchMetric.textContent = expectedResults.length
    ? `${Math.round((expectedMatches / expectedResults.length) * 100)}%`
    : "-";
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
    const verdict = actualVerdict(result);
    const failedChecks = result.ok
      ? result.verification.checks.filter((check) => check.status === "fail")
      : [];
    const expectedMatch =
      result.expectedVerdict && verdict === result.expectedVerdict ? "matches expected" : "";
    const expectedMismatch =
      result.expectedVerdict && verdict !== result.expectedVerdict
        ? `expected ${result.expectedVerdict.toUpperCase()}`
        : "";
    const resultMeta = result.ok
      ? [result.model, result.imageDetail ? `${result.imageDetail} detail` : "", expectedMatch, expectedMismatch]
          .filter(Boolean)
          .join(" | ")
      : [result.message, expectedMismatch].filter(Boolean).join(" | ");
    const row = document.createElement("tr");
    row.innerHTML = `
      <td><span class="verdict ${verdict}">${verdict.toUpperCase()}</span></td>
      <td>
        <span class="result-name">${result.fileName}</span>
        <span class="result-sub">${escapeHtml(resultMeta)}</span>
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
          ${
            result.expectedVerdict
              ? `<span class="check-chip ${verdict === result.expectedVerdict ? "" : "fail"}">${
                  verdict === result.expectedVerdict ? "Expected verdict matched" : "Expected verdict mismatch"
                }</span>`
              : ""
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
  const extraction = result.ok
    ? {
        expectedVerdict: result.expectedVerdict,
        expectedVerdictMatched: result.expectedVerdict ? actualVerdict(result) === result.expectedVerdict : null,
        imageDetail: result.imageDetail,
        attempts: result.attempts,
        ...result.extraction
      }
    : result.detail ?? result;
  els.detailPanel.innerHTML = `
    <h3>${result.fileName}</h3>
    <div class="detail-grid">
      <div class="detail-box">
        <h4>Checks</h4>
        <pre>${escapeHtml(JSON.stringify(checks, null, 2))}</pre>
      </div>
      <div class="detail-box">
        <h4>Extraction</h4>
        <pre>${escapeHtml(JSON.stringify(extraction, null, 2))}</pre>
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
  const scale = Math.min(1, IMAGE_MAX_SIDE / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", IMAGE_JPEG_QUALITY);
}

function setCsvRows(rows, fileName) {
  state.csvRows = rows;
  state.csvFileName = fileName;
  updateCsvPairing();
  renderQueue();
  setStatus("CSV loaded", `${rows.length} application row${rows.length === 1 ? "" : "s"}`);
}

async function handleCsvFile(file) {
  if (!file || state.running) {
    return;
  }

  try {
    const text = await file.text();
    setCsvRows(parseApplicationCsv(text), file.name);
  } catch (error) {
    state.csvRows = [];
    state.csvFileName = "";
    updateCsvPairing();
    renderQueue();
    setStatus("CSV could not be loaded", error.message || "Check the file format.");
  } finally {
    els.csvInput.value = "";
  }
}

function addFiles(files) {
  if (state.running) {
    return;
  }

  const applicationFields = readApplicationFields();
  const applicationText = applicationFieldsToText(applicationFields);
  const imageFiles = Array.from(files).filter(
    (file) => file.type.startsWith("image/") || file.name.toLowerCase().endsWith(".svg")
  );
  const availableSlots = Math.max(0, MAX_BATCH_IMAGES - state.items.length);
  const acceptedFiles = imageFiles.slice(0, availableSlots);
  const skippedForLimit = imageFiles.length - acceptedFiles.length;

  for (const file of acceptedFiles) {
    state.items.push({
      id: uid(),
      file,
      previewUrl: URL.createObjectURL(file),
      applicationFields,
      applicationText,
      status: "queued",
      statusLabel: "Queued",
      csvStatus: state.csvRows.length ? "missing" : "manual",
      expectedVerdict: expectedVerdictForFileName(file.name)
    });
  }
  updateCsvPairing();
  renderQueue();

  if (skippedForLimit > 0) {
    setStatus(
      "Batch limit reached",
      `Queued ${acceptedFiles.length}; skipped ${skippedForLimit} image${skippedForLimit === 1 ? "" : "s"} above the ${MAX_BATCH_IMAGES} image limit`
    );
  } else if (acceptedFiles.length) {
    setStatus(
      state.items.length >= LARGE_BATCH_THRESHOLD ? "Large batch queued" : "Images queued",
      `${state.items.length}/${MAX_BATCH_IMAGES} image capacity used`
    );
  }
}

async function loadSamples() {
  setStatus("Loading samples");
  clearAll();
  const applicationText = await fetch("/test-labels/application-distilled-spirits.txt").then((res) =>
    res.text()
  );
  const csvText = await fetch("/test-labels/applications.csv").then((res) => res.text());
  setApplicationFields({
    beverageType: "Distilled spirits",
    governmentWarning: GOVERNMENT_WARNING,
    ...parseApplicationText(applicationText)
  });
  setCsvRows(parseApplicationCsv(csvText), "applications.csv");
  const files = [];
  for (const name of sampleFiles) {
    const response = await fetch(`/test-labels/${name}`);
    const blob = await response.blob();
    files.push(new File([blob], name, { type: blob.type || "image/png" }));
  }
  addFiles(files);
  setStatus("Samples loaded", `${files.length} images`);
}

async function analyzeItem(item) {
  item.status = "preparing";
  item.statusLabel = "Preparing";
  item.errorMessage = "";
  renderQueue();

  const started = performance.now();
  let result;

  try {
    const imageDataUrl = await compressImage(item.file);

    item.status = "running";
    item.statusLabel = "Running";
    renderQueue();

    const { response, payload } = await fetchJsonWithTimeout("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fileName: item.file.name,
        applicationText: item.applicationText,
        imageDataUrl
      })
    }, API_REQUEST_TIMEOUT_MS);

    const clientMs = performance.now() - started;
    result = {
      ...payload,
      ok: response.ok && payload.ok,
      itemId: item.id,
      fileName: item.file.name,
      expectedVerdict: item.expectedVerdict,
      timing: {
        ...(payload.timing ?? {}),
        clientMs,
        targetMs: LATENCY_TARGET_MS,
        meetsTarget: clientMs <= LATENCY_TARGET_MS
      }
    };
  } catch (error) {
    const clientMs = performance.now() - started;
    result = {
      ok: false,
      itemId: item.id,
      fileName: item.file.name,
      expectedVerdict: item.expectedVerdict,
      message: error.message || "Analysis request failed.",
      detail: {
        error: error.message || String(error),
        status: error.status || null,
        timedOut: error.timeout === true,
        timeoutMs: API_REQUEST_TIMEOUT_MS
      },
      timing: {
        clientMs,
        targetMs: LATENCY_TARGET_MS,
        meetsTarget: false
      }
    };
  }

  result.expectedVerdictMatched = result.expectedVerdict
    ? actualVerdict(result) === result.expectedVerdict
    : null;

  item.status = actualVerdict(result);
  item.statusLabel = resultStatusLabel(result);
  item.result = result;
  item.errorMessage = result.ok ? "" : result.message || "Analysis error";
  upsertResult(result);
  renderQueue();
  renderResults();
}

function validateItemsReady(items) {
  if (!items.length) {
    setStatus("No images queued");
    return false;
  }

  if (state.csvRows.length) {
    const missingCsv = items.filter((item) => item.csvStatus !== "matched");
    if (missingCsv.length) {
      setStatus("CSV pairing incomplete", `${missingCsv.length} image${missingCsv.length === 1 ? "" : "s"} missing CSV rows`);
      renderCsvSummary();
      return false;
    }
  } else {
    const validation = validateApplicationFields();
    if (!validation.ok) {
      return false;
    }
    for (const item of items) {
      item.applicationFields = validation.fields;
      item.applicationText = validation.applicationText;
      item.csvStatus = "manual";
    }
  }

  const missingFields = items
    .map((item) => ({
      item,
      missing: requiredMissing(item.applicationFields)
    }))
    .find((entry) => entry.missing.length);

  if (missingFields) {
    setStatus(
      "Application data incomplete",
      `${missingFields.item.file.name} missing ${missingFields.missing.join(", ")}`
    );
    return false;
  }

  return true;
}

function resetItemsForRun(items, { clearResults }) {
  for (const item of items) {
    item.status = "queued";
    item.statusLabel = clearResults ? "Queued" : "Retry queued";
    item.errorMessage = "";
    if (clearResults) {
      item.result = null;
    }
  }

  if (clearResults) {
    state.results = [];
  }
}

function takeNextItem() {
  const item = state.items.find((candidate) => candidate.status === "queued");
  if (!item) {
    return null;
  }
  item.status = "preparing";
  item.statusLabel = "Preparing";
  return item;
}

function finishBatchIfDone(token) {
  if (token !== state.runToken) {
    return;
  }

  const pending = state.items.some(
    (item) => item.status === "queued" || item.status === "preparing" || item.status === "running"
  );

  if (state.paused && state.activeWorkers === 0) {
    setStatus("Batch paused", `${state.items.filter((item) => isDoneStatus(item.status)).length}/${state.items.length} complete`);
  }

  if (!pending && state.activeWorkers === 0) {
    const batchMs = performance.now() - state.batchStartedAt;
    const timings = state.results
      .map((result) => result.timing?.clientMs)
      .filter((value) => Number.isFinite(value));
    const targetHits = timings.filter((value) => value <= LATENCY_TARGET_MS).length;
    state.running = false;
    state.paused = false;
    setStatus(
      "Batch complete",
      `${formatMs(batchMs)} total, ${targetHits}/${timings.length} images within target`
    );
  }

  renderQueue();
  renderResults();
}

async function workerLoop(token) {
  state.activeWorkers += 1;
  renderQueue();

  try {
    while (token === state.runToken && state.running && !state.paused) {
      const item = takeNextItem();
      if (!item) {
        break;
      }
      renderQueue();
      await analyzeItem(item);
      state.completedThisRun += 1;
      renderProgress();
    }
  } finally {
    state.activeWorkers = Math.max(0, state.activeWorkers - 1);
    finishBatchIfDone(token);
  }
}

function startWorkers(token = state.runToken) {
  if (!state.running || state.paused) {
    renderControls();
    return;
  }

  const hasQueued = () => state.items.some((item) => item.status === "queued");
  while (state.activeWorkers < currentConcurrency() && hasQueued()) {
    workerLoop(token);
  }

  finishBatchIfDone(token);
}

function startBatch(items, { clearResults }) {
  if (!validateItemsReady(items)) {
    renderQueue();
    return;
  }

  state.runToken += 1;
  state.running = true;
  state.paused = false;
  state.activeWorkers = 0;
  state.batchStartedAt = performance.now();
  state.completedThisRun = 0;
  els.detailPanel.hidden = true;
  resetItemsForRun(items, { clearResults });
  renderQueue();
  renderResults();
  setStatus("Running verification", `${Math.min(currentConcurrency(), items.length)} concurrent`);
  startWorkers(state.runToken);
}

function verifyBatch() {
  if (state.running || !state.items.length) {
    return;
  }

  startBatch(state.items, { clearResults: true });
}

function togglePause() {
  if (!state.running) {
    return;
  }

  state.paused = !state.paused;
  if (state.paused) {
    setStatus("Pausing batch", `${state.activeWorkers} active item${state.activeWorkers === 1 ? "" : "s"} finishing`);
  } else {
    setStatus("Running verification", `${Math.min(currentConcurrency(), inProgressItems().length)} concurrent`);
    startWorkers(state.runToken);
  }
  renderQueue();
}

function retryFailedItems() {
  if (state.running) {
    return;
  }

  const retryItems = failedItems();
  if (!retryItems.length) {
    return;
  }

  startBatch(retryItems, { clearResults: false });
}

function clearAll() {
  for (const item of state.items) {
    URL.revokeObjectURL(item.previewUrl);
  }
  state.items = [];
  state.results = [];
  state.csvRows = [];
  state.csvFileName = "";
  state.running = false;
  state.paused = false;
  state.activeWorkers = 0;
  state.runToken += 1;
  state.batchStartedAt = 0;
  state.completedThisRun = 0;
  els.detailPanel.hidden = true;
  updateCsvPairing();
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
els.pickCsvButton.addEventListener("click", () => els.csvInput.click());
els.fileInput.addEventListener("change", (event) => {
  addFiles(event.target.files);
  event.target.value = "";
});
els.csvInput.addEventListener("change", (event) => handleCsvFile(event.target.files[0]));
els.loadSamplesButton.addEventListener("click", loadSamples);
els.verifyButton.addEventListener("click", verifyBatch);
els.pauseButton.addEventListener("click", togglePause);
els.retryButton.addEventListener("click", retryFailedItems);
els.clearButton.addEventListener("click", clearAll);
els.downloadButton.addEventListener("click", downloadResults);
els.concurrencyInput.addEventListener("input", () => {
  renderControls();
  if (state.running && !state.paused) {
    startWorkers(state.runToken);
  }
});

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

setApplicationFields({ governmentWarning: GOVERNMENT_WARNING, beverageType: "Distilled spirits" });
renderQueue();
renderResults();
