import { NextResponse } from "next/server";
import { getOsrmRouteTime } from "@/lib/routing";

export async function GET() {
  try {
    const bascarsija = {
      latitude: 43.8590,
      longitude: 18.4317,
    };

    const cityHall = {
      latitude: 43.8580,
      longitude: 18.4345,
    };

    const travelTime = await getOsrmRouteTime(bascarsija, cityHall);

    return NextResponse.json({
      success: true,
      from: "Baščaršija",
      to: "Sarajevo City Hall",
      travelTimeMinutes: travelTime,
    });
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      {
        success: false,
        error: "Failed to calculate route",
      },
      { status: 500 }
    );
  }
}