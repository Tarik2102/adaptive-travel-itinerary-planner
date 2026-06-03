import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export async function GET() {
  try {
    const attractions = await query(`
      SELECT *
      FROM attractions
      WHERE COALESCE(is_active, true) = true
      ORDER BY
        COALESCE(is_featured, false) DESC,
        COALESCE(data_quality_score, 0) DESC,
        COALESCE(popularity_score, 0) DESC,
        name ASC
    `);

    return NextResponse.json({
      success: true,
      data: attractions,
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
