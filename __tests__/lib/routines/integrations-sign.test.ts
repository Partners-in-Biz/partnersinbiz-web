/**
 * @jest-environment node
 */
import { createHmac } from 'node:crypto'
import { signPayload } from '@/lib/webhooks/sign'
import {
  verifyGitHubSignature,
  verifyLinearSignature,
  verifyPibHookSignature,
  verifySlackSignature,
} from '@/lib/routines/integrations'

describe('routine signature verifiers', () => {
  const secret = 'test-signing-secret'
  const body = '{"hello":"world"}'

  it('verifies PiB hook signatures (sign.ts fixture)', () => {
    const ts = 1_700_000_000_000
    const signature = signPayload(secret, body, ts)
    expect(verifyPibHookSignature({
      secret,
      body,
      timestampHeader: String(ts),
      signatureHeader: signature,
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

  it('verifies GitHub X-Hub-Signature-256 fixtures', () => {
    const hex = createHmac('sha256', secret).update(body, 'utf8').digest('hex')
    expect(verifyGitHubSignature(secret, body, `sha256=${hex}`)).toBe(true)
    expect(verifyGitHubSignature(secret, body, 'sha256=00')).toBe(false)
  })

  it('verifies Slack v0 signatures', () => {
    const ts = '1700000000'
    const base = `v0:${ts}:${body}`
    const sig = `v0=${createHmac('sha256', secret).update(base, 'utf8').digest('hex')}`
    expect(verifySlackSignature({
      secret,
      body,
      timestampHeader: ts,
      signatureHeader: sig,
      nowSec: 1_700_000_000,
    })).toBe(true)
    expect(verifySlackSignature({
      secret,
      body,
      timestampHeader: ts,
      signatureHeader: 'v0=bad',
      nowSec: 1_700_000_000,
    })).toBe(false)
  })

  it('verifies Linear signatures', () => {
    const hex = createHmac('sha256', secret).update(body, 'utf8').digest('hex')
    expect(verifyLinearSignature(secret, body, hex)).toBe(true)
    expect(verifyLinearSignature(secret, body, 'nope')).toBe(false)
  })
})
