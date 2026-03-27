export interface BusStop {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

export interface AppState {
  currentLocation: { lat: number; lng: number } | null;
  nextStop: BusStop | null;
  isTracking: boolean;
  error: string | null;
}
