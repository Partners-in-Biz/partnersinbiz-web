import type { AdConnection, AdPlatform } from './types'

export const AD_PLATFORM_LABELS: Record<AdPlatform, string> = {
  meta: 'Meta',
  google: 'Google Ads',
  linkedin: 'LinkedIn Ads',
  tiktok: 'TikTok Ads',
}

export type AdConnectionSummary = {
  platform: AdPlatform
  providerLabel: string
  connectionStatus: AdConnection['status'] | 'not_connected'
  accountLabel: string | null
  accountStatus: 'ready' | 'account_not_selected' | 'not_connected'
}

export function adPlatformLabel(platform: AdPlatform): string {
  return AD_PLATFORM_LABELS[platform]
}

export function summarizeAdConnections(connections: Array<Pick<AdConnection, 'platform' | 'status' | 'defaultAdAccountId' | 'adAccounts' | 'meta'>>): Record<AdPlatform, AdConnectionSummary> {
  const summaries = {} as Record<AdPlatform, AdConnectionSummary>

  for (const platform of Object.keys(AD_PLATFORM_LABELS) as AdPlatform[]) {
    const connection = connections.find((candidate) => candidate.platform === platform)
    const accountLabel = connection ? selectedAccountLabel(connection) : null
    summaries[platform] = {
      platform,
      providerLabel: adPlatformLabel(platform),
      connectionStatus: connection?.status ?? 'not_connected',
      accountLabel,
      accountStatus: !connection ? 'not_connected' : accountLabel ? 'ready' : 'account_not_selected',
    }
  }

  return summaries
}

function selectedAccountLabel(connection: Pick<AdConnection, 'platform' | 'defaultAdAccountId' | 'adAccounts' | 'meta'>): string | null {
  const selectedId = selectedAccountId(connection)
  if (!selectedId) return null

  const account = connection.adAccounts?.find((candidate) => candidate.id === selectedId)
  if (account?.name) return `${account.name} (${selectedId})`

  return selectedId
}

function selectedAccountId(connection: Pick<AdConnection, 'platform' | 'defaultAdAccountId' | 'meta'>): string | null {
  if (connection.defaultAdAccountId) return connection.defaultAdAccountId

  const meta = (connection.meta ?? {}) as Record<string, unknown>
  if (connection.platform === 'google') {
    const google = (meta.google as Record<string, unknown> | undefined) ?? {}
    return stringOrNull(google.customerId) ?? stringOrNull(google.loginCustomerId)
  }
  if (connection.platform === 'linkedin') {
    const linkedin = (meta.linkedin as Record<string, unknown> | undefined) ?? {}
    return stringOrNull(linkedin.selectedAdAccountUrn)
  }
  if (connection.platform === 'tiktok') {
    const tiktok = (meta.tiktok as Record<string, unknown> | undefined) ?? {}
    return stringOrNull(tiktok.selectedAdvertiserId)
  }

  return null
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}
