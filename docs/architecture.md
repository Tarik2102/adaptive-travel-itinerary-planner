# System Architecture

The system is a real-time adaptive AI-based travel itinerary planner for Sarajevo.

## Components

1. Frontend: React.js user interface.
2. Backend: Next.js API routes for handling user requests.
3. Database: PostgreSQL for storing attractions, users, itineraries, and logs.
4. ML Service: Python Scikit-learn service for recommendation.
5. Routing API: OSRM or Google Maps API for travel-time estimation.
6. Weather API: OpenWeatherMap API for weather-based adaptation.

## Main Flow

1. User enters preferences.
2. Backend receives preferences.
3. Backend retrieves attractions from PostgreSQL.
4. Recommendation module ranks attractions.
5. Itinerary module creates schedule.
6. Routing API calculates travel times.
7. Weather API checks conditions.
8. Backend returns final itinerary to frontend.