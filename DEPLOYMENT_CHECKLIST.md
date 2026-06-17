# Tonight Deployment Checklist

Use this after the code is ready.

## 1. Install Local Tools

Install:

- Node.js 20 or newer: https://nodejs.org/
- Git: https://git-scm.com/downloads

Restart PowerShell after installing them.

Confirm:

```bash
node --version
npm --version
git --version
```

## 2. Create OpenAI API Key

1. Open https://platform.openai.com/
2. Sign in.
3. Add billing or credits.
4. Create an API key.
5. In this project folder, create `.env` from `.env.example`.
6. Paste the key into `.env`:

```bash
OPENAI_API_KEY=sk-your-real-key
OPENAI_MODEL=gpt-5.4-mini
OPENAI_IMAGE_DETAIL=adaptive
OPENAI_RETRY_CONFIDENCE=0.72
OPENAI_REQUEST_TIMEOUT_MS=10000
OPENAI_TRANSIENT_RETRIES=1
```

Run:

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

Click **Load samples**, then **Run verification**.

## 3. Create GitHub Repository

In PowerShell from this folder:

```bash
git init
git add .
git commit -m "Build alcohol label verification prototype"
```

On GitHub:

1. Create a new repository.
2. Do not add a README or .gitignore from GitHub.
3. Copy the push commands GitHub shows.

They will look like:

```bash
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git branch -M main
git push -u origin main
```

## 4. Deploy On Vercel

1. Open https://vercel.com/
2. Continue with GitHub.
3. Click **Add New Project**.
4. Import your GitHub repository.
5. Add environment variables:

```text
OPENAI_API_KEY = your real OpenAI key
OPENAI_MODEL = gpt-5.4-mini
OPENAI_IMAGE_DETAIL = adaptive
OPENAI_RETRY_CONFIDENCE = 0.72
OPENAI_REQUEST_TIMEOUT_MS = 10000
OPENAI_TRANSIENT_RETRIES = 1
```

6. Click **Deploy**.

When it finishes, copy the production URL. That is the deployed application URL for the take-home.

## 5. Run Latency Benchmark

After deployment:

```bash
npm run benchmark -- --url https://YOUR-VERCEL-URL.vercel.app --iterations 3 --concurrency 3
```

Save the output. It reports:

- per-image latency
- server latency
- model latency
- P50
- P95
- average
- target hit rate for the 5 second goal

## 6. Final Submission

Submit:

- GitHub repository URL
- Vercel deployed app URL
- A short note that benchmark results are available from `npm run benchmark`
