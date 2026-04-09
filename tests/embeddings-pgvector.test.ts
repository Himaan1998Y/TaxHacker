import { describe, it, expect, beforeEach, vi } from 'vitest'

// Tier 1.8 regression: when pgvector is not installed in the target
// database, every embedding operation must degrade gracefully (no-op
// for writes, empty result for reads) instead of throwing a 500. The
// probe runs once per process and caches its result.

const queryRawUnsafe = vi.fn()
const executeRawUnsafe = vi.fn()

vi.mock('@/lib/db', () => ({
  prisma: {
    $queryRawUnsafe: (...args: unknown[]) => queryRawUnsafe(...args),
    $executeRawUnsafe: (...args: unknown[]) => executeRawUnsafe(...args),
  },
}))

vi.mock('@/models/settings', () => ({
  getSettings: vi.fn(async () => ({})),
}))

import {
  storeTransactionEmbedding,
  findSimilarTransactions,
  detectDuplicates,
  semanticSearch,
  isPgvectorAvailable,
  _resetPgvectorProbe,
} from '@/lib/embeddings'

beforeEach(() => {
  queryRawUnsafe.mockReset()
  executeRawUnsafe.mockReset()
  _resetPgvectorProbe(null)
})

describe('pgvector capability probe', () => {
  it('returns true and does not warn when the probe SELECT succeeds', async () => {
    queryRawUnsafe.mockResolvedValueOnce([{ '?column?': 'vector' }])
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const available = await isPgvectorAvailable()

    expect(available).toBe(true)
    expect(queryRawUnsafe).toHaveBeenCalledTimes(1)
    expect(warnSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('pgvector extension not available')
    )
    warnSpy.mockRestore()
  })

  it('returns false and warns once when the probe throws', async () => {
    queryRawUnsafe.mockRejectedValueOnce(new Error('type "vector" does not exist'))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const available = await isPgvectorAvailable()

    expect(available).toBe(false)
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('pgvector extension not available')
    )
    warnSpy.mockRestore()
  })

  it('caches the probe result for the life of the process', async () => {
    queryRawUnsafe.mockRejectedValueOnce(new Error('type "vector" does not exist'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    const a = await isPgvectorAvailable()
    const b = await isPgvectorAvailable()
    const c = await isPgvectorAvailable()

    expect(a).toBe(false)
    expect(b).toBe(false)
    expect(c).toBe(false)
    // Probe called exactly once; subsequent calls hit the cached value.
    expect(queryRawUnsafe).toHaveBeenCalledTimes(1)
  })
})

describe('graceful degradation when pgvector is unavailable', () => {
  beforeEach(() => {
    _resetPgvectorProbe(false)
  })

  it('storeTransactionEmbedding is a no-op (does not throw, does not hit executeRawUnsafe)', async () => {
    await expect(
      storeTransactionEmbedding('tx-1', new Array(768).fill(0.1))
    ).resolves.toBeUndefined()
    expect(executeRawUnsafe).not.toHaveBeenCalled()
  })

  it('findSimilarTransactions returns an empty array', async () => {
    const result = await findSimilarTransactions(
      new Array(768).fill(0.1),
      'user-1'
    )
    expect(result).toEqual([])
    expect(queryRawUnsafe).not.toHaveBeenCalled()
  })

  it('detectDuplicates returns an empty array (inherits the guard via findSimilarTransactions)', async () => {
    const result = await detectDuplicates(new Array(768).fill(0.1), 'user-1')
    expect(result).toEqual([])
  })

  it('semanticSearch returns an empty array', async () => {
    const result = await semanticSearch('coffee expenses', 'user-1')
    expect(result).toEqual([])
    // Must short-circuit before even generating the embedding — otherwise
    // a broken embedding API in a degraded deployment surfaces as an HTTP
    // 500 instead of an empty result.
    expect(queryRawUnsafe).not.toHaveBeenCalled()
  })
})

describe('normal operation when pgvector is available', () => {
  beforeEach(() => {
    _resetPgvectorProbe(true)
  })

  it('storeTransactionEmbedding hits $executeRawUnsafe with the vector cast', async () => {
    executeRawUnsafe.mockResolvedValueOnce(1)

    await storeTransactionEmbedding('tx-1', [0.1, 0.2, 0.3])

    expect(executeRawUnsafe).toHaveBeenCalledTimes(1)
    const [sql, vectorStr, txId] = executeRawUnsafe.mock.calls[0]
    expect(sql).toContain('UPDATE "transactions"')
    expect(sql).toContain('$1::vector')
    expect(vectorStr).toBe('[0.1,0.2,0.3]')
    expect(txId).toBe('tx-1')
  })

  it('findSimilarTransactions returns the raw rows from the query', async () => {
    queryRawUnsafe.mockResolvedValueOnce([
      { id: 'tx-2', name: 'Similar', merchant: 'X', total: 1, similarity: 0.95 },
    ])
    const result = await findSimilarTransactions(
      new Array(768).fill(0.1),
      'user-1'
    )
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('tx-2')
  })
})
