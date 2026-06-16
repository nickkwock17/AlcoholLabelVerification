import { extractExpectedFields } from "./field-parsers.js";
import { alcoholMatches, netContentsMatches } from "./field-parsers.js";
import { GOVERNMENT_WARNING, REQUIRED_COMMON_FIELDS, WARNING_CHECKS } from "./rules.js";
import {
  asText,
  compactForDisplay,
  looselyMatches,
  normalizeWarning,
  normalizeWhitespace
} from "./normalization.js";

function isBlank(value) {
  return normalizeWhitespace(value).length === 0;
}

function makeCheck(id, label, status, detail, expected = "", found = "") {
  return {
    id,
    label,
    status,
    detail,
    expected: compactForDisplay(expected, ""),
    found: compactForDisplay(found, "")
  };
}

function mergeExpectedFields(applicationText, modelExpected = {}) {
  const fallback = extractExpectedFields(applicationText);
  return {
    ...fallback,
    ...Object.fromEntries(
      Object.entries(modelExpected ?? {}).filter(([, value]) => !isBlank(value))
    )
  };
}

function getWarningText(label) {
  const direct = asText(label.governmentWarningText);
  if (direct) {
    const heading = asText(label.warningHeading);
    if (heading && !direct.toUpperCase().startsWith("GOVERNMENT WARNING:")) {
      return `${heading} ${direct}`;
    }
    return direct;
  }

  const ocr = asText(label.fullOcrText);
  const index = ocr.toUpperCase().indexOf("GOVERNMENT WARNING:");
  return index >= 0 ? ocr.slice(index) : "";
}

function warningTextMatches(foundWarning) {
  const expected = normalizeWarning(GOVERNMENT_WARNING);
  const found = normalizeWarning(foundWarning);
  return found === expected || found.includes(expected);
}

function compareField(field, expected, label) {
  const expectedValue = expected[field.key];
  const foundValue = label[field.key];

  if (isBlank(expectedValue)) {
    return makeCheck(
      field.key,
      field.label,
      "fail",
      `Application text does not include ${field.label.toLowerCase()}.`
    );
  }

  if (isBlank(foundValue)) {
    return makeCheck(
      field.key,
      field.label,
      "fail",
      `Label image is missing ${field.label.toLowerCase()}.`,
      expectedValue,
      foundValue
    );
  }

  let matches = false;
  if (field.key === "alcoholContent") {
    matches = alcoholMatches(expectedValue, foundValue);
  } else if (field.key === "netContents") {
    matches = netContentsMatches(expectedValue, foundValue);
  } else {
    matches = looselyMatches(expectedValue, foundValue);
  }

  return makeCheck(
    field.key,
    field.label,
    matches ? "pass" : "fail",
    matches ? `${field.label} matches.` : `${field.label} does not match application text.`,
    expectedValue,
    foundValue
  );
}

export function validateLabel({ applicationText, extraction }) {
  const expected = mergeExpectedFields(applicationText, extraction?.expected);
  const label = extraction?.label ?? {};
  const checks = [];

  for (const field of REQUIRED_COMMON_FIELDS) {
    checks.push(compareField(field, expected, label));
  }

  if (!isBlank(expected.countryOfOrigin)) {
    checks.push(
      makeCheck(
        "countryOfOrigin",
        "Country of origin",
        !isBlank(label.countryOfOrigin) && looselyMatches(expected.countryOfOrigin, label.countryOfOrigin)
          ? "pass"
          : "fail",
        !isBlank(label.countryOfOrigin) && looselyMatches(expected.countryOfOrigin, label.countryOfOrigin)
          ? "Country of origin matches."
          : "Country of origin does not match application text.",
        expected.countryOfOrigin,
        label.countryOfOrigin
      )
    );
  }

  const warningText = getWarningText(label);
  checks.push(
    makeCheck(
      "governmentWarningExactText",
      WARNING_CHECKS.exactText,
      warningTextMatches(warningText) ? "pass" : "fail",
      warningTextMatches(warningText)
        ? "Government warning text matches 27 CFR 16.21."
        : "Government warning text is missing or differs from the required wording.",
      GOVERNMENT_WARNING,
      warningText
    )
  );

  const heading = asText(label.warningHeading);
  const headingAllCaps =
    label.warningHeadingAllCaps === true || /^GOVERNMENT WARNING:$/.test(normalizeWhitespace(heading));
  checks.push(
    makeCheck(
      "governmentWarningHeadingCaps",
      WARNING_CHECKS.headingCaps,
      headingAllCaps ? "pass" : "fail",
      headingAllCaps ? "Warning heading is all caps." : "Warning heading is not confirmed all caps.",
      "GOVERNMENT WARNING:",
      heading
    )
  );

  checks.push(
    makeCheck(
      "governmentWarningHeadingBold",
      WARNING_CHECKS.headingBold,
      label.warningHeadingBold === true ? "pass" : "fail",
      label.warningHeadingBold === true
        ? "Warning heading is visually bold."
        : "Warning heading is not confirmed bold.",
      "Bold heading",
      label.warningHeadingBold === true ? "Bold" : "Not confirmed"
    )
  );

  const confidence = Number(extraction?.confidence);
  if (Number.isFinite(confidence)) {
    checks.push(
      makeCheck(
        "ocrConfidence",
        "OCR confidence",
        confidence >= 0.6 ? "pass" : "fail",
        confidence >= 0.6 ? "Model confidence is acceptable." : "Model confidence is too low for auto-approval.",
        ">= 0.60",
        confidence.toFixed(2)
      )
    );
  }

  const failedChecks = checks.filter((check) => check.status === "fail");
  return {
    verdict: failedChecks.length === 0 ? "pass" : "fail",
    summary:
      failedChecks.length === 0
        ? "Label passed all implemented common-field checks."
        : `Label failed ${failedChecks.length} implemented check${failedChecks.length === 1 ? "" : "s"}.`,
    checks,
    expected,
    failedChecks: failedChecks.map((check) => check.id)
  };
}
