# Project Snap 📸

**Your wardrobe, understood by AI — styled and shared live.**

Built for the AI Fashion Tech Hackathon. Project Snap is a smart wardrobe
inventory system: snap photos of what you own, and an AI personal stylist
picks real outfits from *your actual closet* — then lets you take the whole
experience live over video.

## The two layers

- **Google Gemini** (the AI brain) — tags every wardrobe photo with category,
  color, style, and season; composes outfit suggestions from your real
  inventory; rates outfit photos.
- **Vonage Video API** (the communication layer) — turns the styling
  experience into a live, shareable session: a stylist call, a live shopping
  stream, or a Fashion Week lookbook watch-party.

## Features (mapped to the challenge prompts)

| Challenge idea | Where it lives |
|---|---|
| Smart wardrobe inventory | `Wardrobe` tab — upload a photo, Gemini auto-tags it |
| AI personal stylist | `AI Stylist` tab — describe an occasion, get a real outfit from your closet |
| Outfit rating bot | `Rate My Fit` tab — upload a fit pic, get a score + feedback |
| Live shopping stream / stylist call | `Live Session` tab — Vonage Video room |

## Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Configure environment
```bash
cp .env.example .env
```
- **Gemini**: grab a free key from [Google AI Studio](https://aistudio.google.com/apikey)
  and set `GEMINI_API_KEY`.
- **Vonage Video API**: create a Video API application at the
  [Vonage Developer Dashboard](https://developer.vonage.com/en/vonage-video/overview),
  download its `private.key` file into the project root, and set
  `VONAGE_APPLICATION_ID` (the path defaults to `./private.key`).

### 3. Run it
```bash
npm run dev
```
Open http://localhost:3000

## Architecture

The server is stateless — it never stores wardrobe data. Each visitor's
wardrobe (photos + Gemini's tags) lives entirely in **their own browser's
localStorage**. That's what lets many hackathon attendees use the same
deployed URL at once without seeing or overwriting each other's closets, and
it means the server has no disk state to lose on restart/redeploy.

```
public/            static frontend (vanilla JS, no build step)
  app.js            owns the wardrobe in localStorage; resizes photos
                     client-side before sending them to /analyze
server/
  index.js         express app entry point (stateless)
  routes/
    wardrobe.js     POST /analyze — photo in, Gemini tags out, nothing stored
    outfit.js       /suggest (stylist) and /rate (rating bot) — the client
                     sends its wardrobe catalog with each /suggest call
    video.js        create Vonage sessions + tokens
  services/
    gemini.js       all Gemini prompts/calls live here
    vonage.js       Vonage Video session/token helpers
```

## Google Cloud

This app talks to Gemini via an AI Studio API key (no GCP project required
for that path). A GCP project (`project-snap-e9fe4f`) is set up alongside
this repo for anything that benefits from it during/after the hackathon —
e.g. Cloud Run deployment or upgrading to Vertex AI. See [`GCP.md`](./GCP.md)
for project details.

## Demo script (for judges)

1. Upload 4-5 wardrobe photos live → show Gemini's auto-tagging.
2. Type a request in AI Stylist ("dinner date, it might rain") → show it
   picks real items from the wardrobe you just added, with reasoning.
3. Start a Live Session, have a teammate join from their phone → rate their
   outfit live using the rating bot.
