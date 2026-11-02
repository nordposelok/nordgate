import './styles.css';
import { canSuggest, distanceMeters, emptyProximity, formatDistance, isFreshFix, isHighlighted, normalizeSettings, parseGates, quietHint, updateProximity } from './domain.ts';
import type { Fix, Gate, Proximity } from './domain.ts';
import { LocationTracker } from './location.ts';
import { loadSettings, saveSettings } from './storage.ts';
import { setupPwa } from './pwa.ts';

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element: ${id}`);
  return element as T;
}

let settings = loadSettings();
let gates: Gate[] = [];
let lastFix: Fix | null = null;
let locationError = '';
let locationActive = false;
let pendingPosition = false;
let offlineReady = false;
let offlineUnavailable = false;
let lastAnnouncement = '';
let toastTimer: ReturnType<typeof setTimeout> | undefined;
const states = new Map<number, Proximity>();
const rows = new Map<number, { row: HTMLLIElement; detail: HTMLElement; badge: HTMLElement; link: HTMLAnchorElement }>();

const locationButton = el<HTMLButtonElement>('enable-location');
const settingsDialog = el<HTMLDialogElement>('settings-dialog');
const form = el<HTMLFormElement>('settings-form');

function announce(message: string): void {
  if (message === lastAnnouncement) return;
  lastAnnouncement = message;
  el('geo-status').textContent = message;
}

function toast(message: string): void {
  clearTimeout(toastTimer);
  el('toast').textContent = message;
  el('toast').hidden = false;
  toastTimer = setTimeout(() => { el('toast').hidden = true; }, 6_000);
}

function persistSettings(): void {
  if (!saveSettings(settings)) toast('Настройки применены. Браузер не разрешает сохранить их после закрытия.');
}

function resetHints(): void {
  for (const [id, state] of states) states.set(id, emptyProximity(state.quietUntil));
}

function renderLocation(): void {
  const now = Date.now();
  const fresh = locationActive && !locationError && isFreshFix(lastFix, now);
  const usable = fresh && canSuggest(lastFix, now);
  const panel = el('location-title').closest('section')!;
  panel.classList.toggle('is-live', Boolean(usable));
  el('location-dot').classList.toggle('active', Boolean(usable));
  const buttonText = locationButton.querySelector('span')!;
  locationButton.hidden = false;
  let title = 'Найдём ближайший въезд';
  let description = 'Разрешите геопозицию — подсветим кнопку, когда вы будете рядом с воротами.';
  buttonText.textContent = 'Определить ближайшие';
  el('location-kicker').textContent = 'ПОДСКАЗКА РЯДОМ';
  el('location-note').textContent = 'Координаты остаются на вашем телефоне.';

  if (settings.locationEnabled) {
    if (locationError) {
      title = 'Не удалось определить позицию';
      description = locationError;
      buttonText.textContent = 'Попробовать ещё раз';
    } else if (!locationActive) {
      title = 'Геоподсказки на паузе';
      description = 'Обновим геопозицию, когда вы вернётесь в приложение.';
      locationButton.hidden = true;
    } else if (!fresh) {
      title = pendingPosition ? 'Определяем вашу позицию' : 'Обновляем геопозицию';
      description = 'Список ворот уже доступен. Можно позвонить, не дожидаясь координат.';
      buttonText.textContent = 'Обновить позицию';
    } else if (!usable) {
      title = 'Геопозиция пока неточная';
      description = `Погрешность около ${Math.round(lastFix!.accuracy)} м. Расстояния приблизительные; выберите въезд из списка.`;
      buttonText.textContent = 'Уточнить позицию';
    } else {
      let nearest: { gate: Gate; distance: number } | undefined;
      for (const gate of gates) {
        const distance = states.get(gate.id)?.distance;
        if (distance !== null && distance !== undefined && (!nearest || distance < nearest.distance)) nearest = { gate, distance };
      }
      el('location-kicker').textContent = 'ГЕОПОДСКАЗКИ ВКЛЮЧЕНЫ';
      title = nearest ? `${nearest.gate.label} · ${formatDistance(nearest.distance)}` : 'Геопозиция определена';
      description = nearest && nearest.distance <= 100
        ? 'Ближайший въезд рядом. Для открытия нажмите «Позвонить» в списке.'
        : 'Ближайший въезд. Подсветим кнопку при приближении в пределах 100 метров.';
      el('location-note').textContent = 'Обновляется, пока приложение открыто.';
      locationButton.hidden = true;
    }
  } else if (locationError) {
    title = 'Геоподсказки недоступны';
    description = locationError;
    buttonText.textContent = 'Попробовать ещё раз';
  }
  el('location-title').textContent = title;
  el('location-description').textContent = description;
  for (const gate of gates) {
    const view = rows.get(gate.id)!;
    const state = states.get(gate.id)!;
    const near = usable && isHighlighted(state, now);
    view.row.classList.toggle('is-near', Boolean(near));
    view.badge.hidden = !near;
    view.detail.hidden = !settings.showDistances;
    view.detail.textContent = fresh && state.distance !== null
      ? `${formatDistance(state.distance)}${usable ? '' : ' · примерно'}` : 'Расстояние не определено';
  }
  el('diagnostics').hidden = !settings.showCurrentPosition;
  el('position-text').textContent = lastFix
    ? `${lastFix.latitude.toFixed(6)}, ${lastFix.longitude.toFixed(6)} · ±${Math.round(lastFix.accuracy)} м · ${new Date(lastFix.timestamp).toLocaleTimeString('ru-RU')} ${fresh ? '' : '· данные неактуальны'}`
    : 'Позиция ещё не получена.';
  // Announce state changes, not every GPS distance or one-second refresh.
  const highlighted = gates.filter((gate) => usable && isHighlighted(states.get(gate.id)!, now)).map((gate) => gate.label);
  announce(locationError || (highlighted.length ? `Рядом ворота: ${highlighted.join(', ')}.` : usable ? 'Геоподсказки включены.' : title));
}

function receiveFix(fix: Fix): void {
  if (!isFreshFix(fix) || document.visibilityState !== 'visible') return;
  if (lastFix && fix.timestamp < lastFix.timestamp) return;
  const hadFreshFix = locationActive && !locationError && canSuggest(lastFix);
  if (!hadFreshFix) resetHints();
  lastFix = fix;
  locationError = '';
  pendingPosition = false;
  for (const gate of gates) {
    const distance = distanceMeters(fix, gate);
    const state = states.get(gate.id)!;
    states.set(gate.id, canSuggest(fix) ? updateProximity(state, distance) : { ...emptyProximity(state.quietUntil), distance });
  }
  renderLocation();
}

function receiveError(error: GeolocationPositionError): void {
  pendingPosition = false;
  resetHints();
  if (error.code === 1) {
    settings.locationEnabled = false;
    tracker?.stop();
    locationActive = false;
    persistSettings();
    locationError = 'Доступ к геопозиции закрыт. Разрешите его в настройках Safari или приложения. Можно звонить и без геопозиции.';
  } else {
    locationError = error.code === 3
      ? 'Определение позиции заняло слишком много времени. Попробуйте ещё раз или выберите ворота вручную.'
      : 'iPhone не передал координаты. Проверьте службы геолокации или выберите ворота вручную.';
  }
  renderLocation();
}

const tracker = 'geolocation' in navigator ? new LocationTracker(navigator.geolocation, receiveFix, receiveError) : null;

function startLocation(): void {
  tracker?.stop();
  resetHints();
  lastFix = null;
  locationError = '';
  if (!settings.locationEnabled || document.visibilityState !== 'visible') {
    locationActive = false;
    pendingPosition = false;
    renderLocation();
    return;
  }
  if (!tracker || !window.isSecureContext) {
    locationActive = false;
    settings.locationEnabled = false;
    locationError = 'Геопозиция доступна по защищённой ссылке HTTPS в поддерживаемом браузере. Список ворот работает без неё.';
    persistSettings();
    renderLocation();
    return;
  }
  locationActive = true;
  pendingPosition = true;
  renderLocation();
  tracker.start(settings.timerPeriodSeconds);
}

function buildRows(): void {
  const list = el('gate-list');
  list.replaceChildren();
  rows.clear();
  states.clear();
  for (const gate of gates) {
    states.set(gate.id, emptyProximity());
    const row = document.createElement('li');
    row.className = 'gate-row';
    const marker = document.createElement('span');
    marker.className = 'gate-marker';
    marker.setAttribute('aria-hidden', 'true');
    marker.innerHTML = '<svg viewBox="0 0 24 24"><path d="M5 20V9m0 3h14V8H5m2 0 3 4m3-4 3 4M3 20h4m10 0h4m-2 0v-5"/></svg>';
    const text = document.createElement('div');
    text.className = 'gate-copy';
    const title = document.createElement('h3');
    title.textContent = gate.label;
    const badge = document.createElement('span');
    badge.className = 'near-badge';
    badge.textContent = 'Рядом';
    badge.hidden = true;
    const titleLine = document.createElement('div');
    titleLine.className = 'gate-title';
    titleLine.append(title, badge);
    const detail = document.createElement('p');
    detail.className = 'gate-distance';
    text.append(titleLine, detail);
    const link = document.createElement('a');
    link.href = `tel:${gate.phone}`;
    link.className = 'call-button';
    link.setAttribute('aria-label', `Позвонить: ${gate.label}`);
    link.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3H4a1 1 0 0 0-1 1c0 9.4 7.6 17 17 17a1 1 0 0 0 1-1v-3l-5-2-2 2a13 13 0 0 1-7-7l2-2-2-5Z"/></svg><span>Позвонить</span>';
    link.addEventListener('click', () => {
      states.set(gate.id, quietHint(states.get(gate.id)!));
      renderLocation();
      toast('Подтвердите звонок на iPhone. При необходимости можно позвонить повторно.');
      // Keep the native <a href="tel:..."> navigation inside the user gesture.
    });
    row.append(marker, text, link);
    list.append(row);
    rows.set(gate.id, { row, detail, badge, link });
  }
  el('gate-count').textContent = String(gates.length);
}

let loadingData = false;
async function loadGates(): Promise<void> {
  if (loadingData) return;
  loadingData = true;
  el('loading').hidden = false;
  el('data-error').hidden = true;
  el('retry-data').hidden = true;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(new URL('phones.json', document.baseURI), { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    gates = parseGates(await response.json());
    buildRows();
    if (lastFix && isFreshFix(lastFix)) receiveFix(lastFix);
    renderLocation();
  } catch {
    el('data-error').textContent = 'Не удалось загрузить список ворот. Для первого запуска нужен интернет. Проверьте соединение и попробуйте снова.';
    el('data-error').hidden = false;
    el('retry-data').hidden = false;
  } finally {
    clearTimeout(timeout);
    el('loading').hidden = true;
    loadingData = false;
  }
}

function openDialog(dialog: HTMLDialogElement): void {
  if (!dialog.open) dialog.showModal();
}

for (const dialog of document.querySelectorAll<HTMLDialogElement>('dialog')) {
  dialog.querySelectorAll('.close-dialog').forEach((button) => button.addEventListener('click', () => dialog.close()));
  dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  });
}

el('open-settings').addEventListener('click', () => {
  for (const key of ['locationEnabled', 'showDistances', 'showCurrentPosition'] as const) {
    (form.elements.namedItem(key) as HTMLInputElement).checked = settings[key];
  }
  el<HTMLInputElement>('timer-period').value = String(settings.timerPeriodSeconds);
  el('settings-feedback').hidden = true;
  openDialog(settingsDialog);
});

form.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!form.reportValidity()) return;
  const previous = settings;
  const data = new FormData(form);
  settings = normalizeSettings({
    locationEnabled: data.has('locationEnabled'),
    showDistances: data.has('showDistances'),
    showCurrentPosition: data.has('showCurrentPosition'),
    timerPeriodSeconds: Number(data.get('timerPeriodSeconds')),
  });
  persistSettings();
  settingsDialog.close();
  if (previous.locationEnabled !== settings.locationEnabled || previous.timerPeriodSeconds !== settings.timerPeriodSeconds) startLocation();
  else renderLocation();
});

locationButton.addEventListener('click', () => {
  settings.locationEnabled = true;
  persistSettings();
  startLocation();
});
el('retry-data').addEventListener('click', () => { void loadGates(); });
el('open-install').addEventListener('click', () => openDialog(el<HTMLDialogElement>('install-dialog')));
el('open-help').addEventListener('click', () => openDialog(el<HTMLDialogElement>('help-dialog')));

function renderConnection(): void {
  const element = el('connection-status');
  const text = !navigator.onLine
    ? offlineReady ? 'Без интернета · звонки доступны' : 'Нет интернета'
    : offlineReady ? 'Готово без интернета' : offlineUnavailable ? 'Офлайн-кэш недоступен' : 'Сохраняем для работы без интернета';
  element.classList.toggle('ready', offlineReady);
  element.classList.toggle('offline', !navigator.onLine);
  element.replaceChildren();
  const dot = document.createElement('span');
  dot.setAttribute('aria-hidden', 'true');
  element.append(dot, document.createTextNode(text));
}

window.addEventListener('online', () => { renderConnection(); if (!gates.length) void loadGates(); });
window.addEventListener('offline', renderConnection);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    tracker?.stop();
    locationActive = false;
    pendingPosition = false;
    resetHints();
    renderLocation();
  } else if (settings.locationEnabled) startLocation();
});
window.addEventListener('pagehide', () => { tracker?.stop(); locationActive = false; resetHints(); });
window.addEventListener('pageshow', (event) => { if (event.persisted && settings.locationEnabled) startLocation(); });

const standaloneQuery = window.matchMedia('(display-mode: standalone)');
const renderInstall = () => {
  el('install-card').hidden = standaloneQuery.matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
};
standaloneQuery.addEventListener('change', renderInstall);
renderInstall();
document.querySelectorAll('.app-version').forEach((element) => { element.textContent = __APP_VERSION__; });
el('data-version').textContent = __DATA_VERSION__;
renderConnection();
renderLocation();
void loadGates();
if (settings.locationEnabled) startLocation();
setInterval(() => {
  if (document.visibilityState !== 'visible') return;
  if (lastFix && !isFreshFix(lastFix)) resetHints();
  renderLocation();
}, 1_000);

void setupPwa({
  offlineReady: () => { offlineReady = true; renderConnection(); },
  unavailable: () => { offlineUnavailable = true; renderConnection(); },
  updateReady: (apply) => {
    el('update-card').hidden = false;
    el('apply-update').onclick = () => {
      if (document.visibilityState === 'visible') apply();
    };
  },
});
