import { describe, it, expect, beforeEach, vi } from 'vitest'
import crypto from 'crypto'

// Mock downstream dependencies so the route can import without touching
// prisma or Razorpay SDK. We're only exercising the signature-check branch
// here — the successful-processing path is out of scope for this test.
const getOrCreateCloudUser = vi.fn()
const updateUser = vi.fn()

vi.mock('@/models/users', () => ({
  getOrCreateCloudUser: (...args: unknown[]) => getOrCreateCloudUser(...args),
  updateUser: (...args: unknown[]) => updateUser(...args),
}))

vi.mock('@/lib/razorpay', () => ({
  PLANS: {},
}))

// Set the webhook secret before importing the route.
process.env.RAZORPAY_WEBHOOK_SECRET = 'test-webhook-secret'

import { POST } from '@/app/api/razorpay/webhook/route'

function buildRequest(body: string, signature: string | null): Request {
  const headers = new Headers()
  if (signature !== null) headers.set('x-razorpay-signature', signature)
  return new Request('https://example.test/api/razorpay/webhook', {
    method: 'POST',
    headers,
    body,
  })
}

function signBody(body: string, secret = 'test-webhook-secret'): string {
  return crypto.createHmac('sha256', secret).update(body).digest('hex')
}

describe('Razorpay webhook signature verification', () => {
  beforeEach(() => {
    getOrCreateCloudUser.mockReset()
    updateUser.mockReset()
  })

  it('rejects when signature header is missing', async () => {
    const res = await POST(buildRequest(JSON.stringify({ event: 'test' }), null))
    expect(res.status).toBe(400)
  })

  it('rejects when the signature is entirely wrong', async () => {
    const body = JSON.stringify({ event: 'subscription.charged', payload: {} })
    const res = await POST(
      buildRequest(body, 'a'.repeat(64)) // right length, wrong bytes
    )
    expect(res.status).toBe(400)
    expect(getOrCreateCloudUser).not.toHaveBeenCalled()
  })

  it('rejects when the signature has the wrong length', async () => {
    const body = JSON.stringify({ event: 'subscription.charged', payload: {} })
    const res = await POST(buildRequest(body, 'deadbeef'))
    expect(res.status).toBe(400)
  })

  it('rejects when the signature contains non-hex characters', async () => {
    const body = JSON.stringify({ event: 'subscription.charged', payload: {} })
    // Buffer.from("zzzz...", "hex") parses invalid hex to an empty buffer,
    // which must not accidentally collide with the expected HMAC.
    const res = await POST(buildRequest(body, 'z'.repeat(64)))
    expect(res.status).toBe(400)
  })

  it('rejects when the signature differs from the expected by one byte at the end', async () => {
    // Classic timing-attack target: matching prefix. With a non-constant
    // comparison the response latency would leak the prefix length. We
    // don't assert timing (that's environment-dependent), just that the
    // comparison still rejects.
    const body = JSON.stringify({ event: 'subscription.charged', payload: {} })
    const valid = signBody(body)
    const tampered = valid.slice(0, -2) + (valid.endsWith('0') ? '1' : '0') + valid.slice(-1)
    const res = await POST(buildRequest(body, tampered))
    expect(res.status).toBe(400)
  })

  it('accepts an event type it does not handle as long as the signature is valid', async () => {
    // This exercises the valid-signature path without depending on the
    // PLANS mock or the downstream user mutations.
    const body = JSON.stringify({ event: 'invoice.paid', payload: {} })
    const signature = signBody(body)
    const res = await POST(buildRequest(body, signature))
    expect(res.status).toBe(200)
  })
})
