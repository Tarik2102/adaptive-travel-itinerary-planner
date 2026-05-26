# API Endpoints

This project uses a Next.js backend in `travel-planner-app/src/app/api` plus a Python FastAPI recommendation service in `ml-service`.

## Next.js App

Run the app:

```powershell
cd travel-planner-app
npm run dev
```

Expected local base URL:

```text
http://localhost:3000
```

### GET /api/health

Returns backend health metadata.

### GET /api/attractions

Returns attractions from PostgreSQL.

Response shape:

```json
{
  "success": true,
  "data": []
}
```

### GET /api/weather

Returns current Sarajevo weather using the configured weather utility and `OPENWEATHER_API_KEY`.

### GET /api/routing

Returns a sample travel-time calculation using the shared routing utility.

### POST /api/itinerary

Generates an initial itinerary from user preferences.

Request:

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
  }
}
```

Behavior:

1. Validates preferences.
2. Loads attractions from PostgreSQL.
3. Sends preferences and attractions to `ML_SERVICE_URL`.
4. Builds a time-window itinerary from ranked attractions.
5. Calculates travel time between consecutive attractions with the existing routing utilities.

Success response:

```json
{
  "success": true,
  "itinerary": {
    "items": [
      {
        "attraction": {
          "id": 1,
          "name": "Bascarsija",
          "description": "Historic market area.",
          "category": "history",
          "latitude": 43.859,
          "longitude": 18.4317,
          "estimated_visit_duration": 90,
          "rating": 4.8,
          "price_level": "free",
          "indoor_outdoor": "outdoor",
          "opening_time": "09:00:00",
          "closing_time": "17:00:00"
        },
        "score": 0.92,
        "reason": "Matches selected interests; Fits selected budget",
        "plannedStartTime": "09:00",
        "plannedEndTime": "10:30",
        "travelTimeFromPrevious": 0
      }
    ],
    "totalVisitTime": 90,
    "totalTravelTime": 0,
    "totalDuration": 90,
    "feasibilityStatus": "feasible"
  }
}
```

If the Python service is unavailable, the route returns HTTP `502` with:

```json
{
  "success": false,
  "error": "Recommendation service request failed"
}
```

## Python Recommendation Service

Install dependencies:

```powershell
cd ml-service
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
```

Run the service:

```powershell
uvicorn main:app --reload --port 8000
```

The Next.js app expects:

```env
ML_SERVICE_URL="http://localhost:8000"
```

### GET /health

Returns:

```json
{
  "status": "ok",
  "service": "recommendation-service"
}
```

### POST /recommend

Ranks attractions using Scikit-learn feature vectors and cosine similarity.

Request:

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

Response:

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

## Test Itinerary Generation

1. Start PostgreSQL with the existing `DATABASE_URL`.
2. Start the ML service on port `8000`.
3. Start the Next.js app with `npm run dev`.
4. Open `http://localhost:3000/planner`.
5. Select preferences and submit the form.
6. Confirm a generated itinerary appears above the attraction list.
