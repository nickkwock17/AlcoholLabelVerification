import { readFile, readdir } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  if (arg.startsWith("--")) {
    args.set(arg.slice(2), process.argv[index + 1] && !process.argv[index + 1].startsWith("--") ? process.argv[++index] : true);
  }
}

const url = String(args.get("url") || "http://localhost:3000").replace(/\/$/, "");
const iterations = Number(args.get("iterations") || 1);
const concurrency = Number(args.get("concurrency") || 2);
const targetMs = Number(args.get("target") || 5000);
const textPath = args.get("text")
  ? String(args.get("text"))
  : fileURLToPath(new URL("../test-labels/application-distilled-spirits.txt", import.meta.url));

function mimeFor(file) {
  const ext = extname(file).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".svg") return "image/svg+xml";
  return "application/octet-stream";
}

function expectedVerdictForFile(file) {
  const name = basename(file).toLowerCase();
  if (name.startsWith("pass-")) {
    return "pass";
  }
  if (name.startsWith("fail-")) {
    return "fail";
  }
  return null;
}

async function defaultImages() {
  const dir = fileURLToPath(new URL("../test-labels/", import.meta.url));
  const entries = await readdir(dir);
  return entries
    .filter((name) => /\.(png|jpe?g|webp)$/i.test(name))
    .map((name) => join(dir, name));
}

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
}

async function imageToDataUrl(file) {
  const bytes = await readFile(file);
  return `data:${mimeFor(file)};base64,${bytes.toString("base64")}`;
}

async function runOne(file, applicationText) {
  const imageDataUrl = await imageToDataUrl(file);
  const started = performance.now();
  const response = await fetch(`${url}/api/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fileName: basename(file),
      applicationText,
      imageDataUrl
    })
  });
  const payload = await response.json();
  const verdict = payload.verification?.verdict || "error";
  const expectedVerdict = expectedVerdictForFile(file);
  return {
    file: basename(file),
    ok: response.ok && payload.ok,
    status: response.status,
    verdict,
    expectedVerdict,
    expectedVerdictMatched: expectedVerdict ? verdict === expectedVerdict : null,
    message: payload.message || "",
    imageDetail: payload.imageDetail || "",
    attempts: Array.isArray(payload.attempts) ? payload.attempts.length : 0,
    retryReason: payload.attempts?.[0]?.retryReason || "",
    clientMs: performance.now() - started,
    serverMs: payload.timing?.serverMs,
    modelMs: payload.timing?.modelMs
  };
}

async function runQueue(tasks, limit, worker) {
  const results = [];
  let index = 0;
  const runners = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (index < tasks.length) {
      const current = tasks[index++];
      results.push(await worker(current));
    }
  });
  await Promise.all(runners);
  return results;
}

const images = args.get("image")
  ? [String(args.get("image"))]
  : args.get("images")
    ? String(args.get("images")).split(",").map((item) => item.trim())
    : await defaultImages();

const applicationText = await readFile(textPath, "utf8");
const tasks = Array.from({ length: iterations }, () => images).flat();
const results = await runQueue(tasks, concurrency, (file) => runOne(file, applicationText));
const timings = results.map((result) => result.clientMs);
const withinTarget = results.filter((result) => result.clientMs <= targetMs).length;
const failures = results.filter((result) => !result.ok);
const expectedResults = results.filter((result) => result.expectedVerdict);
const expectedMatches = expectedResults.filter((result) => result.expectedVerdictMatched).length;
const expectedMismatches = expectedResults.filter(
  (result) => result.expectedVerdictMatched === false
);

console.table(
  results.map((result) => ({
    file: result.file,
    verdict: result.verdict,
    expected: result.expectedVerdict || "",
    expectedMatch: result.expectedVerdictMatched,
    ok: result.ok,
    detail: result.imageDetail,
    attempts: result.attempts,
    clientMs: Math.round(result.clientMs),
    serverMs: Math.round(result.serverMs || 0),
    modelMs: Math.round(result.modelMs || 0),
    retryReason: result.retryReason,
    message: result.message
  }))
);

console.log(
  JSON.stringify(
    {
      url,
      images: images.length,
      iterations,
      concurrency,
      targetMs,
      p50Ms: Math.round(percentile(timings, 50)),
      p95Ms: Math.round(percentile(timings, 95)),
      averageMs: Math.round(timings.reduce((sum, value) => sum + value, 0) / timings.length),
      targetHitRate: `${withinTarget}/${results.length}`,
      expectedVerdictMatchRate: expectedResults.length
        ? `${expectedMatches}/${expectedResults.length}`
        : "not available",
      expectedVerdictMismatches: expectedMismatches.map((result) => ({
        file: result.file,
        expected: result.expectedVerdict,
        verdict: result.verdict
      })),
      detailModes: Object.fromEntries(
        [...new Set(results.map((result) => result.imageDetail || "unknown"))].map((detail) => [
          detail,
          results.filter((result) => (result.imageDetail || "unknown") === detail).length
        ])
      ),
      highDetailRetries: results.filter((result) => result.attempts > 1).length,
      apiFailures: failures.length
    },
    null,
    2
  )
);

if (failures.length || expectedMismatches.length) {
  process.exitCode = 1;
}
