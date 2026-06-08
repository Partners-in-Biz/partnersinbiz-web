import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import {
  actorFields,
  ensureOrgAccess,
  listByOrg,
  loadScopedRecord,
  stripUndefinedDeep,
  updateActorFields,
  YOUTUBE_COLLECTIONS,
} from '@/lib/youtube-studio/api'
import { serializeYouTubeRecord } from '@/lib/youtube-studio/sanitize'
import type { YouTubeGateCheck, YouTubePublishingPacket } from '@/lib/youtube-studio/types'

export const dynamic = 'force-dynamic'

type PacketChecks = YouTubePublishingPacket['checks']
type PacketCheckKey = keyof PacketChecks

const PACKET_CHECK_KEYS: PacketCheckKey[] = [
  'rights',
  'aiDisclosure',
  'madeForKids',
  'metadata',
  'thumbnail',
  'captions',
  'approval',
  'connectedAccount',
]

const GATE_STATUSES: YouTubeGateCheck['status'][] = ['pass', 'warning', 'block', 'not_applicable']

function cleanString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function cleanObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function cleanStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(cleanString).filter((item): item is string => Boolean(item))
  if (typeof value === 'string') return value.split(/[\n,]+/).map((item) => item.trim()).filter(Boolean)
  return []
}

function cleanPositiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

function hasOwn(source: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(source, key)
}

function pickGateStatus(value: unknown, fallback: YouTubeGateCheck['status']): YouTubeGateCheck['status'] {
  return GATE_STATUSES.includes(value as YouTubeGateCheck['status']) ? value as YouTubeGateCheck['status'] : fallback
}

function defaultGateCheck(message: string): YouTubeGateCheck {
  return {
    status: 'warning',
    message,
  }
}

function defaultChecks(): YouTubePublishingPacket['checks'] {
  return {
    rights: defaultGateCheck('Rights review required before publishing.'),
    aiDisclosure: defaultGateCheck('AI disclosure review required before publishing.'),
    madeForKids: defaultGateCheck('Made for kids declaration required before publishing.'),
    metadata: defaultGateCheck('Metadata requires review.'),
    thumbnail: defaultGateCheck('Thumbnail requires review.'),
    captions: defaultGateCheck('Captions require review.'),
    approval: defaultGateCheck('Internal approval required before publishing.'),
    connectedAccount: defaultGateCheck('Connected account requires review before publishing.'),
  }
}

function cleanGateCheck(value: unknown, fallback: YouTubeGateCheck): YouTubeGateCheck {
  const source = cleanObject(value)

  return {
    status: pickGateStatus(source.status, fallback.status),
    message: cleanString(source.message) ?? fallback.message,
  }
}

function cleanGateChecks(value: unknown, existing?: unknown): PacketChecks {
  const source = cleanObject(value)
  const existingSource = cleanObject(existing)
  const defaults = defaultChecks()

  return Object.fromEntries(PACKET_CHECK_KEYS.map((key) => {
    const fallback = cleanGateCheck(existingSource[key], defaults[key])
    return [key, cleanGateCheck(source[key], fallback)]
  })) as PacketChecks
}

function cleanTitleOptions(value: unknown): YouTubePublishingPacket['titleOptions'] {
  if (!Array.isArray(value)) return []

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
    const source = entry as Record<string, unknown>
    const text = cleanString(source.text)
    if (!text) return []

    return [stripUndefinedDeep({
      text,
      rationale: cleanString(source.rationale),
      selected: typeof source.selected === 'boolean' ? source.selected : undefined,
    })]
  })
}

function cleanChapters(value: unknown): YouTubePublishingPacket['chapters'] {
  if (!Array.isArray(value)) return []

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
    const source = entry as Record<string, unknown>
    const startSeconds = cleanPositiveNumber(source.startSeconds)
    const title = cleanString(source.title)
    if (startSeconds === undefined || !title) return []

    return [{ startSeconds, title }]
  })
}

function valueFromPatch(body: Record<string, unknown>, existing: Record<string, unknown>, key: string): unknown {
  return hasOwn(body, key) ? body[key] : existing[key]
}

export const GET = withAuth('admin', async (req, user) => {
  const url = new URL(req.url)
  const orgId = url.searchParams.get('orgId')?.trim() ?? ''
  const videoProjectId = url.searchParams.get('videoProjectId')?.trim() ?? ''
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied

  const docs = await listByOrg(YOUTUBE_COLLECTIONS.packets, orgId)
  const packets = docs
    .map((doc) => serializeYouTubeRecord<YouTubePublishingPacket>(doc.id, doc.data()))
    .filter((packet) => !videoProjectId || packet.videoProjectId === videoProjectId)

  return apiSuccess({ packets })
})

export const POST = withAuth('admin', async (req: NextRequest, user) => {
  const body = await req.json().catch(() => ({}))
  const orgId = cleanString(body.orgId) ?? ''
  const channelWorkspaceId = cleanString(body.channelWorkspaceId) ?? ''
  const videoProjectId = cleanString(body.videoProjectId) ?? ''
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied
  if (!channelWorkspaceId) return apiError('channelWorkspaceId is required', 400)
  if (!videoProjectId) return apiError('videoProjectId is required', 400)

  const channel = await loadScopedRecord(YOUTUBE_COLLECTIONS.channels, channelWorkspaceId)
  if (!channel || channel.data.deleted === true) return apiError('YouTube channel workspace not found', 404)
  if (channel.data.orgId !== orgId) return apiError('channelWorkspaceId does not belong to organisation', 400)

  const video = await loadScopedRecord(YOUTUBE_COLLECTIONS.videos, videoProjectId)
  if (!video || video.data.deleted === true) return apiError('Video project not found', 404)
  if (video.data.orgId !== orgId) return apiError('videoProjectId does not belong to organisation', 400)
  if (video.data.channelWorkspaceId && video.data.channelWorkspaceId !== channelWorkspaceId) {
    return apiError('channelWorkspaceId does not match video project', 400)
  }

  const supersedesPacketId = cleanString(body.supersedesPacketId)
  if (supersedesPacketId) {
    const superseded = await loadScopedRecord(YOUTUBE_COLLECTIONS.packets, supersedesPacketId)
    if (!superseded || superseded.data.deleted === true) return apiError('Superseded publishing packet not found', 404)
    if (superseded.data.orgId !== orgId) return apiError('supersedesPacketId does not belong to organisation', 400)
    if (superseded.data.videoProjectId !== videoProjectId) {
      return apiError('supersedesPacketId does not belong to video project', 400)
    }
  }

  const packet = stripUndefinedDeep({
    orgId,
    channelWorkspaceId,
    videoProjectId,
    versionNumber: typeof body.versionNumber === 'number' && Number.isFinite(body.versionNumber)
      ? Math.max(1, Math.floor(body.versionNumber))
      : 1,
    supersedesPacketId,
    status: 'draft',
    titleOptions: cleanTitleOptions(body.titleOptions),
    description: cleanString(body.description),
    tags: cleanStringArray(body.tags),
    chapters: cleanChapters(body.chapters),
    thumbnailAssetId: cleanString(body.thumbnailAssetId),
    captionAssetId: cleanString(body.captionAssetId),
    videoAssetId: cleanString(body.videoAssetId),
    visibility: 'private',
    publishAt: body.publishAt,
    selfDeclaredMadeForKids: typeof body.selfDeclaredMadeForKids === 'boolean' ? body.selfDeclaredMadeForKids : undefined,
    containsSyntheticMedia: typeof body.containsSyntheticMedia === 'boolean' ? body.containsSyntheticMedia : undefined,
    aiDisclosureNotes: cleanString(body.aiDisclosureNotes),
    checks: defaultChecks(),
    deleted: false,
    ...actorFields(user),
  })

  const packetRef = adminDb.collection(YOUTUBE_COLLECTIONS.packets).doc()
  const batch = adminDb.batch()
  batch.set(packetRef, packet)
  batch.set(video.ref, {
    publishPacketId: packetRef.id,
    ...updateActorFields(user),
  }, { merge: true })
  await batch.commit()

  return apiSuccess({ id: packetRef.id }, 201)
})

export const PUT = withAuth('admin', async (req: NextRequest, user) => {
  const rawBody = await req.json().catch(() => ({}))
  const body = cleanObject(rawBody)
  const id = cleanString(body.id) ?? ''
  if (!id) return apiError('id is required', 400)

  const loaded = await loadScopedRecord(YOUTUBE_COLLECTIONS.packets, id)
  if (!loaded || loaded.data.deleted === true) return apiError('Publishing packet not found', 404)

  const orgId = cleanString(loaded.data.orgId) ?? ''
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied

  const channelWorkspaceId = cleanString(loaded.data.channelWorkspaceId) ?? ''
  const videoProjectId = cleanString(loaded.data.videoProjectId) ?? ''

  if (!channelWorkspaceId) return apiError('channelWorkspaceId is required', 400)
  if (!videoProjectId) return apiError('videoProjectId is required', 400)
  if (hasOwn(body, 'channelWorkspaceId') && cleanString(body.channelWorkspaceId) !== channelWorkspaceId) {
    return apiError('channelWorkspaceId cannot be changed for an existing publishing packet', 400)
  }
  if (hasOwn(body, 'videoProjectId') && cleanString(body.videoProjectId) !== videoProjectId) {
    return apiError('videoProjectId cannot be changed for an existing publishing packet', 400)
  }

  const channel = await loadScopedRecord(YOUTUBE_COLLECTIONS.channels, channelWorkspaceId)
  if (!channel || channel.data.deleted === true) return apiError('YouTube channel workspace not found', 404)
  if (channel.data.orgId !== orgId) return apiError('channelWorkspaceId does not belong to organisation', 400)

  const video = await loadScopedRecord(YOUTUBE_COLLECTIONS.videos, videoProjectId)
  if (!video || video.data.deleted === true) return apiError('Video project not found', 404)
  if (video.data.orgId !== orgId) return apiError('videoProjectId does not belong to organisation', 400)
  if (video.data.channelWorkspaceId && video.data.channelWorkspaceId !== channelWorkspaceId) {
    return apiError('channelWorkspaceId does not match video project', 400)
  }

  const supersedesPacketId = hasOwn(body, 'supersedesPacketId')
    ? cleanString(body.supersedesPacketId)
    : cleanString(loaded.data.supersedesPacketId)
  if (supersedesPacketId) {
    if (supersedesPacketId === id) return apiError('supersedesPacketId cannot reference the same packet', 400)

    const superseded = await loadScopedRecord(YOUTUBE_COLLECTIONS.packets, supersedesPacketId)
    if (!superseded || superseded.data.deleted === true) return apiError('Superseded publishing packet not found', 404)
    if (superseded.data.orgId !== orgId) return apiError('supersedesPacketId does not belong to organisation', 400)
    if (superseded.data.videoProjectId !== videoProjectId) {
      return apiError('supersedesPacketId does not belong to video project', 400)
    }
  }

  const versionSource = valueFromPatch(body, loaded.data, 'versionNumber')
  const versionNumber = typeof versionSource === 'number' && Number.isFinite(versionSource)
    ? Math.max(1, Math.floor(versionSource))
    : 1

  const packet = stripUndefinedDeep({
    orgId,
    channelWorkspaceId,
    videoProjectId,
    versionNumber,
    supersedesPacketId,
    status: 'draft',
    titleOptions: cleanTitleOptions(valueFromPatch(body, loaded.data, 'titleOptions')),
    description: cleanString(valueFromPatch(body, loaded.data, 'description')),
    tags: cleanStringArray(valueFromPatch(body, loaded.data, 'tags')),
    chapters: cleanChapters(valueFromPatch(body, loaded.data, 'chapters')),
    thumbnailAssetId: cleanString(valueFromPatch(body, loaded.data, 'thumbnailAssetId')),
    captionAssetId: cleanString(valueFromPatch(body, loaded.data, 'captionAssetId')),
    videoAssetId: cleanString(valueFromPatch(body, loaded.data, 'videoAssetId')),
    visibility: 'private',
    publishAt: loaded.data.publishAt,
    selfDeclaredMadeForKids: typeof valueFromPatch(body, loaded.data, 'selfDeclaredMadeForKids') === 'boolean'
      ? valueFromPatch(body, loaded.data, 'selfDeclaredMadeForKids')
      : undefined,
    containsSyntheticMedia: typeof valueFromPatch(body, loaded.data, 'containsSyntheticMedia') === 'boolean'
      ? valueFromPatch(body, loaded.data, 'containsSyntheticMedia')
      : undefined,
    aiDisclosureNotes: cleanString(valueFromPatch(body, loaded.data, 'aiDisclosureNotes')),
    checks: cleanGateChecks(body.checks, loaded.data.checks),
    deleted: false,
    ...updateActorFields(user),
  })

  await loaded.ref.set(packet, { merge: true })

  return apiSuccess({ id, updated: true })
})
