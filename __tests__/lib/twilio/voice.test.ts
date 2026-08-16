/**
 * Unit tests for Twilio Voice TwiML builders (no network).
 */
import { buildInboundDialTwiml, buildOutboundDialTwiml, buildRejectTwiml } from '@/lib/twilio/voice'

describe('twilio voice twiml', () => {
  it('builds outbound dial with dual-channel recording', () => {
    const xml = buildOutboundDialTwiml({
      to: '+27821234567',
      callerId: '+27820000000',
      record: true,
      statusCallbackUrl: 'https://example.com/status',
      recordingStatusCallbackUrl: 'https://example.com/recording',
    })
    expect(xml).toContain('<Dial')
    expect(xml).toContain('+27821234567')
    expect(xml).toContain('record-from-answer-dual')
    expect(xml).toContain('https://example.com/recording')
  })

  it('builds inbound client dial', () => {
    const xml = buildInboundDialTwiml({
      clientIdentity: 'org_abc',
      record: false,
      statusCallbackUrl: 'https://example.com/status',
      recordingStatusCallbackUrl: 'https://example.com/recording',
    })
    expect(xml).toContain('<Client>org_abc</Client>')
    expect(xml).not.toContain('record-from-answer-dual')
  })

  it('builds reject twiml', () => {
    const xml = buildRejectTwiml('Not connected')
    expect(xml).toContain('Not connected')
    expect(xml).toContain('<Hangup')
  })
})
