# ML Recommendation Service

FastAPI service for the first recommendation milestone. It ranks Sarajevo attractions with a Scikit-learn content-based model using category, budget, setting, rating, and estimated visit duration.

## Install

```powershell
cd ml-service
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
```

Dependencies:

- `fastapi`: exposes `/health` and `/recommend`.
- `uvicorn`: local ASGI development server.
- `scikit-learn`: builds attraction and preference vectors with `DictVectorizer` and ranks with cosine similarity.

## Run

```powershell
cd ml-service
venv\Scripts\activate
uvicorn main:app --reload --port 8000
```

The Next.js app reads `ML_SERVICE_URL`, which should point to:

```env
ML_SERVICE_URL="http://localhost:8000"
```

## Endpoints

`GET /health`

Returns service status.

`POST /recommend`

Accepts preferences and attractions:

```json
{
  "preferences": {
    "interests": ["history", "culture"],
    "budgetLevel": "medium",
    "startTime": "09:00",
    "endTime": "17:00",
    "transportMode": "walking",
    "preferredPace": "moderate",
    "maxAttractions": 5
  },
  "attractions": [
    {
      "id": 1,
      "name": "Bascarsija",
      "description": "Historic market area.",
      "category": "history",
      "latitude": 43.859,
      "longitude": 18.4317,
      "estimated_visit_duration": 90,
      "rating": 4.8,
      "price_level": "free",
      "indoor_outdoor": "outdoor"
    }
  ]
}
```

Returns ranked attraction IDs:

```json
{
  "success": true,
  "rankedAttractions": [
    {
      "id": 1,
      "score": 0.92,
      "reason": "Matches selected interests; Fits selected budget"
    }
  ]
}
```

## Test Locally

1. Start the ML service on port `8000`.
2. Start the Next.js app:

```powershell
cd travel-planner-app
npm run dev
```

3. Open `/planner`, submit preferences, and confirm the generated itinerary appears above the attraction list.
4. You can also send a POST request directly to `http://localhost:8000/recommend` with the JSON body above.
