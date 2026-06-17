import { extractLabel } from "../lib/openai.js";
import { LATENCY_TARGET_MS } from "../lib/rules.js";
import { validateLabel } from "../lib/validator.js";

function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

function invalid(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
    return req.body;
  }

  if (typeof req.body === "string") {
    return JSON.parse(req.body || "{}");
  }

  if (Buffer.isBuffer(req.body)) {
    return JSON.parse(req.body.toString("utf8") || "{}");
  }

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function validateRequest(body) {
  if (!body || typeof body !== "object") {
    throw invalid("Expected a JSON request body.");
  }

  const applicationText = String(body.applicationText || "").trim();
  const imageDataUrl = String(body.imageDataUrl || "").trim();
  const fileName = String(body.fileName || "label image").trim();

  if (!applicationText) {
    throw invalid("Application text is required.");
  }

  if (!imageDataUrl.startsWith("data:image/")) {
    throw invalid("A data URL image is required.");
  }

  if (imageDataUrl.length > 7_000_000) {
    throw invalid("Image is too large after compression. Try a smaller image.");
  }

  return { applicationText, imageDataUrl, fileName };
}

export default async function handler(req, res) {
  const started = Date.now();

  if (req.method !== "POST") {
    return json(res, 405, { ok: false, message: "Method not allowed." });
  }

  try {
    const body = await readJsonBody(req);
    const input = validateRequest(body);
    const { extraction, model, usage, imageDetail, attempts, modelMs } = await extractLabel(input);
    const verification = validateLabel({
      applicationText: input.applicationText,
      extraction
    });
    const serverMs = Date.now() - started;

    return json(res, 200, {
      ok: true,
      fileName: input.fileName,
      model,
      imageDetail,
      attempts,
      extraction: {
        ...extraction,
        expected: verification.expected
      },
      verification,
      usage,
      timing: {
        modelMs,
        serverMs,
        targetMs: LATENCY_TARGET_MS,
        meetsTarget: serverMs <= LATENCY_TARGET_MS
      }
    });
  } catch (error) {
    const serverMs = Date.now() - started;
    return json(res, error.status || 500, {
      ok: false,
      message: error.message || "Analysis failed.",
      detail: error.detail || null,
      timing: {
        serverMs,
        targetMs: LATENCY_TARGET_MS,
        meetsTarget: false
      }
    });
  }
}
