import type { ConsentState } from './types'

interface ConsentFact { state: ConsentState }

export interface ConsentPrecedenceInput {
  suppression?: { active: boolean; reason?: string }
  globalConsent?: ConsentFact
  channelConsent?: ConsentFact
  topicConsent?: ConsentFact
  transactional?: boolean
  requireConsent?: boolean
}

export interface ConsentDecision {
  allowed: boolean
  reason?: string
  precedence:
    | 'suppression'
    | 'global-consent'
    | 'channel-consent'
    | 'topic-consent'
    | 'transactional'
    | 'default-allow'
    | 'default-deny'
}

function isDenied(fact?: ConsentFact): boolean {
  return fact?.state === 'revoked' || fact?.state === 'suppressed'
}

function isGranted(fact?: ConsentFact): boolean {
  return fact?.state === 'granted' || fact?.state === 'confirmed'
}

/**
 * Canonical send decision order. Lower-level grants can never override an
 * active suppression or a broader explicit revocation.
 */
export function evaluateConsentPrecedence(input: ConsentPrecedenceInput): ConsentDecision {
  if (input.suppression?.active) {
    return {
      allowed: false,
      reason: `suppressed:${input.suppression.reason || 'active'}`,
      precedence: 'suppression',
    }
  }
  if (isDenied(input.globalConsent)) {
    return { allowed: false, reason: 'global consent revoked', precedence: 'global-consent' }
  }
  if (isDenied(input.channelConsent)) {
    return { allowed: false, reason: 'channel consent revoked', precedence: 'channel-consent' }
  }
  if (isDenied(input.topicConsent)) {
    return { allowed: false, reason: 'topic consent revoked', precedence: 'topic-consent' }
  }
  if (input.transactional) return { allowed: true, precedence: 'transactional' }
  if (isGranted(input.topicConsent)) return { allowed: true, precedence: 'topic-consent' }
  if (isGranted(input.channelConsent)) return { allowed: true, precedence: 'channel-consent' }
  if (isGranted(input.globalConsent)) return { allowed: true, precedence: 'global-consent' }
  if (input.requireConsent) {
    return { allowed: false, reason: 'no affirmative consent', precedence: 'default-deny' }
  }
  return { allowed: true, precedence: 'default-allow' }
}
