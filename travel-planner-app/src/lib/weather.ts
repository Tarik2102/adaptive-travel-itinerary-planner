export type WeatherInfo = {
  temperature: number;
  condition: string;
  description: string;
  isOutdoorRisk: boolean;
};

export async function getCurrentWeather(
  latitude: number,
  longitude: number,
  signal?: AbortSignal
): Promise<WeatherInfo> {
  const apiKey = process.env.OPENWEATHER_API_KEY;

  if (!apiKey) {
    throw new Error("Missing OpenWeatherMap API key");
  }

  const url = `https://api.openweathermap.org/data/2.5/weather?lat=${latitude}&lon=${longitude}&appid=${apiKey}&units=metric`;

  const response = await fetch(url, { signal });

  if (!response.ok) {
    throw new Error("Failed to fetch weather data");
  }

  const data = await response.json();

  const condition = data.weather?.[0]?.main?.toLowerCase() || "unknown";
  const description = data.weather?.[0]?.description || "unknown";
  const temperature = data.main?.temp;

  const riskyConditions = [
    "rain",
    "snow",
    "thunderstorm",
    "drizzle",
    "squall",
    "tornado",
  ];

  return {
    temperature,
    condition,
    description,
    isOutdoorRisk: riskyConditions.includes(condition),
  };
}
