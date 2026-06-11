// lib/ads/providers/meta/creative-sync.ts
import type { AdCreative, PlatformCreativeRef } from '@/lib/ads/types'
import { setPlatformRef } from '@/lib/ads/creatives/store'
import { Timestamp } from 'firebase-admin/firestore'
import { META_GRAPH_BASE } from './constants'
import { uploadImageFromUrl } from './image-upload'

/**
 * Upload an image creative to Meta's /adimages and return its hash.
 * Reuses the Phase 2 helper that downloads bytes from a URL and POSTs to /adimages.
 */
export async function syncImageCreative(args: {
  adAccountId: string
  accessToken: string
  creative: AdCreative
}): Promise<{ metaCreativeId: string; hash?: string }> {
  if (args.creative.type !== 'image' && args.creative.type !== 'carousel_card') {
    // Allow carousel_card here since each card is an image at Meta's level
    throw new Error(`syncImageCreative called with type ${args.creative.type}`)
  }
  if (!args.creative.sourceUrl || !args.creative.mimeType || !args.creative.fileSize) {
    throw new Error('Meta image creative sync blocked: missing sourceUrl, mimeType, or fileSize')
  }
  const hash = await uploadImageFromUrl({
    adAccountId: args.adAccountId,
    accessToken: args.accessToken,
    sourceUrl: args.creative.sourceUrl,
  })
  return { metaCreativeId: hash, hash }
}

/**
 * Upload a video creative to Meta's /advideos (single-step).
 * For Phase 3, single-step POST is sufficient (assets <100MB). Phase 3b adds chunked.
 */
export async function syncVideoCreative(args: {
  adAccountId: string
  accessToken: string
  creative: AdCreative
}): Promise<{ metaCreativeId: string }> {
  if (args.creative.type !== 'video') {
    throw new Error(`syncVideoCreative called with type ${args.creative.type}`)
  }
  if (!args.creative.sourceUrl || !args.creative.mimeType || !args.creative.fileSize || !args.creative.duration) {
    throw new Error('Meta video creative sync blocked: missing sourceUrl, mimeType, fileSize, or duration')
  }

  // 1. Download bytes from Firebase Storage
  const dl = await fetch(args.creative.sourceUrl)
  if (!dl.ok) {
    throw new Error(`Video download failed: HTTP ${dl.status}`)
  }
  const bytes = new Uint8Array(await dl.arrayBuffer())

  // 2. POST to /advideos as multipart
  const accountId = args.adAccountId.startsWith('act_') ? args.adAccountId : `act_${args.adAccountId}`
  const url = `${META_GRAPH_BASE}/${accountId}/advideos`
  const form = new FormData()
  const filename = `phase3_video_${Date.now()}.mp4`
  form.append('source', new Blob([bytes], { type: args.creative.mimeType }), filename)
  form.append('name', args.creative.name)
  form.append('access_token', args.accessToken)

  const up = await fetch(url, { method: 'POST', body: form })
  const body = (await up.json()) as { id?: string; error?: { message: string } }
  if (!up.ok || body.error) {
    throw new Error(`Meta /advideos failed: ${body.error?.message ?? `HTTP ${up.status}`}`)
  }
  if (!body.id) {
    throw new Error('Meta /advideos returned no video id')
  }
  return { metaCreativeId: body.id }
}

/**
 * Orchestrator: ensures a creative is synced to Meta. If already in
 * platformRefs.meta, return cached; otherwise sync + persist the ref.
 */
export async function ensureSynced(args: {
  orgId: string
  adAccountId: string
  accessToken: string
  creative: AdCreative
}): Promise<{ metaCreativeId: string; alreadySynced: boolean }> {
  const existing = args.creative.platformRefs?.meta
  if (existing) {
    return { metaCreativeId: existing.creativeId, alreadySynced: true }
  }

  let synced: { metaCreativeId: string; hash?: string }
  if (args.creative.type === 'video') {
    synced = await syncVideoCreative(args)
  } else {
    // image OR carousel_card
    synced = await syncImageCreative(args)
  }

  const ref: PlatformCreativeRef = {
    creativeId: synced.metaCreativeId,
    hash: synced.hash,
    syncedAt: Timestamp.now(),
  }
  await setPlatformRef(args.creative.id, 'meta', ref)

  return { metaCreativeId: synced.metaCreativeId, alreadySynced: false }
}
