from __future__ import annotations

from typing import Literal

from fastapi import FastAPI
from pydantic import BaseModel, Field
from sklearn.feature_extraction import DictVectorizer
from sklearn.metrics.pairwise import cosine_similarity


BudgetLevel = Literal["free", "low", "medium", "high"]
TransportMode = Literal["walking", "driving"]
PreferredPace = Literal["relaxed", "moderate", "fast"]

PRICE_RANK: dict[str, int] = {
    "free": 0,
    "low": 1,
    "medium": 2,
    "high": 3,
}


class Preferences(BaseModel):
    interests: list[str] = Field(default_factory=list)
    budgetLevel: BudgetLevel = "medium"
    startTime: str = "09:00"
    endTime: str = "17:00"
    transportMode: TransportMode = "walking"
    preferredPace: PreferredPace = "moderate"
    maxAttractions: int = Field(default=5, ge=1, le=12)


class Attraction(BaseModel):
    id: int
    name: str
    description: str | None = None
    category: str
    latitude: float
    longitude: float
    estimated_visit_duration: int = Field(default=60, ge=1)
    rating: float | None = Field(default=None, ge=0, le=5)
    price_level: str | None = None
    indoor_outdoor: str | None = None


class RecommendRequest(BaseModel):
    preferences: Preferences
    attractions: list[Attraction]


class RankedAttraction(BaseModel):
    id: int
    score: float
    reason: str


class RecommendResponse(BaseModel):
    success: bool
    rankedAttractions: list[RankedAttraction]


app = FastAPI(title="Travel Planner Recommendation Service", version="0.1.0")


def normalize_label(value: str | None) -> str:
    cleaned = (value or "unknown").strip().lower()
    return cleaned.replace(" ", "_") or "unknown"


def duration_bucket(duration_minutes: int) -> str:
    if duration_minutes <= 45:
        return "short"
    if duration_minutes <= 105:
        return "medium"
    return "long"


def duration_preference_bucket(preferred_pace: PreferredPace) -> dict[str, float]:
    if preferred_pace == "fast":
        return {"duration:short": 1.0, "duration:medium": 0.35}
    if preferred_pace == "relaxed":
        return {"duration:medium": 0.7, "duration:long": 1.0}
    return {"duration:short": 0.55, "duration:medium": 1.0, "duration:long": 0.45}


def scaled_duration(duration_minutes: int) -> float:
    bounded = max(15, min(duration_minutes, 240))
    return bounded / 240


def scaled_rating(rating: float | None) -> float:
    if rating is None:
        return 0.65
    return max(0.0, min(rating, 5.0)) / 5


def affordable_price_features(budget_level: BudgetLevel) -> dict[str, float]:
    budget_rank = PRICE_RANK[budget_level]
    features: dict[str, float] = {}

    for price_level, price_rank in PRICE_RANK.items():
        if price_rank <= budget_rank:
            features[f"price:{price_level}"] = 1.0

    return features


def is_budget_match(budget_level: BudgetLevel, price_level: str | None) -> bool:
    normalized_price = normalize_label(price_level)

    if normalized_price not in PRICE_RANK:
        return True

    return PRICE_RANK[normalized_price] <= PRICE_RANK[budget_level]


def build_attraction_features(attraction: Attraction) -> dict[str, float]:
    category = normalize_label(attraction.category)
    price_level = normalize_label(attraction.price_level)
    setting = normalize_label(attraction.indoor_outdoor)
    duration = duration_bucket(attraction.estimated_visit_duration)

    return {
        f"category:{category}": 1.0,
        f"price:{price_level}": 1.0,
        f"setting:{setting}": 1.0,
        f"duration:{duration}": 1.0,
        "rating_scaled": scaled_rating(attraction.rating),
        "duration_scaled": scaled_duration(attraction.estimated_visit_duration),
    }


def build_preference_features(preferences: Preferences) -> dict[str, float]:
    features: dict[str, float] = {
        "rating_scaled": 1.0,
        "duration_scaled": {
            "fast": 0.25,
            "moderate": 0.5,
            "relaxed": 0.75,
        }[preferences.preferredPace],
    }

    for interest in preferences.interests:
        features[f"category:{normalize_label(interest)}"] = 1.0

    features.update(affordable_price_features(preferences.budgetLevel))
    features.update(duration_preference_bucket(preferences.preferredPace))

    return features


def build_reason(preferences: Preferences, attraction: Attraction) -> str:
    reasons: list[str] = []
    normalized_interests = {normalize_label(interest) for interest in preferences.interests}
    category = normalize_label(attraction.category)

    if category in normalized_interests:
        reasons.append("Matches selected interests")

    if is_budget_match(preferences.budgetLevel, attraction.price_level):
        reasons.append("Fits selected budget")

    if attraction.rating is not None and attraction.rating >= 4.5:
        reasons.append("Highly rated")

    bucket = duration_bucket(attraction.estimated_visit_duration)
    if bucket in duration_preference_bucket(preferences.preferredPace):
        reasons.append("Fits preferred pace")

    return "; ".join(reasons) if reasons else "Closest available attraction match"


def score_attraction(
    base_similarity: float,
    preferences: Preferences,
    attraction: Attraction,
) -> float:
    normalized_interests = {normalize_label(interest) for interest in preferences.interests}
    category = normalize_label(attraction.category)
    bonus = 0.0

    if category in normalized_interests:
        bonus += 0.12

    if is_budget_match(preferences.budgetLevel, attraction.price_level):
        bonus += 0.06

    if attraction.rating is not None and attraction.rating >= 4.5:
        bonus += 0.04

    score = (base_similarity * 0.86) + bonus
    return round(min(score, 1.0), 4)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "recommendation-service"}


@app.post("/recommend", response_model=RecommendResponse)
def recommend(request: RecommendRequest) -> RecommendResponse:
    if not request.attractions:
        return RecommendResponse(success=True, rankedAttractions=[])

    preference_features = build_preference_features(request.preferences)
    attraction_features = [
        build_attraction_features(attraction) for attraction in request.attractions
    ]

    vectorizer = DictVectorizer(sparse=True)
    feature_matrix = vectorizer.fit_transform([preference_features, *attraction_features])
    similarities = cosine_similarity(feature_matrix[0:1], feature_matrix[1:]).ravel()

    ranked_attractions = [
        RankedAttraction(
            id=attraction.id,
            score=score_attraction(
                float(similarity),
                request.preferences,
                attraction,
            ),
            reason=build_reason(request.preferences, attraction),
        )
        for attraction, similarity in zip(request.attractions, similarities, strict=True)
    ]

    ranked_attractions.sort(key=lambda item: item.score, reverse=True)
    return RecommendResponse(success=True, rankedAttractions=ranked_attractions)
