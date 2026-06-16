const STOP_WORDS = new Set(["the", "and", "of", "by", "a", "an", "llc", "inc", "co", "company"]);

export function asText(value) {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value).trim();
}

export function normalizeWhitespace(value) {
  return asText(value).replace(/\s+/g, " ").trim();
}

export function normalizeComparable(value) {
  return normalizeWhitespace(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9.%/ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeWarning(value) {
  return normalizeWhitespace(value)
    .replace(/\s+([:;,.()])/g, "$1")
    .replace(/([:;,.()])\s+/g, "$1 ")
    .trim();
}

export function tokenize(value) {
  return normalizeComparable(value)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

export function tokenSimilarity(left, right) {
  const a = new Set(tokenize(left));
  const b = new Set(tokenize(right));
  if (a.size === 0 || b.size === 0) {
    return 0;
  }

  let overlap = 0;
  for (const token of a) {
    if (b.has(token)) {
      overlap += 1;
    }
  }

  return (2 * overlap) / (a.size + b.size);
}

export function looselyMatches(expected, found) {
  const left = normalizeComparable(expected);
  const right = normalizeComparable(found);

  if (!left || !right) {
    return false;
  }

  if (left === right) {
    return true;
  }

  const shorter = left.length < right.length ? left : right;
  const longer = left.length < right.length ? right : left;
  if (shorter.length >= 6 && longer.includes(shorter) && shorter.length / longer.length >= 0.72) {
    return true;
  }

  return tokenSimilarity(left, right) >= 0.82;
}

export function compactForDisplay(value, fallback = "Not found") {
  const text = normalizeWhitespace(value);
  if (!text) {
    return fallback;
  }
  return text.length > 180 ? `${text.slice(0, 177)}...` : text;
}
