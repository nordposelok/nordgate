export interface Gate {
  id: number;
  label: string;
  phone: string;
  latitude: number;
  longitude: number;
}

export interface Fix {
  latitude: number;
  longitude: number;
  accuracy: number;
  timestamp: number;
}

export const FRESH_FOR_MS = 30_000;
export const MAX_HINT_ACCURACY = 100;

export function parseGates(value: unknown): Gate[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error('База ворот пуста.');
  const ids = new Set<number>();
  return value.map((item: unknown) => {
    if (item === null || typeof item !== 'object') throw new Error('Некорректная запись ворот.');
    const entry = item as Record<string, unknown>;
    const { id, label, phone, latitude, longitude } = entry;
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1 || ids.has(id)
      || typeof label !== 'string' || !label.trim() || label.length > 100
      || typeof phone !== 'string' || !/^\+[1-9]\d{6,14}$/.test(phone)
      || typeof latitude !== 'number' || !Number.isFinite(latitude) || Math.abs(latitude) > 90
      || typeof longitude !== 'number' || !Number.isFinite(longitude) || Math.abs(longitude) > 180) {
      throw new Error('Проверьте названия, номера, координаты и уникальность id в базе ворот.');
    }
    ids.add(id);
    return { id, label: label.trim(), phone, latitude, longitude };
  });
}

export function isFreshFix(fix: Fix | null, now = Date.now()): fix is Fix {
  return fix !== null && Number.isFinite(fix.latitude) && Math.abs(fix.latitude) <= 90
    && Number.isFinite(fix.longitude) && Math.abs(fix.longitude) <= 180
    && Number.isFinite(fix.accuracy) && fix.accuracy >= 0
    && Number.isFinite(fix.timestamp) && fix.timestamp <= now + 1_000
    && now - fix.timestamp <= FRESH_FOR_MS;
}

export function canSuggest(fix: Fix | null, now = Date.now()): fix is Fix {
  return isFreshFix(fix, now) && fix.accuracy <= MAX_HINT_ACCURACY;
}

export function distanceMeters(from: Pick<Fix, 'latitude' | 'longitude'>, to: Pick<Gate, 'latitude' | 'longitude'>): number {
  const rad = (degrees: number) => degrees * Math.PI / 180;
  const dLat = rad(to.latitude - from.latitude);
  const dLon = rad(to.longitude - from.longitude);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(from.latitude)) * Math.cos(rad(to.latitude)) * Math.sin(dLon / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(Math.min(1, a)), Math.sqrt(Math.max(0, 1 - a)));
}

export function formatDistance(meters: number): string {
  return meters < 1000 ? `${Math.round(meters)} м` : `${(meters / 1000).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} км`;
}

export type Direction = 'outside' | 'approaching' | 'receding';
export interface Proximity {
  direction: Direction;
  distance: number | null;
  reference: number;
  quietUntil: number;
}

export function emptyProximity(quietUntil = 0): Proximity {
  return { direction: 'outside', distance: null, reference: 0, quietUntil };
}

// Same 100 / 120 / 25 m hysteresis as the MAUI app. A tap only quiets
// the hint for 20 seconds: a browser cannot observe a successful phone call.
export function updateProximity(previous: Proximity, distance: number): Proximity {
  if (!Number.isFinite(distance) || distance < 0) return emptyProximity(previous.quietUntil);
  const next = { ...previous, distance };
  if (distance > 120) return { ...emptyProximity(), distance };
  switch (previous.direction) {
    case 'outside':
      if (distance <= 100) { next.direction = 'approaching'; next.reference = distance; }
      break;
    case 'approaching':
      if (distance < previous.reference) next.reference = distance;
      else if (distance > previous.reference + 25) { next.direction = 'receding'; next.reference = distance; }
      break;
    case 'receding':
      if (distance > previous.reference) next.reference = distance;
      else if (distance < previous.reference - 25) { next.direction = 'approaching'; next.reference = distance; }
      break;
  }
  return next;
}

export function isHighlighted(state: Proximity, now = Date.now()): boolean {
  return state.direction === 'approaching' && state.distance !== null
    && state.distance <= 100 && now >= state.quietUntil;
}

export function quietHint(state: Proximity, now = Date.now()): Proximity {
  return { ...state, quietUntil: now + 20_000 };
}

export interface Settings {
  showDistances: boolean;
  showCurrentPosition: boolean;
  timerPeriodSeconds: number;
  locationEnabled: boolean;
}

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  showDistances: true,
  showCurrentPosition: false,
  timerPeriodSeconds: 15,
  locationEnabled: false,
});

export function normalizeSettings(value: unknown): Settings {
  const data = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const flag = (key: keyof Settings) => typeof data[key] === 'boolean' ? data[key] as boolean : DEFAULT_SETTINGS[key] as boolean;
  const period = data.timerPeriodSeconds;
  return {
    showDistances: flag('showDistances'),
    showCurrentPosition: flag('showCurrentPosition'),
    locationEnabled: flag('locationEnabled'),
    timerPeriodSeconds: typeof period === 'number' && Number.isFinite(period)
      ? Math.min(600, Math.max(1, Math.round(period))) : DEFAULT_SETTINGS.timerPeriodSeconds,
  };
}
