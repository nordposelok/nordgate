import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const template = await readFile(new URL('../scripts/service-worker.js', import.meta.url), 'utf8');
const scope = 'https://example.test/nordgate/';
const prefix = `nordgate:${scope}:`;

function worker({ failInstall = false } = {}) {
  const events = new Map();
  const deleted = [], added = [], fetched = [];
  let skipped = 0, claimed = 0;
  const entries = new Map();
  const keyFor = (value) => typeof value === 'string' ? value : value.url ?? value.href;
  const cache = {
    async addAll(requests) {
      added.push(...requests.map((request) => request.url));
      if (failInstall) throw new Error('network unavailable');
      for (const request of requests) entries.set(request.url, new Response(`cached:${request.url}`));
    },
    async match(request, options = {}) {
      if (request.headers?.has('Origin') && !options.ignoreVary) return undefined;
      return entries.get(keyFor(request))?.clone();
    },
  };
  const sandbox = {
    self: {
      registration: { scope },
      addEventListener(type, listener) { events.set(type, listener); },
      clients: { async claim() { claimed += 1; } },
      async skipWaiting() { skipped += 1; },
    },
    caches: {
      async open() { return cache; },
      async keys() { return [`${prefix}old`, `${prefix}release`, 'other-site:cache']; },
      async delete(key) { deleted.push(key); return true; },
    },
    URL, Request,
    fetch: async (request) => { fetched.push(request.url); throw new Error('offline'); },
  };
  vm.runInNewContext(`const CACHE_PREFIX = ${JSON.stringify(prefix)};
    const CACHE_NAME = CACHE_PREFIX + 'release';
    const ASSETS = ['./index.html', './phones.json', './assets/app.js'];\n${template}`, sandbox);
  const dispatch = (type, extra = {}) => {
    let result;
    events.get(type)({ waitUntil(promise) { result = promise; }, respondWith(promise) { result = promise; }, ...extra });
    return result;
  };
  return { dispatch, deleted, added, fetched, entries, get skipped() { return skipped; }, get claimed() { return claimed; } };
}

test('precache respects a GitHub Pages subdirectory and does not auto-activate an update', async () => {
  const w = worker();
  await w.dispatch('install');
  assert.deepEqual(w.added, [`${scope}index.html`, `${scope}phones.json`, `${scope}assets/app.js`]);
  assert.equal(w.skipped, 0);
});

test('a failed installation deletes only the incomplete release, preserving the old working cache', async () => {
  const w = worker({ failInstall: true });
  await assert.rejects(w.dispatch('install'), /network unavailable/);
  assert.deepEqual(w.deleted, [`${prefix}release`]);
});

test('activation cleans only caches belonging to this app scope', async () => {
  const w = worker();
  await w.dispatch('activate');
  assert.deepEqual(w.deleted, [`${prefix}old`]);
  assert.equal(w.claimed, 1);
});

test('navigation and gate data remain available offline from the same release', async () => {
  const w = worker();
  await w.dispatch('install');
  const index = await w.dispatch('fetch', { request: { url: `${scope}?source=home`, method: 'GET', mode: 'navigate' } });
  const phones = await w.dispatch('fetch', { request: new Request(`${scope}phones.json`) });
  assert.equal(await index.text(), `cached:${scope}index.html`);
  assert.equal(await phones.text(), `cached:${scope}phones.json`);
  assert.equal(w.fetched.length, 0);
});

test('requests outside this scope and non-GET requests are not intercepted', () => {
  const w = worker();
  assert.equal(w.dispatch('fetch', { request: new Request('https://elsewhere.test/nordgate/') }), undefined);
  assert.equal(w.dispatch('fetch', { request: new Request('https://example.test/another-app/') }), undefined);
  assert.equal(w.dispatch('fetch', { request: new Request(`${scope}api`, { method: 'POST' }) }), undefined);
});

test('Vary: Origin does not prevent cached module and stylesheet responses', async () => {
  const w = worker();
  await w.dispatch('install');
  const request = new Request(`${scope}assets/app.js`, { headers: { Origin: 'https://example.test' } });
  const response = await w.dispatch('fetch', { request });
  assert.equal(await response.text(), `cached:${scope}assets/app.js`);
  assert.equal(w.fetched.length, 0);
});

test('only explicit apply-update activates waiting worker; ready status reflects installed cache', async () => {
  const w = worker();
  const messages = [];
  await w.dispatch('message', { data: { type: 'CACHE_STATUS' }, ports: [{ postMessage(message) { messages.push(message.ready); } }] });
  await w.dispatch('install');
  await w.dispatch('message', { data: { type: 'CACHE_STATUS' }, ports: [{ postMessage(message) { messages.push(message.ready); } }] });
  assert.deepEqual(messages, [false, true]);
  await w.dispatch('message', { data: { type: 'APPLY_UPDATE' } });
  assert.equal(w.skipped, 1);
});
