CREATE TABLE attractions (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    category VARCHAR(100) NOT NULL,
    latitude DECIMAL(10, 7) NOT NULL,
    longitude DECIMAL(10, 7) NOT NULL,
    estimated_visit_duration INTEGER NOT NULL,
    rating DECIMAL(2, 1),
    price_level VARCHAR(50),
    indoor_outdoor VARCHAR(50),
    opening_time TIME,
    closing_time TIME,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE user_preferences (
    id SERIAL PRIMARY KEY,
    interests TEXT[] NOT NULL,
    budget_level VARCHAR(50),
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    max_attractions INTEGER,
    transport_mode VARCHAR(50),
    preferred_pace VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE itineraries (
    id SERIAL PRIMARY KEY,
    preference_id INTEGER REFERENCES user_preferences(id),
    total_duration INTEGER,
    total_travel_time INTEGER,
    feasibility_status VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE itinerary_items (
    id SERIAL PRIMARY KEY,
    itinerary_id INTEGER REFERENCES itineraries(id) ON DELETE CASCADE,
    attraction_id INTEGER REFERENCES attractions(id),
    visit_order INTEGER NOT NULL,
    planned_start_time TIME,
    planned_end_time TIME,
    travel_time_from_previous INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE reoptimization_logs (
    id SERIAL PRIMARY KEY,
    itinerary_id INTEGER REFERENCES itineraries(id) ON DELETE CASCADE,
    trigger_reason TEXT NOT NULL,
    original_total_duration INTEGER,
    updated_total_duration INTEGER,
    response_time_ms INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE evaluation_logs (
    id SERIAL PRIMARY KEY,
    scenario_name VARCHAR(255),
    recommendation_relevance DECIMAL(5, 2),
    itinerary_feasibility_rate DECIMAL(5, 2),
    total_travel_time INTEGER,
    system_response_time_ms INTEGER,
    baseline_type VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);