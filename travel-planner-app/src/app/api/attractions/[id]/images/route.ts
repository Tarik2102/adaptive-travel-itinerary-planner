import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import type { AttractionImage } from "@/types/attraction";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const attractionId = parseInt(id, 10);

  if (isNaN(attractionId)) {
    return NextResponse.json(
      { success: false, error: "Invalid attraction id" },
      { status: 400 }
    );
  }

  try {
    const rows = await query<AttractionImage>(
      `SELECT * FROM attraction_images
       WHERE attraction_id = $1
       ORDER BY is_primary DESC, sort_order ASC`,
      [attractionId]
    );

    return NextResponse.json({ success: true, data: rows });
  } catch (error) {
    console.error("Database error:", error);

    return NextResponse.json(
      { success: false, error: "Failed to fetch images" },
      { status: 500 }
    );
  }
}
