import test from 'node:test';
import assert from 'node:assert/strict';
import { LocationTracker } from '../src/location.ts';

function fixture() {
  const watches = [], polls = [], cleared = [], fixes = [], errors = [];
  const api = {
    watchPosition(success, error) { watches.push({ success, error }); return watches.length - 1; },
    getCurrentPosition(success, error) { polls.push({ success, error }); },
    clearWatch(id) { cleared.push(id); },
  };
  const tracker = new LocationTracker(api, (fix) => fixes.push(fix), (error) => errors.push(error));
  const position = { coords: { latitude: 55, longitude: 37, accuracy: 10 }, timestamp: Date.now() };
  return { tracker, watches, polls, cleared, fixes, errors, position };
}

test('watch id zero is cleared; late callbacks after pause are ignored', () => {
  const f = fixture();
  f.tracker.start(15);
  assert.equal(f.polls.length, 1);
  f.watches[0].success(f.position);
  assert.equal(f.fixes.length, 1);
  f.tracker.stop();
  assert.deepEqual(f.cleared, [0]);
  f.polls[0].success(f.position);
  f.watches[0].error({ code: 1 });
  assert.equal(f.fixes.length, 1);
  assert.equal(f.errors.length, 0);
});

test('resume starts a fresh generation, rejecting previous requests', () => {
  const f = fixture();
  try {
    f.tracker.start(15);
    f.tracker.start(30);
    f.polls[0].success(f.position);
    f.watches[0].success(f.position);
    assert.equal(f.fixes.length, 0);
    f.polls[1].success(f.position);
    assert.equal(f.fixes.length, 1);
    assert.deepEqual(f.cleared, [0]);
  } finally { f.tracker.stop(); }
});

test('stopping synchronously on permission denial does not leak a watch', () => {
  const cleared = [];
  let polls = 0;
  let tracker;
  const api = {
    watchPosition(_success, error) { error({ code: 1 }); return 0; },
    getCurrentPosition() { polls += 1; },
    clearWatch(id) { cleared.push(id); },
  };
  tracker = new LocationTracker(api, () => {}, () => tracker.stop());
  tracker.start(15);
  assert.deepEqual(cleared, [0]);
  assert.equal(polls, 0);
});
