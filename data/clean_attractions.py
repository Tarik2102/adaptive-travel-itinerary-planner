import pandas as pd

INPUT_FILE = "sarajevo_attractions_raw.csv"
OUTPUT_FILE = "sarajevo_attractions_clean.csv"

required_columns = [
    "name",
    "description",
    "category",
    "latitude",
    "longitude",
    "estimated_visit_duration",
    "rating",
    "price_level",
    "indoor_outdoor",
    "opening_time",
    "closing_time",
]

df = pd.read_csv(INPUT_FILE)

missing_columns = [col for col in required_columns if col not in df.columns]

if missing_columns:
    raise ValueError(f"Missing columns: {missing_columns}")

df = df.drop_duplicates(subset=["name"])

df = df.dropna(subset=["name", "category", "latitude", "longitude"])

df["category"] = df["category"].str.lower().str.strip()
df["price_level"] = df["price_level"].str.lower().str.strip()
df["indoor_outdoor"] = df["indoor_outdoor"].str.lower().str.strip()

df["estimated_visit_duration"] = df["estimated_visit_duration"].astype(int)

df.to_csv(OUTPUT_FILE, index=False)

print(f"Cleaned dataset saved to {OUTPUT_FILE}")
print(df.head())