import { calculateHaversineDistanceKm, type Coordinates } from "@/lib/routing";
import type { Attraction } from "@/types/attraction";
import type { ItineraryItem, RankedAttraction } from "@/types/itinerary";
import type { TransportMode } from "@/types/preference";

// Structural equivalents of ItineraryCandidate / RouteOrderingOptions from
// itinerary-feasibility.ts — defined here to avoid a circular import.
type OrderableCandidateAttraction = {
  attraction: Attraction;
  rank: RankedAttraction;
};

type CandidateOrderingOptions = {
  transportMode: TransportMode;
  startLocation?: Coordinates;
};

function attractionCoords(attraction: Attraction): Coordinates {
  return {
    latitude: Number(attraction.latitude),
    longitude: Number(attraction.longitude),
  };
}

function totalDistanceKm(order: number[], coords: Coordinates[]): number {
  let total = 0;
  for (let i = 1; i < order.length; i++) {
    total += calculateHaversineDistanceKm(coords[order[i - 1]], coords[order[i]]);
  }
  return total;
}

function nearestNeighborOrderIndices(
  coords: Coordinates[],
  startIndex: number
): number[] {
  const n = coords.length;
  const visited = new Set<number>([startIndex]);
  const order: number[] = [startIndex];

  while (order.length < n) {
    const current = order[order.length - 1];
    let nearestIndex = -1;
    let nearestDist = Infinity;

    for (let i = 0; i < n; i++) {
      if (visited.has(i)) continue;
      const dist = calculateHaversineDistanceKm(coords[current], coords[i]);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestIndex = i;
      }
    }

    if (nearestIndex === -1) break;
    visited.add(nearestIndex);
    order.push(nearestIndex);
  }

  return order;
}

// Standard 2-opt: try all (i, k) reversals, accept any improvement.
// For N ≤ 8 this is at most 28 pair checks per pass — negligible cost.
function twoOptImproveIndices(order: number[], coords: Coordinates[]): number[] {
  if (order.length <= 3) return order;

  let best = [...order];
  let bestCost = totalDistanceKm(best, coords);
  let improved = true;

  while (improved) {
    improved = false;
    for (let i = 0; i < best.length - 1; i++) {
      for (let k = i + 1; k < best.length; k++) {
        const candidate = [
          ...best.slice(0, i),
          ...best.slice(i, k + 1).reverse(),
          ...best.slice(k + 1),
        ];
        const cost = totalDistanceKm(candidate, coords);
        if (cost < bestCost - 1e-9) {
          best = candidate;
          bestCost = cost;
          improved = true;
        }
      }
    }
  }

  return best;
}

function findNearestCoordIndex(
  coords: Coordinates[],
  location: Coordinates
): number {
  let nearest = 0;
  let nearestDist = calculateHaversineDistanceKm(location, coords[0]);
  for (let i = 1; i < coords.length; i++) {
    const dist = calculateHaversineDistanceKm(location, coords[i]);
    if (dist < nearestDist) {
      nearestDist = dist;
      nearest = i;
    }
  }
  return nearest;
}

function haversineEstimateMinutes(
  distanceKm: number,
  transportMode: TransportMode
): number {
  if (transportMode === "walking") {
    return Math.round((distanceKm / 4.5) * 60);
  }
  return Math.max(1, Math.round((distanceKm / 25) * 60));
}

function bestOrderIndices(
  coords: Coordinates[],
  startLocation?: Coordinates
): number[] {
  if (startLocation) {
    const firstIndex = findNearestCoordIndex(coords, startLocation);
    const nnOrder = nearestNeighborOrderIndices(coords, firstIndex);
    return twoOptImproveIndices(nnOrder, coords);
  }

  // No fixed start: try each candidate as route origin, keep lowest-cost.
  let nnBest = nearestNeighborOrderIndices(coords, 0);
  let nnBestCost = totalDistanceKm(nnBest, coords);

  for (let i = 1; i < coords.length; i++) {
    const nnOrder = nearestNeighborOrderIndices(coords, i);
    const cost = totalDistanceKm(nnOrder, coords);
    if (cost < nnBestCost) {
      nnBestCost = cost;
      nnBest = nnOrder;
    }
  }

  return twoOptImproveIndices(nnBest, coords);
}

// Reorders an ItineraryCandidate[] by proximity (nearest-neighbor + 2-opt).
// Safe to call for any N; returns original slice unchanged for N ≤ 2.
export function optimizeCandidateOrder<T extends OrderableCandidateAttraction>(
  candidates: T[],
  options: CandidateOrderingOptions
): T[] {
  if (candidates.length <= 2) return candidates;

  const coords = candidates.map((c) => attractionCoords(c.attraction));
  const originalOrder = Array.from({ length: candidates.length }, (_, i) => i);
  const originalCost = totalDistanceKm(originalOrder, coords);

  const order = bestOrderIndices(coords, options.startLocation);
  const optimizedCost = totalDistanceKm(order, coords);

  const originalNames = candidates.map((c) => c.attraction.name);
  const optimizedNames = order.map((i) => originalNames[i]);
  const improvementPct =
    originalCost > 0
      ? (((originalCost - optimizedCost) / originalCost) * 100).toFixed(1)
      : "0.0";

  console.log("Stop order optimization:", {
    originalOrder: originalNames,
    optimizedOrder: optimizedNames,
    originalDistanceKm: originalCost.toFixed(3),
    optimizedDistanceKm: optimizedCost.toFixed(3),
    improvementPercent: `${improvementPct}%`,
    transportMode: options.transportMode,
  });

  return order.map((i) => candidates[i]);
}

// Reorders ItineraryItem[] by proximity (nearest-neighbor + 2-opt) and
// recalculates travelTimeFromPrevious for each item using haversine.
// Caller must still run recalculateSchedule to fix plannedStartTime/End.
export function optimizeItemOrderByProximity(
  items: ItineraryItem[],
  transportMode: TransportMode | string
): ItineraryItem[] {
  if (items.length <= 2) return items;

  const mode: TransportMode =
    transportMode === "driving" ? "driving" : "walking";
  const coords: Coordinates[] = items.map((item) => ({
    latitude: Number(item.attraction.latitude),
    longitude: Number(item.attraction.longitude),
  }));

  const originalOrder = Array.from({ length: items.length }, (_, i) => i);
  const originalCost = totalDistanceKm(originalOrder, coords);
  const order = bestOrderIndices(coords);
  const optimizedCost = totalDistanceKm(order, coords);
  const improvementPct =
    originalCost > 0
      ? (((originalCost - optimizedCost) / originalCost) * 100).toFixed(1)
      : "0.0";

  console.log("Traffic adaptation stop order optimization:", {
    originalOrder: items.map((item) => item.attraction.name),
    optimizedOrder: order.map((i) => items[i].attraction.name),
    originalDistanceKm: originalCost.toFixed(3),
    optimizedDistanceKm: optimizedCost.toFixed(3),
    improvementPercent: `${improvementPct}%`,
  });

  return order.map((originalIndex, newIndex) => {
    const item = items[originalIndex];
    if (newIndex === 0) {
      return { ...item, travelTimeFromPrevious: 0 };
    }
    const prevCoords = coords[order[newIndex - 1]];
    const currCoords = coords[originalIndex];
    const distKm = calculateHaversineDistanceKm(prevCoords, currCoords);
    return {
      ...item,
      travelTimeFromPrevious: haversineEstimateMinutes(distKm, mode),
    };
  });
}
