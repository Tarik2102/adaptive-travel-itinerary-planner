import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    service: "travel-itinerary-backend",
    timestamp: new Date().toISOString(),
  });
}