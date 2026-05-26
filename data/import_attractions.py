import os
import pandas as pd
import psycopg2
from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[1]

load_dotenv(ROOT_DIR / "travel-planner-app" / ".env.local")

DATABASE_URL = os.getenv("DATABASE_URL")
CSV_FILE = "sarajevo_attractions_clean.csv"

df = pd.read_csv(CSV_FILE)

conn = psycopg2.connect(DATABASE_URL)
cur = conn.cursor()

for _, row in df.iterrows():
    cur.execute(
        """
        INSERT INTO attractions (
            name,
            description,
            category,
            latitude,
            longitude,
            estimated_visit_duration,
            rating,
            price_level,
            indoor_outdoor,
            opening_time,
            closing_time
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT DO NOTHING;
        """,
        (
            row["name"],
            row["description"],
            row["category"],
            row["latitude"],
            row["longitude"],
            row["estimated_visit_duration"],
            row["rating"],
            row["price_level"],
            row["indoor_outdoor"],
            row["opening_time"],
            row["closing_time"],
        ),
    )

conn.commit()
cur.close()
conn.close()

print("Attractions imported successfully.")
