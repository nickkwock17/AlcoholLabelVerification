import { asText, normalizeComparable, normalizeWhitespace } from "./normalization.js";

const FIELD_PATTERNS = {
  brandName: /(?:^|\n)\s*(?:brand(?:\s+name)?|trade\s+name)\s*:\s*(.+)/i,
  classType: /(?:^|\n)\s*(?:class\s*\/?\s*type|class|type|designation)\s*:\s*(.+)/i,
  alcoholContent: /(?:^|\n)\s*(?:alcohol(?:\s+content)?|abv|alc\.?\s*\/?\s*vol\.?)\s*:\s*(.+)/i,
  netContents: /(?:^|\n)\s*(?:net\s+contents?|contents?)\s*:\s*(.+)/i,
  producerName: /(?:^|\n)\s*(?:producer|bottler|distiller|importer|name\s+and\s+address)\s*:\s*(.+)/i,
  producerAddress: /(?:^|\n)\s*(?:address|producer\s+address|bottler\s+address|importer\s+address)\s*:\s*(.+)/i,
  countryOfOrigin: /(?:^|\n)\s*(?:country\s+of\s+origin|origin)\s*:\s*(.+)/i
};

export function extractExpectedFields(applicationText) {
  const text = asText(applicationText);
  const result = {};

  for (const [key, pattern] of Object.entries(FIELD_PATTERNS)) {
    const match = text.match(pattern);
    if (match?.[1]) {
      result[key] = normalizeWhitespace(match[1]);
    }
  }

  if (!result.alcoholContent) {
    const abv = text.match(/\b\d{1,2}(?:\.\d+)?\s*%?\s*(?:alc\.?\s*\/?\s*vol\.?|abv|alcohol by volume)\b/i);
    if (abv) {
      result.alcoholContent = normalizeWhitespace(abv[0]);
    }
  }

  if (!result.netContents) {
    const contents = text.match(/\b\d+(?:\.\d+)?\s*(?:ml|mL|l|L|liter|liters|fl\.?\s*oz\.?|ounces?)\b/i);
    if (contents) {
      result.netContents = normalizeWhitespace(contents[0]);
    }
  }

  return result;
}

export function parseAlcohol(value) {
  const text = asText(value);
  const normalized = normalizeComparable(text);
  const percentMatches = [...normalized.matchAll(/(\d{1,2}(?:\.\d+)?)\s*%?\s*(?:alc\s*\/?\s*vol|abv|alcohol by volume)?/gi)]
    .map((match) => Number(match[1]))
    .filter((number) => Number.isFinite(number) && number > 0 && number <= 100);
  const proofMatches = [...normalized.matchAll(/(\d{1,3}(?:\.\d+)?)\s*proof/gi)]
    .map((match) => Number(match[1]))
    .filter((number) => Number.isFinite(number) && number > 0 && number <= 200);

  return {
    abv: [...new Set(percentMatches)],
    proof: [...new Set(proofMatches)]
  };
}

export function alcoholMatches(expected, found) {
  const left = parseAlcohol(expected);
  const right = parseAlcohol(found);

  if (left.abv.length && right.abv.length) {
    return left.abv.some((expectedAbv) =>
      right.abv.some((foundAbv) => Math.abs(expectedAbv - foundAbv) <= 0.15)
    );
  }

  if (left.proof.length && right.proof.length) {
    return left.proof.some((expectedProof) =>
      right.proof.some((foundProof) => Math.abs(expectedProof - foundProof) <= 0.5)
    );
  }

  if (left.abv.length && right.proof.length) {
    return left.abv.some((expectedAbv) =>
      right.proof.some((foundProof) => Math.abs(expectedAbv * 2 - foundProof) <= 0.5)
    );
  }

  if (left.proof.length && right.abv.length) {
    return left.proof.some((expectedProof) =>
      right.abv.some((foundAbv) => Math.abs(expectedProof / 2 - foundAbv) <= 0.15)
    );
  }

  return false;
}

const UNIT_TO_ML = {
  ml: 1,
  milliliter: 1,
  milliliters: 1,
  l: 1000,
  liter: 1000,
  liters: 1000,
  litre: 1000,
  litres: 1000,
  oz: 29.5735,
  ounce: 29.5735,
  ounces: 29.5735,
  floz: 29.5735,
  "fl oz": 29.5735,
  pint: 473.176,
  pints: 473.176,
  quart: 946.353,
  quarts: 946.353,
  gallon: 3785.41,
  gallons: 3785.41
};

export function parseNetContents(value) {
  const text = normalizeComparable(value).replace(/fl\s*oz/g, "fl oz");
  const matches = [...text.matchAll(/(\d+(?:\.\d+)?)\s*(ml|milliliters?|l|liters?|litres?|oz|ounces?|fl oz|pints?|quarts?|gallons?)\b/gi)];

  return matches
    .map((match) => {
      const unit = match[2].toLowerCase();
      const ml = Number(match[1]) * (UNIT_TO_ML[unit] ?? 0);
      return Number.isFinite(ml) && ml > 0 ? { raw: match[0], ml } : null;
    })
    .filter(Boolean);
}

export function netContentsMatches(expected, found) {
  const left = parseNetContents(expected);
  const right = parseNetContents(found);

  if (!left.length || !right.length) {
    return false;
  }

  return left.some((expectedVolume) =>
    right.some((foundVolume) => {
      const tolerance = Math.max(3, expectedVolume.ml * 0.01);
      return Math.abs(expectedVolume.ml - foundVolume.ml) <= tolerance;
    })
  );
}
