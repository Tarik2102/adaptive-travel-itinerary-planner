import type { WeatherInfo } from "@/lib/weather";

/**
 * Manual weather conditions the itinerary API accepts via `weatherOverride`.
 *
 * "clear" and "rain" are the original evaluation-harness values and their
 * WeatherInfo payloads must never change — benchmark results are keyed to them.
 * The remaining values are additive and exist for the Weather Simulation panel.
 */
export const weatherOverrideValues = [
  "clear",
  "cloudy",
  "rain",
  "thunderstorm",
  "snow",
] as const;

export type WeatherOverride = (typeof weatherOverrideValues)[number];

export const weatherOverrideLabels: Record<WeatherOverride, string> = {
  clear: "Clear",
  cloudy: "Cloudy",
  rain: "Rain",
  thunderstorm: "Thunderstorm",
  snow: "Snow",
};

/**
 * `condition` is the field applyWeatherAdaptation actually gates on, so any
 * override meant to trigger indoor re-scoring must use a string listed in
 * BAD_WEATHER_CONDITIONS ("rain", "snow", "thunderstorm", ...).
 */
const OVERRIDE_WEATHER: Record<WeatherOverride, WeatherInfo> = {
  clear: {
    temperature: 20,
    condition: "clear",
    description: "simulated clear sky",
    isOutdoorRisk: false,
  },
  cloudy: {
    temperature: 18,
    condition: "clouds",
    description: "simulated cloudy sky",
    isOutdoorRisk: false,
  },
  rain: {
    temperature: 15,
    condition: "rain",
    description: "simulated rain",
    isOutdoorRisk: true,
  },
  thunderstorm: {
    temperature: 14,
    condition: "thunderstorm",
    description: "simulated thunderstorm",
    isOutdoorRisk: true,
  },
  snow: {
    temperature: -2,
    condition: "snow",
    description: "simulated snowfall",
    isOutdoorRisk: true,
  },
};

export function createOverrideWeather(
  weatherOverride: WeatherOverride
): WeatherInfo {
  return { ...OVERRIDE_WEATHER[weatherOverride] };
}

export function isOutdoorRiskOverride(
  weatherOverride: WeatherOverride
): boolean {
  return OVERRIDE_WEATHER[weatherOverride].isOutdoorRisk;
}
