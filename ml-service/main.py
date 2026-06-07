from __future__ import annotations

import unicodedata
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
    primary_category: str | None = None
    secondary_categories: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    latitude: float
    longitude: float
    estimated_visit_duration: int = Field(default=60, ge=1)
    rating: float | None = Field(default=None, ge=0, le=5)
    price_level: str | None = None
    indoor_outdoor: str | None = None
    is_featured: bool = False
    data_quality_score: float | None = Field(default=None, ge=0, le=10)
    popularity_score: float | None = Field(default=None, ge=0, le=10)


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


INTEREST_KEYWORDS: dict[str, tuple[str, ...]] = {
    "history": (
        "history",
        "historic",
        "heritage",
        "old town",
        "ottoman",
        "austro hungarian",
        "war history",
        "siege",
        "memorial",
        "monument",
    ),
    "war_history": (
        "war history",
        "war",
        "siege",
        "memorial",
        "tunnel",
        "battle",
        "conflict",
        "defense",
    ),
    "culture": (
        "culture",
        "cultural",
        "heritage",
        "market",
        "traditional",
        "gallery",
        "public art",
    ),
    "nature": (
        "nature",
        "park",
        "green space",
        "viewpoint",
        "panorama",
        "mountain",
        "river",
        "outdoor",
    ),
    "architecture": (
        "architecture",
        "architectural",
        "building",
        "bridge",
        "city hall",
        "mosque",
        "fountain",
        "facade",
        "vijecnica",
    ),
    "religion": (
        "religion",
        "religious",
        "mosque",
        "church",
        "synagogue",
        "place of worship",
        "islamic",
        "orthodox",
        "catholic",
        "jewish",
    ),
    "museum": (
        "museum",
        "exhibition",
        "gallery",
        "education",
        "memorial museum",
        "collection",
    ),
    "food": (
        "food",
        "restaurant",
        "cafe",
        "fast food",
        "cuisine",
        "bosnian cuisine",
        "bosnian food",
        "local food",
        "traditional bosnian food",
    ),
    "cafe": (
        "cafe",
        "coffee",
        "tea",
        "pastry",
        "dessert",
        "bakery",
        "restaurant",
    ),
    "traditional_bosnian_food": (
        "traditional bosnian food",
        "bosnian food",
        "bosnian cuisine",
        "local food",
        "cuisine",
        "restaurant",
        "cevapi",
        "burek",
    ),
    "local_experience": (
        "local",
        "local market",
        "market",
        "marketplace",
        "bazaar",
        "souvenir",
        "traditional",
        "food",
        "cafe",
    ),
    "shopping": (
        "shopping",
        "shop",
        "retail",
        "mall",
        "market",
        "marketplace",
        "local market",
        "souvenir",
        "bazaar",
    ),
    "viewpoint": (
        "viewpoint",
        "panorama",
        "scenic",
        "lookout",
    ),
    "park": (
        "park",
        "garden",
        "green space",
        "outdoor",
        "recreation",
    ),
    "family": (
        "family",
        "children",
        "kids",
        "playground",
        "park",
        "recreation",
        "zoo",
    ),
    "sport": (
        "sport",
        "sports",
        "recreation",
        "stadium",
        "fitness",
        "swimming",
        "walking",
        "hiking",
    ),
    "entertainment": (
        "entertainment",
        "theatre",
        "cinema",
        "performance",
        "arts centre",
        "nightlife",
    ),
    "theatre": (
        "theatre",
        "theater",
        "performance",
        "stage",
    ),
    "cinema": (
        "cinema",
        "movie",
        "film",
    ),
    "ottoman_heritage": (
        "ottoman",
        "heritage",
        "mosque",
        "islamic",
        "bazaar",
        "old town",
    ),
    "austro_hungarian_heritage": (
        "austro hungarian",
        "austrian",
        "hungarian",
        "architecture",
        "facade",
        "historic",
        "landmark",
    ),
    "modern_sarajevo": (
        "modern",
        "contemporary",
        "urban",
        "shopping",
        "mall",
        "entertainment",
    ),
}


def normalize_search_text(value: str | None) -> str:
    normalized = unicodedata.normalize("NFKD", (value or "").strip().lower())
    without_marks = "".join(
        character for character in normalized if not unicodedata.combining(character)
    )
    cleaned = without_marks.replace("_", " ").replace("-", " ")
    return " ".join(cleaned.split())


def normalize_label(value: str | None) -> str:
    cleaned = normalize_search_text(value or "unknown")
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


def scaled_ten_point_score(score: float | None) -> float:
    if score is None:
        return 0.0
    return max(0.0, min(score, 10.0)) / 10


def attraction_metadata_values(attraction: Attraction) -> list[str]:
    return [
        value
        for value in [
            attraction.category,
            attraction.primary_category,
            *attraction.secondary_categories,
            *attraction.tags,
        ]
        if value
    ]


def labels_from_values(values: list[str | None]) -> set[str]:
    return {normalize_label(value) for value in values if value}


def attraction_search_text(attraction: Attraction) -> str:
    # Secondary categories and tags are included because OSM-imported POIs often
    # carry their best interest signal there rather than in the broad category.
    values = [
        attraction.name,
        attraction.description,
        *attraction_metadata_values(attraction),
    ]
    return " ".join(normalize_search_text(value) for value in values if value)


def contains_search_term(search_text: str, term: str) -> bool:
    if not term:
        return False

    if len(term) <= 3:
        return f" {term} " in f" {search_text} "

    return term in search_text


def expand_interest_terms(interest: str) -> set[str]:
    normalized_interest = normalize_search_text(interest)
    label = normalize_label(interest)
    terms = {normalized_interest, label.replace("_", " ")}
    terms.update(INTEREST_KEYWORDS.get(label, ()))

    if "war" in normalized_interest and "history" in normalized_interest:
        terms.update(INTEREST_KEYWORDS["war_history"])

    return {normalize_search_text(term) for term in terms if term}


def expand_interest_labels(interest: str) -> set[str]:
    return {normalize_label(term) for term in expand_interest_terms(interest)}


def attraction_interest_labels(attraction: Attraction) -> set[str]:
    return labels_from_values(attraction_metadata_values(attraction))


def interest_match_strength(preferences: Preferences, attraction: Attraction) -> float:
    if not preferences.interests:
        return 0.0

    primary_labels = labels_from_values(
        [attraction.category, attraction.primary_category]
    )
    secondary_labels = labels_from_values(attraction.secondary_categories)
    tag_labels = labels_from_values(attraction.tags)
    search_text = attraction_search_text(attraction)
    strengths: list[float] = []

    for interest in preferences.interests:
        interest_labels = expand_interest_labels(interest)
        interest_terms = expand_interest_terms(interest)

        if primary_labels & interest_labels:
            strengths.append(1.0)
        elif secondary_labels & interest_labels:
            strengths.append(0.9)
        elif tag_labels & interest_labels:
            strengths.append(0.8)
        elif any(contains_search_term(search_text, term) for term in interest_terms):
            strengths.append(0.65)

    return max(strengths, default=0.0)


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
    primary_category = normalize_label(attraction.primary_category)
    price_level = normalize_label(attraction.price_level)
    setting = normalize_label(attraction.indoor_outdoor)
    duration = duration_bucket(attraction.estimated_visit_duration)
    features: dict[str, float] = {
        f"category:{category}": 1.0,
        f"primary_category:{primary_category}": 1.0,
        f"price:{price_level}": 1.0,
        f"setting:{setting}": 1.0,
        f"duration:{duration}": 1.0,
        "rating_scaled": scaled_rating(attraction.rating),
        "duration_scaled": scaled_duration(attraction.estimated_visit_duration),
        "data_quality_scaled": scaled_ten_point_score(attraction.data_quality_score),
        "popularity_scaled": scaled_ten_point_score(attraction.popularity_score),
        "featured": 1.0 if attraction.is_featured else 0.0,
    }

    # Secondary categories and tags may be more precise than the broad category
    # for imported attractions, so expose them on the same interest axis.
    for label in attraction_interest_labels(attraction):
        features[f"interest:{label}"] = 1.0

    for label in labels_from_values(attraction.secondary_categories):
        features[f"secondary_category:{label}"] = 1.0

    for label in labels_from_values(attraction.tags):
        features[f"tag:{label}"] = 1.0

    search_text = attraction_search_text(attraction)
    for keywords in INTEREST_KEYWORDS.values():
        for keyword in keywords:
            if contains_search_term(search_text, normalize_search_text(keyword)):
                features[f"interest:{normalize_label(keyword)}"] = 0.65

    return features


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
        for label in expand_interest_labels(interest):
            features[f"interest:{label}"] = 1.0

    features.update(affordable_price_features(preferences.budgetLevel))
    features.update(duration_preference_bucket(preferences.preferredPace))
    features.update(
        {
            "data_quality_scaled": 0.85,
            "popularity_scaled": 0.75,
            "featured": 0.6,
        }
    )

    return features


def build_reason(preferences: Preferences, attraction: Attraction) -> str:
    reasons: list[str] = []

    if interest_match_strength(preferences, attraction) > 0:
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
    metadata_interest_strength = interest_match_strength(preferences, attraction)

    if category in normalized_interests:
        bonus += 0.12

    if metadata_interest_strength > 0:
        bonus += 0.16 * metadata_interest_strength

    if is_budget_match(preferences.budgetLevel, attraction.price_level):
        bonus += 0.06

    if attraction.rating is not None and attraction.rating >= 4.5:
        bonus += 0.04

    if attraction.is_featured:
        bonus += 0.03

    bonus += scaled_ten_point_score(attraction.data_quality_score) * 0.04
    bonus += scaled_ten_point_score(attraction.popularity_score) * 0.03

    score = (base_similarity * 0.78) + bonus
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
