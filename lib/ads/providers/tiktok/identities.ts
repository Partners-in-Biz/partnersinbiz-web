// lib/ads/providers/tiktok/identities.ts
// Sub-3c TikTok Phase 2 Batch 2D — provider helper to list identities.

import { createTiktokAdsClient } from './client'

export interface TiktokIdentityRecord {
  identityId: string
  identityType: 'AUTH_CODE' | 'CUSTOMIZED_USER' | 'TT_USER'
  displayName?: string
  profileImageUrl?: string
}

export interface ListIdentitiesArgs {
  advertiserId: string
  accessToken: string
  identityType?: 'AUTH_CODE' | 'CUSTOMIZED_USER' | 'TT_USER'
  fetchImpl?: typeof fetch
}

/** List TikTok identities the advertiser has access to. */
export async function listIdentities(args: ListIdentitiesArgs): Promise<TiktokIdentityRecord[]> {
  const client = createTiktokAdsClient({ accessToken: args.accessToken, fetchImpl: args.fetchImpl })
  const body: Record<string, unknown> = { advertiser_id: args.advertiserId }
  if (args.identityType) body.identity_type = args.identityType

  const data = await client.post<{
    identity_list?: Array<{
      identity_id: string
      identity_type: string
      display_name?: string
      profile_image?: string
    }>
  }>('/identity/get/', body)

  return (data.identity_list ?? []).map((i) => ({
    identityId: String(i.identity_id),
    identityType: (i.identity_type as TiktokIdentityRecord['identityType']),
    displayName: i.display_name,
    profileImageUrl: i.profile_image,
  }))
}
