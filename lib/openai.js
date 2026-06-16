import { GOVERNMENT_WARNING } from "./rules.js";

const DEFAULT_MODEL = "gpt-5.4-mini";
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

function extractionSchema() {
  const fieldSet = {
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
      expected: fieldSet,
      label: {
        type: "object",
        additionalProperties: false,
        properties: {
          ...fieldSet.properties,
          governmentWarningText: { type: ["string", "null"] },
          warningHeading: { type: ["string", "null"] },
          warningHeadingAllCaps: { type: "boolean" },
          warningHeadingBold: { type: "boolean" },
          fullOcrText: { type: ["string", "null"] }
        },
        required: [
          ...fieldSet.required,
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
    required: ["expected", "label", "confidence", "imageQuality", "notes"]
  };
}

function buildPrompt(applicationText, fileName) {
  return [
    "Extract alcohol label data for a compliance verification prototype.",
    "Do OCR on the image and separately parse the application text.",
    "Return only structured data. Do not decide pass/fail.",
    "Use null when a field cannot be found.",
    "Government warning reference:",
    GOVERNMENT_WARNING,
    "",
    `File name: ${fileName || "uploaded image"}`,
    "",
    "Application text:",
    applicationText
  ].join("\n");
}

function buildRequest({ applicationText, imageDataUrl, fileName, withSchema }) {
  const request = {
    model: process.env.OPENAI_MODEL || DEFAULT_MODEL,
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text:
              "You are an OCR extraction engine for TTB alcohol label review. Extract fields conservatively. If text is not visible, return null rather than guessing. For warningHeadingBold, answer true only when the GOVERNMENT WARNING heading is visually bold."
          }
        ]
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: buildPrompt(applicationText, fileName)
          },
          {
            type: "input_image",
            image_url: imageDataUrl,
            detail: process.env.OPENAI_IMAGE_DETAIL || "high"
          }
        ]
      }
    ],
    max_output_tokens: 1600
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
  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

export async function extractLabel({ applicationText, imageDataUrl, fileName }) {
  if (!process.env.OPENAI_API_KEY) {
    const error = new Error("Missing OPENAI_API_KEY. Add it locally and in Vercel environment variables.");
    error.status = 500;
    throw error;
  }

  const started = Date.now();
  let { response, payload } = await callOpenAI(
    buildRequest({ applicationText, imageDataUrl, fileName, withSchema: true })
  );

  if (!response.ok && response.status === 400) {
    const retry = await callOpenAI(
      buildRequest({ applicationText, imageDataUrl, fileName, withSchema: false })
    );
    response = retry.response;
    payload = retry.payload;
  }

  if (!response.ok) {
    const error = new Error(payload?.error?.message || "OpenAI request failed.");
    error.status = response.status;
    error.detail = payload;
    throw error;
  }

  const text = responseText(payload);
  return {
    extraction: parseJson(text),
    model: payload.model || process.env.OPENAI_MODEL || DEFAULT_MODEL,
    usage: payload.usage || null,
    modelMs: Date.now() - started
  };
}
