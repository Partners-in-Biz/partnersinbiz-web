/** Client-safe proving kit constants (no Node/crypto imports). */
export const PROVING_SEED_VERSION = '2026-08-03.v1'
export const DEFAULT_PROVING_SEED_KEY = 'pib-proving-demo-v1'

export const PROVING_HARD_GATES = {
  sarsSubmissionInitiated: false as const,
  externalPaymentInitiated: false as const,
  externalEgressAllowed: false as const,
  massEmailAllowed: false as const,
}
