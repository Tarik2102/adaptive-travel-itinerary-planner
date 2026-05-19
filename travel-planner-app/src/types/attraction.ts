export type Attraction = {
  id: number;
  name: string;
  description: string | null;
  category: string;
  latitude: string | number;
  longitude: string | number;
  estimated_visit_duration: number;
  rating: string | number | null;
  price_level: string | null;
  indoor_outdoor: string | null;
  opening_time: string | null;
  closing_time: string | null;
  created_at?: string;
};