/**
 * Regression tests for the reliability fixes in the "rock solid" pass.
 * Each `describe` names the bug it guards against, so a failure says what broke.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { transactionQueue } from '../services/db/transactionQueueService';
import { apiFetch } from '../lib/apiClient';

describe('offline queue: items added while a batch runs are not lost', () => {
  beforeEach(() => {
    const svc = transactionQueue as any;
    svc.isLoaded = true;
    svc.isProcessing = false;
    svc.cachedQueue = [];
  });

  it('keeps a transaction enqueued during processQueue()', async () => {
    const svc = transactionQueue as any;
    let call = 0;
    svc.executeMessageInsert = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        // Simulate the user sending a second message while the first is in flight.
        svc.cachedQueue.push({ id: 'late', type: 'message_insert', payload: { n: 2 }, timestamp: Date.now(), retries: 0 });
      }
      return true;
    });
    svc.cachedQueue.push({ id: 'first', type: 'message_insert', payload: { n: 1 }, timestamp: Date.now(), retries: 0 });

    await transactionQueue.processQueue();

    expect(svc.executeMessageInsert).toHaveBeenCalledTimes(1);
    expect(svc.cachedQueue.map((t: any) => t.id)).toEqual(['late']);
  });

  it('retries a failed transaction and keeps it in the queue', async () => {
    const svc = transactionQueue as any;
    svc.executeMessageInsert = vi.fn(async () => false);
    svc.cachedQueue.push({ id: 'flaky', type: 'message_insert', payload: {}, timestamp: Date.now(), retries: 0 });

    await transactionQueue.processQueue();

    expect(svc.cachedQueue).toHaveLength(1);
    expect(svc.cachedQueue[0].retries).toBe(1);
  });
});

describe('apiFetch: timeout and retry policy', () => {
  const realFetch = globalThis.fetch;
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('retries an idempotent GET after a network error', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('network down'))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    globalThis.fetch = fetchMock as any;

    const res = await apiFetch('/api/health', { method: 'GET' });

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  }, 10000);

  it('never retries a POST, so a send cannot happen twice', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('network down'));
    globalThis.fetch = fetchMock as any;

    await expect(apiFetch('/api/send-notification', { method: 'POST', body: '{}' })).rejects.toThrow('network down');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('aborts a request that exceeds the timeout', async () => {
    globalThis.fetch = ((_: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      })) as any;

    await expect(apiFetch('/api/slow', { method: 'POST', body: '{}' }, { timeoutMs: 20 })).rejects.toThrow();
  });
});

import { sanitizeSearchTerm } from '../utils/searchTerm';
describe('search input cannot change the PostgREST filter', () => {
  it('strips filter-structural characters', () => {
    const out = sanitizeSearchTerm('bob,email.eq.x)');
    expect(out).not.toMatch(/[,()]/);
    expect(out).toBe('bob email.eq.x');
  });
  it('removes LIKE and PostgREST wildcards', () => {
    expect(sanitizeSearchTerm('a%_*b')).toBe('a b');
  });
  it('caps length and trims whitespace', () => {
    expect(sanitizeSearchTerm('   ' + 'x'.repeat(200) + '   ').length).toBe(60);
    expect(sanitizeSearchTerm('   ')).toBe('');
  });
});
