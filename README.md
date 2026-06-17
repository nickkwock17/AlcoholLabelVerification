# AI-Powered Alcohol Label Verification App

Standalone prototype for checking alcohol beverage label images against application text and common TTB label requirements.

The app supports batch image upload, AI-assisted OCR extraction, deterministic compliance checks, and latency benchmarking against a 5 second per-image target.

## What It Does

- Accepts one or more label images, with browser-side batches capped at 300 images.
- Accepts application data through structured fields or a CSV matched by `file_name`.
- Shows unmatched images and unmatched CSV rows before verification.
- Extracts label text and fields from each image with an OpenAI vision-capable model.
- Verifies common fields in code:
  - brand name
  - class/type
  - alcohol content
  - net contents
  - producer/bottler/importer name
  - producer/bottler/importer address
  - country of origin when supplied in the application text
  - government health warning text, capitalization, and bold heading
- Reports pass/fail, failed checks, extracted evidence, model time, server time, and total client-observed latency.
- Shows benchmark metrics for average, median, P95, target hit rate, and expected verdict match rate.
- Supports adjustable concurrency, progress, ETA, pause/resume, item-level API errors, and retrying failed/error items.

## Architecture

```text
Browser UI
  -> compresses images to JPEG
  -> matches images to CSV application rows when provided
  -> sends each image + application text to /api/analyze

Vercel Serverless Function
  -> calls OpenAI Responses API with image input
  -> receives structured OCR/field extraction
  -> runs deterministic validators in lib/validator.js
  -> returns verdict, evidence, and timings
```

No database is used. Uploaded images are processed in memory for the request and are not stored by this app.

## Tech Choices

This is intentionally light:

- Static HTML/CSS/JavaScript frontend.
- Vercel serverless function backend.
- Native `fetch` to call OpenAI, with no framework dependency.
- Node built-in test runner for validator coverage.

That keeps hosting simple and avoids late-deadline dependency churn.

## Local Setup

Install Node.js 20 or newer.

Create a local environment file:

```bash
cp .env.example .env
```

Set:

```bash
OPENAI_API_KEY=sk-your-openai-api-key
OPENAI_MODEL=gpt-5.4-mini
OPENAI_IMAGE_DETAIL=adaptive
OPENAI_RETRY_CONFIDENCE=0.72
OPENAI_REQUEST_TIMEOUT_MS=10000
OPENAI_TRANSIENT_RETRIES=1
```

Run locally:

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

## OpenAI API Key

1. Go to the OpenAI platform.
2. Create or sign into your account.
3. Add billing or credits.
4. Create an API key.
5. Put the key in `.env` locally.
6. Add the same key to Vercel as `OPENAI_API_KEY`.

The key must only live in environment variables. Do not paste it into client-side code.

## Deployment On Vercel

For a step-by-step tonight checklist, see `DEPLOYMENT_CHECKLIST.md`.
For post-deployment improvement ideas, see `IMPROVEMENT_CHECKLIST.md`.

1. Push this repository to GitHub.
2. Create a Vercel account and sign in with GitHub.
3. Select **Add New Project**.
4. Import the GitHub repository.
5. In **Environment Variables**, add:
   - `OPENAI_API_KEY`
   - `OPENAI_MODEL` set to `gpt-5.4-mini`
   - `OPENAI_IMAGE_DETAIL` set to `adaptive`
   - `OPENAI_RETRY_CONFIDENCE` set to `0.72`
   - `OPENAI_REQUEST_TIMEOUT_MS` set to `10000`
   - `OPENAI_TRANSIENT_RETRIES` set to `1`
6. Deploy.
7. Use the production URL Vercel provides.

Vercel will serve the static frontend and deploy `api/analyze.js` as a serverless function.

## Test Images

Sample fixtures live in `test-labels/`.

- `pass-distilled-spirits.png`
- `fail-warning-case.png`
- `fail-abv-mismatch.png`
- `fail-missing-net-contents.png`
- `fail-brand-mismatch.png`

Use **Load samples** in the app to populate the batch with these images and matching application text.
It also loads `test-labels/applications.csv`, which demonstrates CSV-to-image pairing.

## Running UI Test Batches

### Few-image smoke test

Use this when you want a quick functional check with the built-in fixtures.

1. Start the local app:

   ```bash
   npm run dev
   ```

2. Open `http://localhost:3000`.
3. Click **Load samples**.
4. Confirm the CSV status says `CSV matching: 5 rows, 5/5 images matched`.
5. Click **Run verification**.
6. Confirm the expected verdict metric matches all named fixtures.

This test makes 5 OpenAI API calls.

### Large local batch test

Use this when you want to exercise the browser queue, CSV matching, progress, concurrency, and retry controls with 100-300 images.

From the repository root in PowerShell, generate a local duplicate-image batch:

```powershell
$batchSize = 100
$sourceDir = "test-labels"
$outDir = "test-batches\$batchSize-images"
New-Item -ItemType Directory -Force $outDir | Out-Null

$rows = Import-Csv "$sourceDir\applications.csv"
$outRows = for ($i = 1; $i -le $batchSize; $i++) {
  $row = $rows[($i - 1) % $rows.Count]
  $base = [System.IO.Path]::GetFileNameWithoutExtension($row.file_name)
  $ext = [System.IO.Path]::GetExtension($row.file_name)
  $newName = "{0}-{1:D3}{2}" -f $base, $i, $ext

  Copy-Item "$sourceDir\$($row.file_name)" "$outDir\$newName" -Force

  [pscustomobject]@{
    file_name = $newName
    brand_name = $row.brand_name
    class_type = $row.class_type
    alcohol_content = $row.alcohol_content
    net_contents = $row.net_contents
    producer_name = $row.producer_name
    producer_address = $row.producer_address
    country_of_origin = $row.country_of_origin
    beverage_type = $row.beverage_type
    expected_verdict = $row.expected_verdict
  }
}

$outRows | Export-Csv "$outDir\applications-$batchSize.csv" -NoTypeInformation
```

For 200 or 300 images, change `$batchSize` to `200` or `300`.

Then run the UI test:

1. Start the local app with `npm run dev`.
2. Open `http://localhost:3000`.
3. Click **Choose CSV** and select `test-batches\100-images\applications-100.csv`.
4. Click **Choose Images** and select the generated `.png` files from `test-batches\100-images`.
5. Confirm the CSV status says `CSV matching: 100 rows, 100/100 images matched`.
6. Set concurrency to `3` or `4` for a realistic local test.
7. Click **Run verification**.
8. Watch expected verdict match rate, target hit rate, P95 latency, and any item-level `API ERROR` results.

Do not click **Load samples** for this test. That loads the original 5 images, whose filenames do not match the generated 100-row CSV.

Running the full test makes one OpenAI API call per image. A 100-image test makes 100 API calls; a 300-image test makes 300 API calls.

## CSV Batch Upload

For large batches, upload a CSV with one row per label image. The browser workflow is designed for 200-300 images per batch and caps each queued batch at 300 images.

Recommended columns:

```text
file_name,brand_name,class_type,alcohol_content,net_contents,producer_name,producer_address,country_of_origin,beverage_type
```

Optional columns:

```text
expected_verdict,government_warning
```

The app matches each image to a CSV row by `file_name`. When a CSV is loaded, images without a matching row are flagged before verification. CSV rows without images are also shown so the reviewer can catch incomplete uploads.

## Batch Reliability

The browser runner keeps batch state locally:

- 300-image maximum per queued batch.
- Large-batch queue preview renders priority cards instead of all cards so the browser stays responsive.
- Adjustable concurrency from 1 to 8 workers.
- Progress bar and ETA based on completed items.
- Pause/resume stops assigning new work while active requests finish.
- API/network failures become per-item `API ERROR` results instead of stopping the batch.
- Results are preserved as each item finishes.
- **Retry failed** reruns failed or errored items and replaces their previous result.

## Verification

Run:

```bash
npm run lint
npm test
npm run build
```

The validator tests cover:

- passing complete label data
- ABV mismatch
- missing net contents
- warning heading capitalization
- warning heading boldness
- tolerant brand capitalization

## Latency Benchmark

The UI reports latency for every image:

- client-observed total time
- server time
- model time
- whether the image met the 5 second target

It also reports batch-level:

- average
- median
- P95
- target hit rate
- expected verdict match rate for named fixtures

For command-line benchmarking against a running local or deployed app:

```bash
npm run benchmark -- --url http://localhost:3000 --iterations 1 --concurrency 2
```

For a deployed app:

```bash
npm run benchmark -- --url https://your-vercel-app.vercel.app --iterations 3 --concurrency 3
```

The benchmark sends the PNG fixtures in `test-labels/` to `/api/analyze` and prints per-image timings plus aggregate P50/P95/average metrics.
It also reports the final image detail mode and whether adaptive analysis needed a high-detail retry.
The benchmark request timeout defaults to 30 seconds and can be changed with `--request-timeout 45000`.

## Reading Slow Results

The UI reports three useful timing values:

- `client` is the browser-observed total for one image, including browser image compression, upload, Vercel/API time, model time, validation, and response parsing.
- `server` is the time spent inside `/api/analyze`.
- `model` is the time spent waiting for the OpenAI model response.

Per-image timing starts when a worker begins that item, so it does not include time spent waiting in the queue behind earlier images. If one image shows 60-100+ seconds, check its detail panel and record:

- file name
- verdict and expected verdict
- client/server/model times
- image detail mode
- number of attempts
- retry reason, if any

If `model` time is also high, the outlier came from the model request or provider/network latency. If `client` is high but `server` and `model` are normal, the outlier is more likely browser upload, local network, or response handling. For repeatable benchmark numbers, run the same batch at concurrency `2`, `3`, and `4`, then compare P95 and target hit rate.

## Latency Strategy

The deployed default is optimized for a 5 second per-image target:

- The browser resizes label images to a maximum side of 1200 pixels and sends JPEG at 0.78 quality.
- The model extracts only visible label evidence from the image. Application text is parsed and compared in code.
- `OPENAI_IMAGE_DETAIL=adaptive` starts with low image detail for speed.
- If the fast pass has low confidence, poor image quality, missing required evidence, or no government warning evidence, the API retries once with high image detail.
- `OPENAI_REQUEST_TIMEOUT_MS=10000` caps each model request attempt so an outlier cannot run for 60-100+ seconds.
- `OPENAI_TRANSIENT_RETRIES=1` retries one transient timeout, rate-limit, or server error before returning an item-level API error.
- The browser also has a 30 second per-image request cap so the batch keeps moving if a serverless request stalls.
- The response includes `imageDetail` and `attempts` so benchmarks and detail views show whether a high-detail retry happened.

## Regulatory Sources

This prototype uses common TTB labeling elements described in TTB public guidance and checks the government health warning against 27 CFR 16.21.

Sources:

- TTB Labeling Resources: https://www.ttb.gov/labeling/labeling-resources
- TTB Wine Label Anatomy: https://www.ttb.gov/regulated-commodities/beverage-alcohol/wine/anatomy-of-a-label
- eCFR 27 CFR 16.21: https://www.ecfr.gov/current/title-27/chapter-I/subchapter-A/part-16/subpart-C/section-16.21
- OpenAI Images and Vision guide: https://developers.openai.com/api/docs/guides/images-vision
- OpenAI Models: https://developers.openai.com/api/docs/models
- Vercel GitHub deploys: https://vercel.com/docs/git/vercel-for-github
- Vercel Environment Variables: https://vercel.com/docs/environment-variables

## Assumptions And Tradeoffs

- Scope is common fields only, not commodity-specific beer/wine/spirits rule coverage.
- The AI model extracts text and visual cues; code makes the pass/fail decision.
- Warning text is strict. Ordinary brand capitalization differences are tolerated.
- Boldness of the warning heading is inferred by the vision model, then enforced by code.
- Batch processing uses concurrency to improve throughput while still reporting per-image latency.
- A production government system would need stronger security, audit logging, retention controls, accessibility review, and integration with existing authorization systems.
