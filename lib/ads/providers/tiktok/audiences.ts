// lib/ads/providers/tiktok/audiences.ts
// TikTok DMP Custom Audience — 5 subtype builders + lifecycle helpers.
// Sub-3c Phase 4.

import { createHash } from 'crypto'
import { createTiktokAdsClient } from './client'
import { TIKTOK_ADS_API_BASE } from './constants'

// ─── Types ────────────────────────────────────────────────────────────────────

export type TiktokAudienceType = 'CUSTOMER_FILE' | 'ENGAGEMENT' | 'LOOKALIKE' | 'APP_ACTIVITY'

export interface TiktokAudienceCallArgs {
  advertiserId: string
  accessToken: string
  /** Inject a fetch impl for testing (defaults to global fetch). */
  fetchImpl?: typeof fetch
}

export interface TiktokAudienceResult {
  customAudienceId: string
}

export interface TiktokAudienceStatusResult {
  /** 'BUILDING' | 'READY' | 'INVALID' | 'EXPIRED' | 'DELETED' | 'UNKNOWN' */
  status: string
  approximateUserNum?: number
}

// ─── Create (CUSTOMER_FILE / ENGAGEMENT / APP_ACTIVITY) ─────────────────────

/**
 * Create a customer-file, engagement, or app-activity audience.
 * Does NOT upload contacts — call uploadAudienceFile + applyAudienceFile next
 * for CUSTOMER_FILE types.
 */
export async function createAudience(
  args: TiktokAudienceCallArgs & {
    name: string
    /** LOOKALIKE uses a separate endpoint — use createLookalikeAudience for that. */
    audienceType: Exclude<TiktokAudienceType, 'LOOKALIKE'>
    description?: string
  },
): Promise<TiktokAudienceResult> {
  const client = createTiktokAdsClient({ accessToken: args.accessToken, fetchImpl: args.fetchImpl })
  const body: Record<string, unknown> = {
    advertiser_id: args.advertiserId,
    custom_audience_name: args.name,
    audience_type: args.audienceType,
  }
  if (args.description) body.description = args.description
  const data = await client.post<{ custom_audience_id: string | number }>(
    '/dmp/custom_audience/create/',
    body,
  )
  return { customAudienceId: String(data.custom_audience_id) }
}

// ─── Upload file ─────────────────────────────────────────────────────────────

/**
 * Upload a newline-delimited SHA-256 hash payload to TikTok.
 * Returns the file_path (and optionally file_id) needed for /apply/.
 */
export async function uploadAudienceFile(
  args: TiktokAudienceCallArgs & {
    customAudienceId: string
    /** Newline-delimited SHA-256 hashes — use rowsToTiktokPayload to build. */
    payload: string
    fileName?: string
  },
): Promise<{ filePath: string; fileId?: string }> {
  const url = `${TIKTOK_ADS_API_BASE}/dmp/custom_audience/file/upload/`
  const bytes = Buffer.from(args.payload, 'utf8')
  const signature = createHash('md5').update(bytes).digest('hex')

  const formData = new FormData()
  formData.append('advertiser_id', args.advertiserId)
  formData.append('custom_audience_id', args.customAudienceId)
  formData.append('file_signature', signature)
  const blob = new Blob([bytes as unknown as BlobPart])
  formData.append('custom_audience_file', blob, args.fileName ?? 'audience.txt')

  const fetchImpl = args.fetchImpl ?? fetch
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Access-Token': args.accessToken },
    body: formData as unknown as BodyInit,
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`TikTok audience file upload HTTP ${res.status} — ${text.slice(0, 200)}`)
  }

  const env = (await res.json()) as {
    code: number
    message: string
    data: { file_path?: string; file_id?: string }
  }
  if (env.code !== 0) {
    throw new Error(`TikTok audience file upload code=${env.code} message=${env.message}`)
  }

  return {
    filePath: env.data.file_path ?? env.data.file_id ?? '',
    fileId: env.data.file_id,
  }
}

// ─── Apply file ──────────────────────────────────────────────────────────────

/** Commit an uploaded file to the audience (apply step). */
export async function applyAudienceFile(
  args: TiktokAudienceCallArgs & {
    customAudienceId: string
    filePaths: string[]
  },
): Promise<void> {
  const client = createTiktokAdsClient({ accessToken: args.accessToken, fetchImpl: args.fetchImpl })
  await client.post('/dmp/custom_audience/apply/', {
    advertiser_id: args.advertiserId,
    custom_audience_id: args.customAudienceId,
    file_paths: args.filePaths,
  })
}

// ─── Lookalike ───────────────────────────────────────────────────────────────

/**
 * Create a lookalike audience seeded from an existing custom audience.
 * Uses TikTok's separate /dmp/custom_audience/lookalike/create/ endpoint.
 */
export async function createLookalikeAudience(
  args: TiktokAudienceCallArgs & {
    name: string
    /** ID of the source custom audience (must be READY). */
    sourceCustomAudienceId: string
    /** TikTok region IDs to target. */
    locationIds: number[]
    lookalikeSpec?: 'BALANCE' | 'EXPAND' | 'PRECISION'
  },
): Promise<TiktokAudienceResult> {
  const client = createTiktokAdsClient({ accessToken: args.accessToken, fetchImpl: args.fetchImpl })
  const data = await client.post<{ custom_audience_id: string | number }>(
    '/dmp/custom_audience/lookalike/create/',
    {
      advertiser_id: args.advertiserId,
      custom_audience_name: args.name,
      source_custom_audience_id: args.sourceCustomAudienceId,
      location_ids: args.locationIds,
      lookalike_spec: args.lookalikeSpec ?? 'BALANCE',
    },
  )
  return { customAudienceId: String(data.custom_audience_id) }
}

// ─── Status ──────────────────────────────────────────────────────────────────

/** Get audience status + approximate member count. */
export async function getAudienceStatus(
  args: TiktokAudienceCallArgs & { customAudienceId: string },
): Promise<TiktokAudienceStatusResult> {
  const client = createTiktokAdsClient({ accessToken: args.accessToken, fetchImpl: args.fetchImpl })
  const data = await client.post<{
    list?: Array<{
      custom_audience_id: string
      audience_status?: string
      approximate_user_num?: number
    }>
  }>('/dmp/custom_audience/get/', {
    advertiser_id: args.advertiserId,
    custom_audience_ids: [args.customAudienceId],
  })

  const item = (data.list ?? [])[0]
  return {
    status: item?.audience_status ?? 'UNKNOWN',
    approximateUserNum: item?.approximate_user_num,
  }
}

// ─── Delete ──────────────────────────────────────────────────────────────────

/** Delete an audience permanently. */
export async function deleteAudience(
  args: TiktokAudienceCallArgs & { customAudienceId: string },
): Promise<void> {
  const client = createTiktokAdsClient({ accessToken: args.accessToken, fetchImpl: args.fetchImpl })
  await client.post('/dmp/custom_audience/delete/', {
    advertiser_id: args.advertiserId,
    custom_audience_ids: [args.customAudienceId],
  })
}
