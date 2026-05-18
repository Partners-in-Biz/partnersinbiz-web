// lib/ads/providers/google/asset-groups.ts
// Google Ads Performance Max asset group helper — Sub-3a-ext.
// Wraps `customers/{cid}/assetGroups:mutate` and `customers/{cid}/assetGroupAssets:mutate`
// plus a bulk text asset creator via `customers/{cid}/assets:mutate`.

import { GOOGLE_ADS_API_BASE_URL } from './constants'

interface CallArgs {
  customerId: string  // 10-digit, no dashes
  accessToken: string
  developerToken: string
  loginCustomerId?: string
}

function buildHeaders(args: CallArgs): Record<string, string> {
  const h: Record<string, string> = {
    Authorization: `Bearer ${args.accessToken}`,
    'developer-token': args.developerToken,
    'Content-Type': 'application/json',
  }
  if (args.loginCustomerId) h['login-customer-id'] = args.loginCustomerId
  return h
}

/** Pmax asset field types supported by the asset group linker. */
export type AssetFieldType =
  | 'HEADLINE'
  | 'LONG_HEADLINE'
  | 'DESCRIPTION'
  | 'MARKETING_IMAGE'
  | 'SQUARE_MARKETING_IMAGE'
  | 'PORTRAIT_MARKETING_IMAGE'
  | 'LOGO'
  | 'LANDSCAPE_LOGO'
  | 'YOUTUBE_VIDEO'
  | 'BUSINESS_NAME'
  | 'CALL_TO_ACTION_SELECTION'

export interface AssetGroupAssetLink {
  assetResourceName: string
  fieldType: AssetFieldType
}

/**
 * Create a Performance Max asset group with linked assets.
 *
 * Two-step internally:
 *  1. `assetGroups:mutate` — creates the group shell.
 *  2. `assetGroupAssets:mutate` — links pre-created asset resourceNames to the group.
 */
export async function createAssetGroup(
  args: CallArgs & {
    campaignResourceName: string
    name: string
    finalUrls: string[]
    finalMobileUrls?: string[]
    status?: 'ENABLED' | 'PAUSED'
    /** Asset resourceNames + field types. Caller pre-creates the assets via assets:mutate. */
    assetLinks: AssetGroupAssetLink[]
  },
): Promise<{ resourceName: string; id: string }> {
  // Step 1: create the asset group shell
  const agUrl = `${GOOGLE_ADS_API_BASE_URL}/customers/${args.customerId}/assetGroups:mutate`
  const agBody = {
    operations: [
      {
        create: {
          name: args.name,
          campaign: args.campaignResourceName,
          status: args.status ?? 'PAUSED',
          finalUrls: args.finalUrls,
          ...(args.finalMobileUrls ? { finalMobileUrls: args.finalMobileUrls } : {}),
        },
      },
    ],
  }
  const agRes = await fetch(agUrl, {
    method: 'POST',
    headers: buildHeaders(args),
    body: JSON.stringify(agBody),
  })
  if (!agRes.ok) {
    const text = await agRes.text()
    throw new Error(`Google asset group create failed: HTTP ${agRes.status} — ${text}`)
  }
  const agData = await agRes.json() as { results: Array<{ resourceName: string }> }
  const agResourceName = agData.results[0]?.resourceName
  if (!agResourceName) throw new Error('Asset group creation returned no resourceName')
  const agId = agResourceName.split('/').pop() ?? ''

  // Step 2: link assets to the group (skip if nothing to link)
  if (args.assetLinks.length > 0) {
    const linkUrl = `${GOOGLE_ADS_API_BASE_URL}/customers/${args.customerId}/assetGroupAssets:mutate`
    const linkBody = {
      operations: args.assetLinks.map((link) => ({
        create: {
          assetGroup: agResourceName,
          asset: link.assetResourceName,
          fieldType: link.fieldType,
        },
      })),
    }
    const linkRes = await fetch(linkUrl, {
      method: 'POST',
      headers: buildHeaders(args),
      body: JSON.stringify(linkBody),
    })
    if (!linkRes.ok) {
      const text = await linkRes.text()
      throw new Error(`Google asset group asset link failed: HTTP ${linkRes.status} — ${text}`)
    }
  }

  return { resourceName: agResourceName, id: agId }
}

/**
 * Create text assets in bulk via `assets:mutate`.
 * Returns each text alongside its new resourceName.
 */
export async function createTextAssets(
  args: CallArgs & { texts: string[] },
): Promise<Array<{ resourceName: string; id: string; text: string }>> {
  if (args.texts.length === 0) return []

  const url = `${GOOGLE_ADS_API_BASE_URL}/customers/${args.customerId}/assets:mutate`
  const body = {
    operations: args.texts.map((text) => ({
      create: {
        type: 'TEXT',
        name: `txt:${text.slice(0, 40)}`,
        textAsset: { text },
      },
    })),
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: buildHeaders(args),
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Google text assets create failed: HTTP ${res.status} — ${text}`)
  }
  const data = await res.json() as { results: Array<{ resourceName: string }> }
  return data.results.map((r, i) => ({
    resourceName: r.resourceName,
    id: r.resourceName.split('/').pop() ?? '',
    text: args.texts[i],
  }))
}
