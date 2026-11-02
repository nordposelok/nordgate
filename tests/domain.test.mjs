import test from 'node:test';
import assert from 'node:assert/strict';
import { canSuggest, distanceMeters, emptyProximity, isFreshFix, isHighlighted, normalizeSettings, parseGates, quietHint, updateProximity } from '../src/domain.ts';

const gate = { id: 1, label: 'Тургенева', phone: '+79850887386', latitude: 55.929409, longitude: 37.901695 };

test('gate data accepts any positive number of unique gates and rejects unsafe telephone links', () => {
  assert.equal(parseGates([gate]).length, 1);
  for (const change of [{ phone: 'javascript:alert(1)' }, { phone: '+7*123#' }, { latitude: 91 }, { longitude: NaN }, { id: 0 }, { label: ' ' }]) {
    assert.throws(() => parseGates([{ ...gate, ...change }]));
  }
  assert.throws(() => parseGates([gate, gate]));
  assert.throws(() => parseGates([]));
});

test('distance works at the same point and across the date line', () => {
  assert.equal(distanceMeters(gate, gate), 0);
  assert.ok(Math.abs(distanceMeters({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 1 }) - 111_195) < 1);
  assert.ok(distanceMeters({ latitude: 0, longitude: 179.999 }, { latitude: 0, longitude: -179.999 }) < 225);
});

test('entry at 100 m, hysteresis until beyond 120 m', () => {
  let state = updateProximity(emptyProximity(), 101);
  assert.equal(state.direction, 'outside');
  state = updateProximity(state, 100);
  assert.equal(isHighlighted(state), true);
  state = updateProximity(state, 112);
  assert.equal(state.direction, 'approaching');
  assert.equal(isHighlighted(state), false);
  state = updateProximity(state, 98);
  assert.equal(isHighlighted(state), true);
  state = updateProximity(state, 121);
  assert.equal(state.direction, 'outside');
});

test('moving away and turning back require more than 25 m, not GPS noise', () => {
  let state = updateProximity(emptyProximity(), 90);
  state = updateProximity(state, 30);
  state = updateProximity(state, 55);
  assert.equal(state.direction, 'approaching');
  state = updateProximity(state, 56);
  assert.equal(state.direction, 'receding');
  assert.equal(isHighlighted(state), false);
  state = updateProximity(state, 90);
  state = updateProximity(state, 65);
  assert.equal(state.direction, 'receding');
  state = updateProximity(state, 64);
  assert.equal(isHighlighted(state), true);
});

test('a tap quiets the suggestion temporarily, including a cancelled call', () => {
  let state = quietHint(updateProximity(emptyProximity(), 50), 1_000);
  assert.equal(isHighlighted(state, 20_999), false);
  assert.equal(isHighlighted(state, 21_000), true);
  state = updateProximity(state, 130);
  state = updateProximity(state, 60);
  assert.equal(isHighlighted(state, 2_000), true);
});

test('invalid distance clears proximity, never leaves a stale green button', () => {
  const state = updateProximity(emptyProximity(), 20);
  for (const distance of [NaN, Infinity, -1]) assert.equal(isHighlighted(updateProximity(state, distance)), false);
});

test('stale, invalid and poor-accuracy fixes do not drive hints', () => {
  const now = 1_000_000;
  const fix = { latitude: 55, longitude: 37, accuracy: 10, timestamp: now };
  assert.equal(canSuggest(fix, now), true);
  assert.equal(isFreshFix({ ...fix, timestamp: now - 30_001 }, now), false);
  assert.equal(isFreshFix({ ...fix, timestamp: now + 2_000 }, now), false);
  for (const change of [{ latitude: NaN }, { accuracy: -1 }, { longitude: 190 }, { timestamp: NaN }]) assert.equal(isFreshFix({ ...fix, ...change }, now), false);
  assert.equal(isFreshFix({ ...fix, accuracy: 101 }, now), true);
  assert.equal(canSuggest({ ...fix, accuracy: 101 }, now), false);
});

test('corrupt settings recover defaults; timer clamps and flags remain booleans', () => {
  assert.equal(normalizeSettings(null).locationEnabled, false);
  assert.equal(normalizeSettings({ locationEnabled: 'true' }).locationEnabled, false);
  assert.equal(normalizeSettings({ timerPeriodSeconds: 0 }).timerPeriodSeconds, 1);
  assert.equal(normalizeSettings({ timerPeriodSeconds: 900 }).timerPeriodSeconds, 600);
  assert.equal(normalizeSettings({ timerPeriodSeconds: NaN }).timerPeriodSeconds, 15);
  assert.equal(normalizeSettings({ timerPeriodSeconds: 2.4 }).timerPeriodSeconds, 2);
});
