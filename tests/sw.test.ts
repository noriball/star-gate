import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CSP } from '../src/csp';

const template = new TextDecoder().decode(readFileSync(join(decodeURIComponent(new URL('.', import.meta.url).pathname), '..', 'public', 'sw.js')));

/** Run the service-worker source against fake globals and return its handlers + the fake cache storage. */
function boot(version: string, urls: string[], opts: { online?: boolean; existing?: Record<string, string[]> } = {}) {
  const src = template.replace('__VERSION__', version).replace('__PRECACHE__', JSON.stringify(urls));
  const store = new Map<string, Map<string, string>>();
  for (const [k, v] of Object.entries(opts.existing ?? {})) store.set(k, new Map(v.map(u => [u, 'old'])));
  const norm = (u: string) => new URL(u, 'https://app.test/base/').href;
  const mkCache = (name: string) => ({
    add: async (r: { url: string }) => { store.get(name)!.set(r.url, 'fresh:' + r.url); },
    match: async (r: { url?: string } | string) => { const u = typeof r === 'string' ? norm(r) : r.url ? r.url : ''; const m = store.get(name)!; const hit = [...m.keys()].find(k => k.split('?')[0] === u.split('?')[0]); return hit ? { body: m.get(hit) } : undefined; },
  });
  const caches = {
    open: async (n: string) => { if (!store.has(n)) store.set(n, new Map()); return mkCache(n); },
    keys: async () => [...store.keys()], delete: async (n: string) => store.delete(n),
    match: async (r: string) => { for (const n of store.keys()) { const m = await mkCache(n).match(r); if (m) return m; } return undefined; },
  };
  const handlers: Record<string, (e: unknown) => void> = {};
  const events = { skip: 0, claim: 0 };
  const self = { location: { origin: 'https://app.test' }, addEventListener: (t: string, f: (e: unknown) => void) => { handlers[t] = f; }, skipWaiting: async () => { events.skip++; }, clients: { claim: async () => { events.claim++; } } };
  class Req { url: string; method = 'GET'; mode = 'cors'; constructor(u: string) { this.url = norm(u); } }
  const fetched: string[] = [];
  const fetchFn = async (r: { url: string }) => { fetched.push(r.url); if (opts.online === false) throw new Error('offline'); return { body: 'net:' + r.url }; };
  new Function('self', 'caches', 'fetch', 'Request', src)(self, caches, fetchFn, Req);
  const life = async (type: string) => { let p: Promise<unknown> = Promise.resolve(); handlers[type]({ waitUntil: (x: Promise<unknown>) => { p = x; } }); await p; };
  const req = (url: string, over: Record<string, unknown> = {}) => ({ url: norm(url), method: 'GET', mode: 'cors', ...over });
  const fetchEv = async (r: unknown) => { let out: unknown; let responded = false; handlers.fetch({ request: r, respondWith: (p: Promise<unknown>) => { responded = true; out = p; } }); return { responded, value: responded ? await (out as Promise<{ body: string }>) : undefined }; };
  return { store, life, fetchEv, req, events, fetched, handlers };
}
const urls = ['./', './index.html', './assets/a-123.js', './samples/flower.png'];

describe('service worker', () => {
  it('the template has exactly the two build placeholders and a versioned cache name', () => {
    expect(template.match(/__VERSION__/g)).toHaveLength(1); expect(template.match(/__PRECACHE__/g)).toHaveLength(1);
    expect(template).toContain("const CACHE = 'stargate-' + VERSION");
  });
  it('install precaches the whole app shell (bypassing the HTTP cache) and activates immediately', async () => {
    const t = boot('v1', urls); await t.life('install');
    expect([...t.store.get('stargate-v1')!.keys()].map(k => k.replace('https://app.test/base/', ''))).toEqual(['', 'index.html', 'assets/a-123.js', 'samples/flower.png']);
    expect(t.events.skip).toBe(1);
  });
  it('activate deletes older stargate caches (no stale-forever) but leaves unrelated caches alone', async () => {
    const t = boot('v2', urls, { existing: { 'stargate-v1': ['x'], 'stargate-v0': ['y'], 'other-app': ['z'] } }); await t.life('install'); await t.life('activate');
    expect([...t.store.keys()].sort()).toEqual(['other-app', 'stargate-v2']); expect(t.events.claim).toBe(1);
  });
  it('navigations go to the network first (new deployments show up) and fall back to the cached shell offline', async () => {
    const on = boot('v1', urls); await on.life('install');
    expect((await on.fetchEv(on.req('./', { mode: 'navigate' }))).value).toMatchObject({ body: expect.stringContaining('net:') });
    const off = boot('v1', urls, { online: false }); await off.life('install');
    const r = await off.fetchEv(off.req('./index.html', { mode: 'navigate' })); expect(r.responded).toBe(true); expect(r.value).toMatchObject({ body: expect.stringContaining('fresh:') });
  });
  it('assets are served from the cache (works offline); unknown files go to the network', async () => {
    const t = boot('v1', urls, { online: false }); await t.life('install');
    expect((await t.fetchEv(t.req('./samples/flower.png'))).value).toMatchObject({ body: expect.stringContaining('fresh:') });
    expect((await t.fetchEv(t.req('./assets/a-123.js?x=1'))).responded).toBe(true);
    await expect(t.fetchEv(t.req('./nothing.bin'))).rejects.toThrow('offline');
  });
  it('never touches cross-origin or non-GET requests', async () => {
    const t = boot('v1', urls); await t.life('install');
    expect((await t.fetchEv({ url: 'https://elsewhere.test/x.js', method: 'GET', mode: 'cors' })).responded).toBe(false);
    expect((await t.fetchEv(t.req('./samples/flower.png', { method: 'POST' }))).responded).toBe(false);
  });
});

describe('content security policy', () => {
  it('allows only same-origin resources (plus blob/data for local files) and no external hosts', () => {
    expect(CSP).toContain("default-src 'self'"); expect(CSP).toContain("object-src 'none'"); expect(CSP).not.toMatch(/https?:\/\/|\*/);
    expect(CSP).not.toContain("'unsafe-eval'");
  });
});
