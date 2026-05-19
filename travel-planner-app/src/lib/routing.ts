export type Coordinates = {
  latitude: number;
  longitude: number;
};

export function calculateHaversineDistanceKm(
  from: Coordinates,
  to: Coordinates
): number {
  const R = 6371;

  const dLat = ((to.latitude - from.latitude) * Math.PI) / 180;
  const dLon = ((to.longitude - from.longitude) * Math.PI) / 180;

  const lat1 = (from.latitude * Math.PI) / 180;
  const lat2 = (to.latitude * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLon / 2) *
      Math.sin(dLon / 2) *
      Math.cos(lat1) *
      Math.cos(lat2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

export function estimateWalkingTimeMinutes(distanceKm: number): number {
  const averageWalkingSpeedKmH = 4.5;
  return Math.round((distanceKm / averageWalkingSpeedKmH) * 60);
}

export async function getOsrmRouteTime(
  from: Coordinates,
  to: Coordinates
): Promise<number> {
  const baseUrl = process.env.OSRM_BASE_URL || "https://router.project-osrm.org";

  const url = `${baseUrl}/route/v1/driving/${from.longitude},${from.latitude};${to.longitude},${to.latitude}?overview=false`;

  try {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error("Failed to fetch OSRM route");
    }

    const data = await response.json();

    if (!data.routes || data.routes.length === 0) {
      throw new Error("No route found");
    }

    const durationSeconds = data.routes[0].duration;

    return Math.round(durationSeconds / 60);
  } catch {
    const distanceKm = calculateHaversineDistanceKm(from, to);
    return estimateWalkingTimeMinutes(distanceKm);
  }
}