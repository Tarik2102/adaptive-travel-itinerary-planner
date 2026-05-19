import { NextResponse } from "next/server";
import { getCurrentWeather } from "@/lib/weather";

export async function GET() {
  try {
    const sarajevo = {
      latitude: 43.8563,
      longitude: 18.4131,
    };

    const weather = await getCurrentWeather(
      sarajevo.latitude,
      sarajevo.longitude
    );

    return NextResponse.json({
      success: true,
      location: "Sarajevo",
      weather,
    });
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      {
        success: false,
        error: "Failed to fetch weather data",
      },
      { status: 500 }
    );
  }
}