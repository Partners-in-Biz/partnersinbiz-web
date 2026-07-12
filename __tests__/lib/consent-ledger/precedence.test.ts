import { evaluateConsentPrecedence } from '@/lib/consent-ledger/precedence'

const granted = { state: 'granted' as const }
const revoked = { state: 'revoked' as const }

describe('consent and suppression precedence', () => {
  it('always lets an active suppression override newer consent grants', () => {
    expect(
      evaluateConsentPrecedence({
        suppression: { active: true, reason: 'complaint' },
        globalConsent: granted,
        channelConsent: granted,
        topicConsent: granted,
      }),
    ).toEqual({ allowed: false, reason: 'suppressed:complaint', precedence: 'suppression' })
  })

  it('applies global, then channel, then topic revocations', () => {
    expect(evaluateConsentPrecedence({ globalConsent: revoked, channelConsent: granted })).toMatchObject({
      allowed: false,
      precedence: 'global-consent',
    })
    expect(evaluateConsentPrecedence({ globalConsent: granted, channelConsent: revoked })).toMatchObject({
      allowed: false,
      precedence: 'channel-consent',
    })
    expect(
      evaluateConsentPrecedence({ globalConsent: granted, channelConsent: granted, topicConsent: revoked }),
    ).toMatchObject({ allowed: false, precedence: 'topic-consent' })
  })

  it('requires an affirmative applicable grant when consent is required', () => {
    expect(evaluateConsentPrecedence({ requireConsent: true })).toEqual({
      allowed: false,
      reason: 'no affirmative consent',
      precedence: 'default-deny',
    })
    expect(evaluateConsentPrecedence({ requireConsent: true, topicConsent: granted })).toEqual({
      allowed: true,
      precedence: 'topic-consent',
    })
  })

  it('allows transactional messages only after suppression and hard revocations are checked', () => {
    expect(evaluateConsentPrecedence({ transactional: true })).toEqual({
      allowed: true,
      precedence: 'transactional',
    })
    expect(evaluateConsentPrecedence({ transactional: true, globalConsent: revoked })).toMatchObject({
      allowed: false,
      precedence: 'global-consent',
    })
  })
})
