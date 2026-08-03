/**
 * Org-level bank-feed provider selection settings (feature flags).
 *
 * Defaults are intentionally conservative:
 * - defaultProviderId = mock
 * - non-mock providers disabled unless explicitly enabled on the org setting
 * - live egress master switch is compile-time false until a separate Peet vendor gate
 *
 * Enabling za_aggregator_stub in settings only allows the fail-closed skeleton path
 * (secretRefId + vault metadata). It does NOT enable paid vendor network calls.
 */

import type { BankFeedProviderId } from './types'

/** Master kill-switch. Never flip true without Peet paid-vendor + live-credential gate. */
export const BANK_FEED_LIVE_EGRESS_MASTER_SWITCH = false as const

export const BANK_FEED_PROVIDER_IDS: readonly BankFeedProviderId[] = [
  'mock',
  'live_stub',
  'za_aggregator_stub',
] as const

export interface BankFeedOrgProviderSettings {
  orgId: string
  /** Provider used when connection create omits providerId. Always mock by default. */
  defaultProviderId: BankFeedProviderId
  /**
   * Providers the org may select. Default: mock only.
   * Non-mock entries are scaffolding only until Peet vendor gate.
   */
  enabledProviderIds: BankFeedProviderId[]
  /**
   * When false (default), createConnection rejects non-mock providerId even if
   * listed historically — use enabledProviderIds + this flag together.
   */
  allowNonMockProviders: boolean
  /**
   * When true would allow adapters to open real network (still blocked by master switch).
   * Default false. Setting true without master switch fails closed.
   */
  allowLiveEgress: boolean
  schemaVersion: 1
  updatedAt: string
  updatedBy: string
}

export class BankFeedProviderSettingsError extends Error {
  readonly statusCode = 400
  constructor(message: string) {
    super(message)
    this.name = 'BankFeedProviderSettingsError'
  }
}

export function defaultBankFeedOrgProviderSettings(
  orgId: string,
  nowIso = '1970-01-01T00:00:00.000Z',
): BankFeedOrgProviderSettings {
  return {
    orgId,
    defaultProviderId: 'mock',
    enabledProviderIds: ['mock'],
    allowNonMockProviders: false,
    allowLiveEgress: false,
    schemaVersion: 1,
    updatedAt: nowIso,
    updatedBy: 'system',
  }
}

export function isKnownBankFeedProviderId(value: string): value is BankFeedProviderId {
  return (BANK_FEED_PROVIDER_IDS as readonly string[]).includes(value)
}

export function resolveEffectiveLiveEgressAllowed(settings: BankFeedOrgProviderSettings): boolean {
  return BANK_FEED_LIVE_EGRESS_MASTER_SWITCH === true && settings.allowLiveEgress === true
}

export function resolveConnectionProviderId(
  settings: BankFeedOrgProviderSettings,
  requested?: BankFeedProviderId,
): BankFeedProviderId {
  const providerId = requested ?? settings.defaultProviderId
  assertProviderSelectable(settings, providerId)
  return providerId
}

export function assertProviderSelectable(
  settings: BankFeedOrgProviderSettings,
  providerId: BankFeedProviderId,
): void {
  if (!isKnownBankFeedProviderId(providerId)) {
    throw new BankFeedProviderSettingsError(`Unsupported providerId: ${providerId}`)
  }
  if (!settings.enabledProviderIds.includes(providerId)) {
    throw new BankFeedProviderSettingsError(
      `Provider ${providerId} is not enabled for this org (default selection is mock)`,
    )
  }
  if (providerId !== 'mock' && !settings.allowNonMockProviders) {
    throw new BankFeedProviderSettingsError(
      'Non-mock bank feed providers are disabled (feature flag allowNonMockProviders=false)',
    )
  }
  if (providerId !== 'mock' && resolveEffectiveLiveEgressAllowed(settings)) {
    // Even if both flags true someday, this boundary task keeps master switch false.
    // Left as documentation branch; master switch is const false today.
  }
}

export function normalizeBankFeedOrgProviderSettings(input: {
  orgId: string
  defaultProviderId?: BankFeedProviderId
  enabledProviderIds?: BankFeedProviderId[]
  allowNonMockProviders?: boolean
  allowLiveEgress?: boolean
  updatedBy: string
  nowIso: string
  previous?: BankFeedOrgProviderSettings
}): BankFeedOrgProviderSettings {
  const orgId = input.orgId.trim()
  if (!orgId) throw new BankFeedProviderSettingsError('orgId is required')

  const allowNonMockProviders = input.allowNonMockProviders ?? input.previous?.allowNonMockProviders ?? false
  const allowLiveEgressRequested = input.allowLiveEgress ?? input.previous?.allowLiveEgress ?? false

  if (allowLiveEgressRequested && BANK_FEED_LIVE_EGRESS_MASTER_SWITCH !== true) {
    throw new BankFeedProviderSettingsError(
      'allowLiveEgress cannot be enabled: BANK_FEED_LIVE_EGRESS_MASTER_SWITCH is false until Peet vendor + live-credential gate',
    )
  }

  const enabledRaw = input.enabledProviderIds ?? input.previous?.enabledProviderIds ?? ['mock']
  const enabledProviderIds = uniqueProviders(enabledRaw)
  if (!enabledProviderIds.includes('mock')) {
    // Mock must remain available so orgs can always fall back without a vendor.
    enabledProviderIds.unshift('mock')
  }
  if (!allowNonMockProviders) {
    // Collapse to mock-only when flag off.
    const mockOnly: BankFeedProviderId[] = ['mock']
    const defaultProviderId: BankFeedProviderId = 'mock'
    return {
      orgId,
      defaultProviderId,
      enabledProviderIds: mockOnly,
      allowNonMockProviders: false,
      allowLiveEgress: false,
      schemaVersion: 1,
      updatedAt: input.nowIso,
      updatedBy: input.updatedBy,
    }
  }

  for (const id of enabledProviderIds) {
    if (!isKnownBankFeedProviderId(id)) {
      throw new BankFeedProviderSettingsError(`Unknown provider in enabledProviderIds: ${id}`)
    }
  }

  const defaultProviderId = input.defaultProviderId ?? input.previous?.defaultProviderId ?? 'mock'
  if (!enabledProviderIds.includes(defaultProviderId)) {
    throw new BankFeedProviderSettingsError(
      `defaultProviderId ${defaultProviderId} must be included in enabledProviderIds`,
    )
  }

  return {
    orgId,
    defaultProviderId,
    enabledProviderIds,
    allowNonMockProviders: true,
    allowLiveEgress: allowLiveEgressRequested === true && BANK_FEED_LIVE_EGRESS_MASTER_SWITCH === true,
    schemaVersion: 1,
    updatedAt: input.nowIso,
    updatedBy: input.updatedBy,
  }
}

function uniqueProviders(ids: BankFeedProviderId[]): BankFeedProviderId[] {
  const out: BankFeedProviderId[] = []
  for (const id of ids) {
    if (!out.includes(id)) out.push(id)
  }
  return out
}

/** Hard-gate snapshot for bundles / UI readback. */
export function bankFeedProviderSettingsHardGates(settings: BankFeedOrgProviderSettings) {
  return {
    defaultProviderId: settings.defaultProviderId,
    allowNonMockProviders: settings.allowNonMockProviders,
    allowLiveEgress: settings.allowLiveEgress,
    effectiveLiveEgressAllowed: resolveEffectiveLiveEgressAllowed(settings),
    liveEgressMasterSwitch: BANK_FEED_LIVE_EGRESS_MASTER_SWITCH,
    enabledProviderIds: [...settings.enabledProviderIds],
  }
}
