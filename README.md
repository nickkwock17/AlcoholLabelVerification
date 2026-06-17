# AI-Powered Alcohol Label Verification App

Standalone prototype for checking alcohol beverage label images against application text and common TTB label requirements.

The app supports batch image upload, AI-assisted OCR extraction, deterministic compliance checks, and latency benchmarking against a 5 second per-image target.

## What It Does

- Accepts one or more label images.
- Accepts application text for the expected label fields.
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
- Shows benchmark metrics for average, median, P95, and target hit rate.

## Architecture

```text
Browser UI
  -> compresses images to JPEG
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
OPENAI_IMAGE_DETAIL=high
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
   - `OPENAI_IMAGE_DETAIL` set to `high`
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
- pass rate

For command-line benchmarking against a running local or deployed app:

```bash
npm run benchmark -- --url http://localhost:3000 --iterations 1 --concurrency 2
```

For a deployed app:

```bash
npm run benchmark -- --url https://your-vercel-app.vercel.app --iterations 3 --concurrency 3
```

The benchmark sends the PNG fixtures in `test-labels/` to `/api/analyze` and prints per-image timings plus aggregate P50/P95/average metrics.

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
