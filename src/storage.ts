import { DEFAULT_SETTINGS, normalizeSettings } from './domain.ts';
import type { Settings } from './domain.ts';

const KEY = 'nordgate:settings:v1';

export function loadSettings(): Settings {
  try { return normalizeSettings(JSON.parse(localStorage.getItem(KEY) ?? 'null')); }
  catch { return { ...DEFAULT_SETTINGS }; }
}

export function saveSettings(settings: Settings): boolean {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); return true; }
  catch { return false; }
}
