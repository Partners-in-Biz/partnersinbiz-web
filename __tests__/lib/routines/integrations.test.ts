import { signPayload } from '@/lib/webhooks/sign'
import {
  verifyGitHubSignature,
  verifyLinearSignature,
  verifyPibHookSignature,
  verifySlackSignature,
} from '@/lib/routines/integrations'

describe('routine integration signatures', () => {
  const secret = 'test-secret-abc'
  const body = '{"hello":"world"}'

  it('verifies PiB hook signatures', () => {
    const ts = Date.now()
    const sig = signPayload(secret, body, ts)
    expect(verifyPibHookSignature({
      secret,
      body,
      timestampHeader: String(ts),
      signatureHeader: sig,
      nowMs: ts,
    })).toBe(true)
    expect(verifyPibHookSignature({
      secret,
      body,
      timestampHeader: String(ts),
      signatureHeader: 'sha256=deadbeef',
      nowMs: ts,
    })).toBe(false)
  })

  it('verifies GitHub X-Hub-Signature-256', () => {
    const { createHmac } = require('node:crypto') as typeof import('node:crypto')
    const sig = `sha256=${createHmac('sha256', secret).update(body, 'utf8').digest('hex')}`
    expect(verifyGitHubSignature(secret, body, sig)).toBe(true)
    expect(verifyGitHubSignature(secret, body, 'sha256=nope')).toBe(false)
  })

  it('verifies Slack v0 signatures', () => {
    const { createHmac } = require('node:crypto') as typeof import('node:crypto')
    const ts = Math.floor(Date.now() / 1000)
    const base = `v0:${ts}:${body}`
    const sig = `v0=${createHmac('sha256', secret).update(base, 'utf8').digest('hex')}`
    expect(verifySlackSignature({
      secret,
      body,
      timestampHeader: String(ts),
      signatureHeader: sig,
      nowSec: ts,
    })).toBe(true)
  })

  it('verifies Linear signatures', () => {
    const { createHmac } = require('node:crypto') as typeof import('node:crypto')
    const sig = createHmac('sha256', secret).update(body, 'utf8').digest('hex')
    expect(verifyLinearSignature(secret, body, sig)).toBe(true)
    expect(verifyLinearSignature(secret, body, 'nope')).toBe(false)
  })
})
