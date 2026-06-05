import { NextResponse } from "next/server";
import { resolvePreferredAttractions } from "@/lib/attraction-source-priority";
import { query } from "@/lib/db";
import type { Attraction } from "@/types/attraction";

export async function GET() {
  try {
    const rows = await query(`
      SELECT *
      FROM attractions
      WHERE COALESCE(is_active, true) = true
      ORDER BY
        COALESCE(is_featured, false) DESC,
        COALESCE(data_quality_score, 0) DESC,
        COALESCE(popularity_score, 0) DESC,
        name ASC
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
