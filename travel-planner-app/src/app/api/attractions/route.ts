import { NextResponse } from "next/server";
import { resolvePreferredAttractions } from "@/lib/attraction-source-priority";
import { query } from "@/lib/db";
import type { Attraction } from "@/types/attraction";

export async function GET() {
  try {
    const rows = await query(`
      SELECT a.*,
        (
          SELECT ai.thumbnail_url
          FROM attraction_images ai
          WHERE ai.attraction_id = a.id AND ai.is_primary = true
          LIMIT 1
        ) AS thumbnail_url
      FROM attractions a
      WHERE COALESCE(a.is_active, true) = true
      ORDER BY
        COALESCE(a.is_featured, false) DESC,
        COALESCE(a.data_quality_score, 0) DESC,
        COALESCE(a.popularity_score, 0) DESC,
        a.name ASC
    `);

    const resolved = resolvePreferredAttractions(rows as unknown as Attraction[]);

    return NextResponse.json({
      success: true,
      data: resolved,
    });
  } catch (error) {
    console.error("Database error:", error);

    return NextResponse.json(
      {
        success: false,
        error: "Failed to fetch attractions",
      },
      { status: 500 }
    );
  }
}
