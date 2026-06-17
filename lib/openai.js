import { GOVERNMENT_WARNING } from "./rules.js";

const DEFAULT_MODEL = "gpt-5.4-mini";
const DEFAULT_IMAGE_DETAIL = "adaptive";
const DEFAULT_OPENAI_REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_OPENAI_TRANSIENT_RETRIES = 1;
const DEFAULT_OPENAI_RETRY_BASE_DELAY_MS = 250;
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const REQUIRED_LABEL_FIELDS = [
  "brandName",
  "classType",
  "alcoholContent",
  "netContents",
  "producerName",
  "producerAddress"
];

function extractionSchema() {
  const labelFields = {
    type: "object",
    additionalProperties: false,
    properties: {
      brandName: { type: ["string", "null"] },
      classType: { type: ["string", "null"] },
      alcoholContent: { type: ["string", "null"] },
      netContents: { type: ["string", "null"] },
      producerName: { type: ["string", "null"] },
      producerAddress: { type: ["string", "null"] },
      countryOfOrigin: { type: ["string", "null"] }
    },
    required: [
      "brandName",
      "classType",
      "alcoholContent",
      "netContents",
      "producerName",
      "producerAddress",
      "countryOfOrigin"
    ]
  };

  return {
    type: "object",
    additionalProperties: false,
    properties: {
      label: {
        type: "object",
        additionalProperties: false,
        properties: {
          ...labelFields.properties,
          governmentWarningText: { type: ["string", "null"] },
          warningHeading: { type: ["string", "null"] },
          warningHeadingAllCaps: { type: "boolean" },
          warningHeadingBold: { type: "boolean" },
          fullOcrText: { type: ["string", "null"] }
        },
        required: [
          ...labelFields.required,
          "governmentWarningText",
          "warningHeading",
          "warningHeadingAllCaps",
          "warningHeadingBold",
          "fullOcrText"
        ]
      },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      imageQuality: { type: "string", enum: ["good", "fair", "poor"] },
      notes: {
        type: "array",
        items: { type: "string" }
      }
    },
    required: ["label", "confidence", "imageQuality", "notes"]
  };
}

function asText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function imageDetailMode() {
  const value = String(process.env.OPENAI_IMAGE_DETAIL || DEFAULT_IMAGE_DETAIL)
    .trim()
    .toLowerCase();
  return ["adaptive", "low", "high", "auto"].includes(value) ? value : DEFAULT_IMAGE_DETAIL;
}

function retryConfidenceThreshold() {
  const value = Number(process.env.OPENAI_RETRY_CONFIDENCE || 0.72);
  return Number.isFinite(value) ? value : 0.72;
}

function positiveIntegerEnv(name, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(value)));
}

function requestTimeoutMs() {
  return positiveIntegerEnv("OPENAI_REQUEST_TIMEOUT_MS", DEFAULT_OPENAI_REQUEST_TIMEOUT_MS, {
    min: 1_000,
    max: 60_000
  });
}

function transientRetries() {
  return positiveIntegerEnv("OPENAI_TRANSIENT_RETRIES", DEFAULT_OPENAI_TRANSIENT_RETRIES, {
    min: 0,
    max: 3
  });
}

function retryDelayMs(attemptIndex) {
  const baseDelay = positiveIntegerEnv(
    "OPENAI_RETRY_BASE_DELAY_MS",
    DEFAULT_OPENAI_RETRY_BASE_DELAY_MS,
    {
      min: 0,
      max: 5_000
    }
  );
  return baseDelay * 2 ** attemptIndex;
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isTransientStatus(status) {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

function isTransientError(error) {
  return error?.timeout === true || isTransientStatus(Number(error?.status));
}

function missingRequiredFields(extraction) {
  const label = extraction?.label ?? {};
  return REQUIRED_LABEL_FIELDS.filter((key) => !asText(label[key]));
}

function retryReason(extraction) {
  const confidence = Number(extraction?.confidence);
  const threshold = retryConfidenceThreshold();
  if (!Number.isFinite(confidence)) {
    return "missing confidence score";
  }
  if (confidence < threshold) {
    return `confidence ${confidence.toFixed(2)} below ${threshold.toFixed(2)}`;
  }
  if (extraction?.imageQuality === "poor") {
    return "image quality marked poor";
  }

  const missing = missingRequiredFields(extraction);
  if (missing.length) {
    return `missing required label evidence: ${missing.join(", ")}`;
  }

  const label = extraction?.label ?? {};
  const warningEvidence = `${asText(label.warningHeading)} ${asText(label.governmentWarningText)} ${asText(
    label.fullOcrText
  )}`.toUpperCase();
  if (!warningEvidence.includes("GOVERNMENT WARNING")) {
    return "missing government warning evidence";
  }

  return "";
}

function buildPrompt(fileName) {
  return [
    "OCR this alcohol beverage label image for compliance review.",
    "Extract only visible label text. Do not infer from the file name or expected application data.",
    "Return null when a field is absent or illegible. Do not decide pass/fail.",
    "For governmentWarningText, copy the warning body after the heading. For warningHeading, copy the visible heading.",
    "The canonical warning begins:",
    GOVERNMENT_WARNING.slice(0, 47),
    "",
    `File name: ${fileName || "uploaded image"}`
  ].join("\n");
}

function buildRequest({ imageDataUrl, fileName, withSchema, detail }) {
  const request = {
    model: process.env.OPENAI_MODEL || DEFAULT_MODEL,
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text:
              "You are a conservative OCR extraction engine for alcohol label review. Extract visible label evidence only. Return null rather than guessing. Set warningHeadingBold true only when the warning heading is visually bold."
          }
        ]
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: buildPrompt(fileName)
          },
          {
            type: "input_image",
            image_url: imageDataUrl,
            detail
          }
        ]
      }
    ],
    max_output_tokens: 1000
  };

  if (withSchema) {
    request.text = {
      format: {
        type: "json_schema",
        name: "alcohol_label_extraction",
        strict: true,
        schema: extractionSchema()
      }
    };
  }

  return request;
}

function responseText(payload) {
  if (typeof payload.output_text === "string") {
    return payload.output_text;
  }

  const chunks = [];
  for (const item of payload.output ?? []) {
    for (const content of item.content ?? []) {
      if (typeof content.text === "string") {
        chunks.push(content.text);
      }
    }
  }
  return chunks.join("\n");
}

function parseJson(text) {
  const cleaned = String(text || "")
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }
    throw new Error("OpenAI response did not contain parseable JSON.");
  }
}

async function callOpenAI(body) {
  const timeoutMs = requestTimeoutMs();
  const maxRetries = transientRetries();
  const requestAttempts = [];

  for (let attemptIndex = 0; attemptIndex <= maxRetries; attemptIndex += 1) {
    const started = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(OPENAI_RESPONSES_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });

      const payload = await response.json().catch(() => ({}));
      requestAttempts.push({
        status: response.status,
        ms: Date.now() - started,
        timedOut: false,
        retryable: isTransientStatus(response.status)
      });

      if (!isTransientStatus(response.status) || attemptIndex === maxRetries) {
        return { response, payload, requestAttempts, timeoutMs };
      }
    } catch (error) {
      const timedOut = error?.name === "AbortError";
      const wrapped = timedOut
        ? new Error(`OpenAI request exceeded ${Math.round(timeoutMs / 1000)} second timeout.`)
        : error;
      if (timedOut) {
        wrapped.status = 504;
        wrapped.timeout = true;
      }

      requestAttempts.push({
        status: wrapped.status || 0,
        ms: Date.now() - started,
        timedOut,
        retryable: isTransientError(wrapped),
        message: wrapped.message || "OpenAI request failed."
      });

      if (!isTransientError(wrapped) || attemptIndex === maxRetries) {
        wrapped.detail = {
          ...(wrapped.detail ?? {}),
          requestAttempts,
          timeoutMs
        };
        throw wrapped;
      }
    } finally {
      clearTimeout(timeout);
    }

    await wait(retryDelayMs(attemptIndex));
  }

  throw new Error("OpenAI request failed after retries.");
}

async function extractionAttempt({ imageDataUrl, fileName, detail }) {
  const started = Date.now();
  const requestAttempts = [];
  let timeoutMs = requestTimeoutMs();
  let response;
  let payload;

  try {
    const first = await callOpenAI(buildRequest({ imageDataUrl, fileName, detail, withSchema: true }));
    response = first.response;
    payload = first.payload;
    timeoutMs = first.timeoutMs;
    requestAttempts.push(...first.requestAttempts.map((attempt) => ({ ...attempt, schema: true })));

    if (!response.ok && response.status === 400) {
      const retry = await callOpenAI(buildRequest({ imageDataUrl, fileName, detail, withSchema: false }));
      response = retry.response;
      payload = retry.payload;
      timeoutMs = retry.timeoutMs;
      requestAttempts.push(...retry.requestAttempts.map((attempt) => ({ ...attempt, schema: false })));
    }
  } catch (error) {
    error.modelMs = Date.now() - started;
    throw error;
  }

  const modelMs = Date.now() - started;

  if (!response.ok) {
    const error = new Error(payload?.error?.message || "OpenAI request failed.");
    error.status = response.status;
    error.detail = {
      ...payload,
      requestAttempts,
      timeoutMs
    };
    error.modelMs = modelMs;
    throw error;
  }

  return {
    detail,
    extraction: parseJson(responseText(payload)),
    model: payload.model || process.env.OPENAI_MODEL || DEFAULT_MODEL,
    usage: payload.usage || null,
    modelMs,
    requestAttempts,
    timeoutMs
  };
}

function attemptSummary(attempt, reason = "") {
  return {
    detail: attempt.detail,
    model: attempt.model,
    modelMs: attempt.modelMs,
    confidence: Number.isFinite(Number(attempt.extraction?.confidence))
      ? Number(attempt.extraction.confidence)
      : null,
    imageQuality: attempt.extraction?.imageQuality || null,
    retryReason: reason || null,
    timeoutMs: attempt.timeoutMs,
    requestAttempts: attempt.requestAttempts.length,
    transientRetries: Math.max(0, attempt.requestAttempts.length - 1),
    requestTimeline: attempt.requestAttempts.map((requestAttempt) => ({
      status: requestAttempt.status,
      ms: requestAttempt.ms,
      timedOut: requestAttempt.timedOut,
      retryable: requestAttempt.retryable,
      schema: requestAttempt.schema,
      message: requestAttempt.message || null
    }))
  };
}

export async function extractLabel({ imageDataUrl, fileName }) {
  if (!process.env.OPENAI_API_KEY) {
    const error = new Error("Missing OPENAI_API_KEY. Add it locally and in Vercel environment variables.");
    error.status = 500;
    throw error;
  }

  const started = Date.now();
  const mode = imageDetailMode();
  const firstDetail = mode === "adaptive" ? "low" : mode;
  const attempts = [];
  let result = await extractionAttempt({ imageDataUrl, fileName, detail: firstDetail });
  const reason = mode === "adaptive" ? retryReason(result.extraction) : "";
  attempts.push(attemptSummary(result, reason));

  if (mode === "adaptive" && reason) {
    result = await extractionAttempt({ imageDataUrl, fileName, detail: "high" });
    attempts.push(attemptSummary(result));
  }

  return {
    extraction: result.extraction,
    model: result.model,
    usage: result.usage,
    imageDetail: result.detail,
    attempts,
    modelMs: Date.now() - started
  };
}
