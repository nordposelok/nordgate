import type { Fix } from './domain.ts';

export class LocationTracker {
  private watchId: number | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private generation = 0;
  private running = false;
  private polling = false;

  constructor(
    privateApi: Geolocation,
    onFix: (fix: Fix) => void,
    onError: (error: GeolocationPositionError) => void,
  ) {
    this.api = privateApi;
    this.onFix = onFix;
    this.onError = onError;
  }

  private readonly api: Geolocation;
  private readonly onFix: (fix: Fix) => void;
  private readonly onError: (error: GeolocationPositionError) => void;

  start(periodSeconds: number): void {
    this.stop();
    this.running = true;
    const generation = this.generation;
    const success: PositionCallback = (position) => {
      if (!this.running || generation !== this.generation) return;
      this.onFix({ latitude: position.coords.latitude, longitude: position.coords.longitude,
        accuracy: position.coords.accuracy, timestamp: position.timestamp });
    };
    const failure: PositionErrorCallback = (error) => {
      if (this.running && generation === this.generation) this.onError(error);
    };
    try {
      this.watchId = this.api.watchPosition(success, failure, {
        enableHighAccuracy: true, maximumAge: 2_000, timeout: 15_000,
      });
    } catch {
      this.onError({ code: 2, message: 'Геопозиция недоступна.', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 });
    }
    // A synchronous permission failure can stop us before watchPosition returns.
    if (!this.running || generation !== this.generation) {
      if (this.watchId !== null) this.api.clearWatch(this.watchId);
      this.watchId = null;
      return;
    }
    const poll = () => {
      if (this.polling || !this.running || generation !== this.generation) return;
      this.polling = true;
      const finish = () => { if (generation === this.generation) this.polling = false; };
      try {
        this.api.getCurrentPosition((position) => { finish(); success(position); }, (error) => { finish(); failure(error); }, {
          enableHighAccuracy: true, maximumAge: 0, timeout: 12_000,
        });
      } catch {
        finish();
        failure({ code: 2, message: 'Геопозиция недоступна.', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 });
      }
    };
    this.timer = setInterval(poll, periodSeconds * 1_000);
    poll();
  }

  stop(): void {
    this.running = false;
    this.generation += 1;
    this.polling = false;
    if (this.watchId !== null) this.api.clearWatch(this.watchId);
    if (this.timer !== null) clearInterval(this.timer);
    this.watchId = null;
    this.timer = null;
  }
}
