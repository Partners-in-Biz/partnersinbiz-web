import { encodeMimeHeaderValue } from '@/lib/email/rfc2047'

describe('encodeMimeHeaderValue', () => {
  it('leaves printable ASCII unchanged', () => {
    expect(encodeMimeHeaderValue('Hello')).toBe('Hello')
    expect(encodeMimeHeaderValue('Invoice SAA-002 - Deposit')).toBe('Invoice SAA-002 - Deposit')
  })

  it('strips CR/LF to block header injection', () => {
    expect(encodeMimeHeaderValue('Hello\r\nBcc: evil@example.com')).toBe('Hello Bcc: evil@example.com')
  })

  it('RFC 2047-encodes em dashes so raw MIME headers stay ASCII', () => {
    const subject = 'Invoice SAA-002 — Deposit — Saaiman Stays Platform Build'
    const encoded = encodeMimeHeaderValue(subject)
    expect(encoded).toMatch(/^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/)
    expect(encoded).not.toContain('—')
    const b64 = encoded.slice('=?UTF-8?B?'.length, -'?='.length)
    expect(Buffer.from(b64, 'base64').toString('utf8')).toBe(subject)
  })
})
