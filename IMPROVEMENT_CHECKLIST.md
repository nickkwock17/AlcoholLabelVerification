# Improvement Checklist

Use this as the working roadmap for improving the prototype after the initial deployment.

## 1. Structured Application Fields

Replace the single **Application text** textarea with individual fields:

- Brand Name
- Class/Type
- Alcohol Content
- Net Contents
- Producer/Bottler/Importer Name
- Producer/Bottler/Importer Address
- Country of Origin
- Beverage Type
- Government Health Warning

Government Health Warning should be shown as a locked required field using the canonical 27 CFR 16.21 text, not as a normal field reviewers retype for every application.

Goal: make the app feel closer to the form data a reviewer would compare against label artwork, while keeping the most legally sensitive text explicit and protected from accidental edits.

## 2. CSV + Image Batch Pairing

Add a CSV upload flow for large batches.

Status: implemented in the browser workflow.

Suggested columns:

```text
file_name,brand_name,class_type,alcohol_content,net_contents,producer_name,producer_address,country_of_origin,beverage_type
```

Expected behavior:

- [x] Upload CSV.
- [x] Upload many label images.
- [x] Match each image to its CSV row by `file_name`.
- [x] Show unmatched images and unmatched CSV rows before running verification.
- [x] Include a sample CSV fixture for the built-in test labels.

Goal: support realistic 200-300 label application batches without manual entry.

## 3. Large Batch Reliability

Improve the batch runner for high-volume uploads.

Status: initial browser-side reliability pass implemented.

Add:

- [x] Adjustable concurrency.
- [x] Progress bar.
- [x] Estimated time remaining.
- [x] Pause/resume.
- [x] Retry failed items.
- [x] Partial result preservation.
- [x] Clear error states for API failures and low-confidence extractions.
- [x] 200-300 image batch support with a 300-image cap.
- [x] Large-batch queue preview to keep the browser responsive.
- [ ] Consider backend queueing if production batches exceed browser/serverless limits.

Goal: make large batches feel dependable instead of fragile.

## 4. Latency Optimization

Reduce per-image latency while preserving accuracy.

Status: initial optimization pass implemented.

Potential changes:

- [x] Resize/compress images more aggressively before upload.
- [x] Shorten the extraction prompt.
- [x] Simplify the extraction schema so the model extracts label evidence only.
- [x] Use adaptive detail:
  - low-detail first pass for clean labels
  - high-detail retry only when confidence is low, image quality is poor, required fields are missing, or warning evidence is missing
- [x] Add benchmark output for image detail mode and retry count.
- [ ] Tune batch concurrency against rate limits.
- [ ] Run before/after production benchmark after Vercel redeploy.

Goal: keep typical labels under the 5 second target and improve throughput for large batches.

## 5. Exportable Compliance Report

Add report exports.

Useful formats:

- CSV
- JSON
- PDF later if needed

Include:

- File name
- Pass/fail/needs-review status
- Failed checks
- Expected values
- Extracted label values
- Evidence text
- Confidence
- Client latency
- Server latency
- Model latency
- Timestamp

Goal: give reviewers and evaluators a durable artifact from each batch.

## 6. Review States And Human Workflow

Add more nuanced statuses:

- Pass
- Fail
- Needs human review
- Low confidence
- API error

Add optional reviewer actions:

- Mark as reviewed
- Override result
- Add notes
- Filter by status

Goal: reflect real compliance work where ambiguous labels need judgment.

## 7. Beverage-Specific Rule Sets

Expand beyond common fields.

Modes:

- Distilled spirits
- Wine
- Beer/malt beverage

Each mode should define:

- Required fields
- Allowed tolerances
- Special exceptions
- Beverage-specific guidance references

Goal: move from a common-field prototype toward a more complete TTB compliance assistant.

## 8. Evaluation Harness

Add a repeatable evaluation suite.

Create:

```text
test-labels/expected-results.json
```

Then add a script that:

- Runs each fixture.
- Compares actual verdict to expected verdict.
- Reports accuracy.
- Reports latency metrics.
- Fails when known fixtures regress.

Goal: prove changes improve the system instead of only changing it.

## Suggested Implementation Order

1. Structured application fields.
2. CSV + image pairing.
3. Batch progress, retries, and export.
4. Adaptive latency optimization.
5. Beverage-specific rule expansion.
6. Full evaluation harness.

## Notes To Revisit

- Decide whether batch results should be stored locally in the browser or only downloaded.
- Decide whether a backend queue is needed for true 200-300 image production batches.
- Decide whether image OCR should remain OpenAI-only or support a fallback OCR provider.
- Decide how strict the app should be when the AI cannot confirm visual boldness.
- Decide whether the government warning field should always be locked or editable only behind an advanced override.
