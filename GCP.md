# Google Cloud project

- **Project name**: Project Snap
- **Project ID**: `project-snap-e9fe4f`
- **Created**: 2026-09-12 (hackathon day), via the Gemini CLI in an interactive
  terminal — the sandboxed/bridged shell used for the rest of this repo's
  setup hit a Google Workspace reauth policy that blocks non-interactive
  `gcloud` calls (`hejustino@hjdconsulting.ca` requires live re-verification
  on sensitive scopes), so project creation had to happen in a real terminal.

## APIs enabled

| API | Status |
|---|---|
| `generativelanguage.googleapis.com` (Gemini API) | ✅ Enabled |
| `run.googleapis.com` (Cloud Run) | ⏸ Pending — needs a billing account attached first |

No billing account is attached (intentional — not needed for the hackathon
build, which calls Gemini via an AI Studio API key, not this project).

## If you want to deploy later (Cloud Run)

1. Link a billing account to `project-snap-e9fe4f` in the
   [Cloud Console](https://console.cloud.google.com/billing/linkedaccount?project=project-snap-e9fe4f).
2. Enable the remaining APIs:
   ```bash
   gcloud services enable run.googleapis.com artifactregistry.googleapis.com --project=project-snap-e9fe4f
   ```
3. Ask Claude/Gemini to add a `Dockerfile` and deploy with
   `gcloud run deploy`.

## Note on the Gemini API key vs. this project

The app's `GEMINI_API_KEY` (see `.env.example`) comes from
[Google AI Studio](https://aistudio.google.com/apikey) and works
independently of this GCP project — AI Studio keys aren't scoped to a
specific project by default. This project exists for anything that *does*
need one: Cloud Run deployment, or upgrading the Gemini calls in
`server/services/gemini.js` from an API key to Vertex AI using
`GOOGLE_CLOUD_PROJECT=project-snap-e9fe4f`.
