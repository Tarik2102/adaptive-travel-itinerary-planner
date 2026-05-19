import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export async function GET() {
  try {
    const attractions = await query("SELECT * FROM attractions ORDER BY id ASC");
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