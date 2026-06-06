# Adaptive Travel Itinerary Planner

## Setup

Copy `.env.example` to `.env.local` and fill in the values:

```bash
cp travel-planner-app/.env.example travel-planner-app/.env.local
```

### TomTom API key (live traffic)

Get a free key at https://developer.tomtom.com/ (2 500 requests/day on the free tier).
Set `TOMTOM_API_KEY` in `.env.local`. Without a key the app falls back to the built-in
traffic simulation, which is always available for offline and reproducible evaluation.

### Running the app

```bash
cd travel-planner-app
npm install
npm run dev
```
