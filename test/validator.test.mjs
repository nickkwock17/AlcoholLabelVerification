import test from "node:test";
import assert from "node:assert/strict";
import { GOVERNMENT_WARNING } from "../lib/rules.js";
import { validateLabel } from "../lib/validator.js";

const applicationText = [
  "Brand Name: OLD TOM DISTILLERY",
  "Class/Type: Kentucky Straight Bourbon Whiskey",
  "Alcohol Content: 45% Alc./Vol. (90 Proof)",
  "Net Contents: 750 mL",
  "Producer: Old Tom Distillery",
  "Address: 112 Barrel House Road, Frankfort, KY 40601"
].join("\n");

function baseExtraction(overrides = {}) {
  return {
    expected: {
      brandName: "OLD TOM DISTILLERY",
      classType: "Kentucky Straight Bourbon Whiskey",
      alcoholContent: "45% Alc./Vol. (90 Proof)",
      netContents: "750 mL",
      producerName: "Old Tom Distillery",
      producerAddress: "112 Barrel House Road, Frankfort, KY 40601",
      countryOfOrigin: null
    },
    label: {
      brandName: "OLD TOM DISTILLERY",
      classType: "Kentucky Straight Bourbon Whiskey",
      alcoholContent: "45% Alc./Vol. (90 Proof)",
      netContents: "750 mL",
      producerName: "Old Tom Distillery",
      producerAddress: "112 Barrel House Road, Frankfort, KY 40601",
      countryOfOrigin: null,
      governmentWarningText: GOVERNMENT_WARNING,
      warningHeading: "GOVERNMENT WARNING:",
      warningHeadingAllCaps: true,
      warningHeadingBold: true,
      fullOcrText: GOVERNMENT_WARNING
    },
    confidence: 0.91,
    imageQuality: "good",
    notes: [],
    ...overrides
  };
}

test("passes a complete matching label extraction", () => {
  const result = validateLabel({ applicationText, extraction: baseExtraction() });
  assert.equal(result.verdict, "pass");
});

test("fails wrong ABV even when other fields match", () => {
  const extraction = baseExtraction({
    label: {
      ...baseExtraction().label,
      alcoholContent: "40% Alc./Vol. (80 Proof)"
    }
  });
  const result = validateLabel({ applicationText, extraction });
  assert.equal(result.verdict, "fail");
  assert.ok(result.failedChecks.includes("alcoholContent"));
});

test("fails missing net contents", () => {
  const extraction = baseExtraction({
    label: {
      ...baseExtraction().label,
      netContents: null
    }
  });
  const result = validateLabel({ applicationText, extraction });
  assert.equal(result.verdict, "fail");
  assert.ok(result.failedChecks.includes("netContents"));
});

test("fails government warning heading case", () => {
  const extraction = baseExtraction({
    label: {
      ...baseExtraction().label,
      warningHeading: "Government Warning:",
      warningHeadingAllCaps: false
    }
  });
  const result = validateLabel({ applicationText, extraction });
  assert.equal(result.verdict, "fail");
  assert.ok(result.failedChecks.includes("governmentWarningHeadingCaps"));
});

test("passes when OCR extracts warning heading and body separately", () => {
  const extraction = baseExtraction({
    label: {
      ...baseExtraction().label,
      governmentWarningText:
        "(1) According to the Surgeon General, women should not drink alcoholic beverages during pregnancy because of the risk of birth defects. (2) Consumption of alcoholic beverages impairs your ability to drive a car or operate machinery, and may cause health problems.",
      warningHeading: "GOVERNMENT WARNING:"
    }
  });
  const result = validateLabel({ applicationText, extraction });
  assert.equal(result.verdict, "pass");
});

test("fails unconfirmed bold heading", () => {
  const extraction = baseExtraction({
    label: {
      ...baseExtraction().label,
      warningHeadingBold: false
    }
  });
  const result = validateLabel({ applicationText, extraction });
  assert.equal(result.verdict, "fail");
  assert.ok(result.failedChecks.includes("governmentWarningHeadingBold"));
});

test("allows ordinary capitalization differences for brand names", () => {
  const extraction = baseExtraction({
    label: {
      ...baseExtraction().label,
      brandName: "Old Tom Distillery"
    }
  });
  const result = validateLabel({ applicationText, extraction });
  assert.equal(result.verdict, "pass");
});
