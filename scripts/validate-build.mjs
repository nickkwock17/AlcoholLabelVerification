import { access, readFile } from "node:fs/promises";

const requiredFiles = [
  "index.html",
  "styles.css",
  "app.js",
  "api/analyze.js",
  "lib/validator.js",
  "test-labels/application-distilled-spirits.txt",
  "test-labels/applications.csv",
  "test-labels/pass-distilled-spirits.svg"
];

for (const file of requiredFiles) {
  await access(new URL(`../${file}`, import.meta.url));
}

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
for (const asset of ["/styles.css", "/app.js"]) {
  if (!html.includes(asset)) {
    throw new Error(`index.html does not reference ${asset}`);
  }
}

console.log("Static build validation passed.");
