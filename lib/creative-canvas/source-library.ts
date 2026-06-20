import { adminDb } from '@/lib/firebase/admin'
import type {
  CreativeCanvasReferenceRole,
  CreativeCanvasSourceKind,
  CreativeCanvasSourceLibraryItem,
} from './types'

type FirestoreDoc = { id: string; data: () => Record<string, unknown> }

const COLLECTIONS = [
  'uploads',
  'workspace_artifacts',
  'research_items',
  'social_media',
  'social_posts',
  'youtube_source_assets',
  'book_studio_artifact_links',
] as const

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function cleanString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function cleanHttpUrl(value: unknown): string | undefined {
  const raw = cleanString(value)
  if (!raw) return undefined
  try {
    const parsed = new URL(raw)
    if (!['http:', 'https:'].includes(parsed.protocol)) return undefined
    if (parsed.username || parsed.password) return undefined
    return parsed.href
  } catch {
    return undefined
  }
}

function enumSourceKind(value: unknown): CreativeCanvasSourceKind | undefined {
  const allowed: CreativeCanvasSourceKind[] = [
    'brand_kit',
    'upload',
    'url',
    'research_item',
    'client_document',
    'campaign',
    'social_post',
    'youtube_asset',
    'book_studio_record',
    'workspace_artifact',
  ]
  return allowed.includes(value as CreativeCanvasSourceKind) ? value as CreativeCanvasSourceKind : undefined
}

function enumReferenceRole(value: unknown): CreativeCanvasReferenceRole | undefined {
  const allowed: CreativeCanvasReferenceRole[] = ['general', 'product', 'person', 'character', 'style', 'background', 'logo', 'mask', 'motion']
  return allowed.includes(value as CreativeCanvasReferenceRole) ? value as CreativeCanvasReferenceRole : undefined
}

function enumMediaType(value: unknown): 'image' | 'video' | 'audio' | 'document' | undefined {
  const allowed = ['image', 'video', 'audio', 'document'] as const
  return allowed.includes(value as typeof allowed[number]) ? value as typeof allowed[number] : undefined
}

function roleFromTitle(title: string): CreativeCanvasReferenceRole {
  const lower = title.toLowerCase()
  if (lower.includes('logo')) return 'logo'
  if (lower.includes('mask')) return 'mask'
  if (lower.includes('style') || lower.includes('mood')) return 'style'
  if (lower.includes('person') || lower.includes('founder') || lower.includes('portrait')) return 'person'
  if (lower.includes('product') || lower.includes('bottle') || lower.includes('pack')) return 'product'
  return 'general'
}

function mediaTypeForItem(item: CreativeCanvasSourceLibraryItem): 'image' | 'video' | 'audio' | 'document' {
  const mimeType = item.source.mimeType?.toLowerCase() ?? ''
  const url = `${item.source.url ?? ''} ${item.source.previewUrl ?? ''} ${item.source.storagePath ?? ''}`.toLowerCase()
  if (mimeType.startsWith('video/') || /\.(mp4|mov|webm|m4v)(\?|$)/.test(url)) return 'video'
  if (mimeType.startsWith('audio/') || /\.(mp3|wav|m4a|aac|ogg)(\?|$)/.test(url)) return 'audio'
  if (mimeType.startsWith('image/') || /\.(png|jpe?g|webp|gif|avif)(\?|$)/.test(url)) return 'image'
  return 'document'
}

function firstMedia(value: unknown): Record<string, unknown> {
  return Array.isArray(value) ? asRecord(value[0]) : {}
}

function sourceItem(input: {
  id: string
  title?: string
  description?: string
  sourceCollection: string
  kind: CreativeCanvasSourceKind
  refId: string
  url?: string
  thumbnailUrl?: string
  previewUrl?: string
  storagePath?: string
  mimeType?: string
  altText?: string
}): CreativeCanvasSourceLibraryItem | null {
  const title = cleanString(input.title) ?? input.refId
  return {
    id: `${input.kind}:${input.refId}`,
    title,
    description: cleanString(input.description),
    sourceCollection: input.sourceCollection,
    source: {
      kind: input.kind,
      refId: input.refId,
      url: cleanHttpUrl(input.url),
      thumbnailUrl: cleanHttpUrl(input.thumbnailUrl),
      previewUrl: cleanHttpUrl(input.previewUrl),
      storagePath: cleanString(input.storagePath),
      mimeType: cleanString(input.mimeType),
      altText: cleanString(input.altText) ?? title,
      referenceRole: roleFromTitle(title),
      weight: 1,
    },
  }
}

function fromUpload(doc: FirestoreDoc): CreativeCanvasSourceLibraryItem | null {
  const data = doc.data()
  return sourceItem({
    id: doc.id,
    title: cleanString(data.name) ?? cleanString(data.filename) ?? cleanString(data.fileName),
    description: cleanString(data.mimeType) ? `Upload / ${cleanString(data.mimeType)}` : 'Upload',
    sourceCollection: 'uploads',
    kind: 'upload',
    refId: doc.id,
    url: cleanString(data.url) ?? cleanString(data.publicUrl) ?? cleanString(data.downloadUrl),
    thumbnailUrl: cleanString(data.thumbnailUrl),
    previewUrl: cleanString(data.previewUrl),
    storagePath: cleanString(data.storagePath),
    mimeType: cleanString(data.mimeType),
  })
}

function fromWorkspaceArtifact(doc: FirestoreDoc): CreativeCanvasSourceLibraryItem | null {
  const data = doc.data()
  const google = asRecord(data.google)
  return sourceItem({
    id: doc.id,
    title: cleanString(data.title),
    description: cleanString(data.mimeType) ? `Workspace artifact / ${cleanString(data.mimeType)}` : 'Workspace artifact',
    sourceCollection: 'workspace_artifacts',
    kind: 'workspace_artifact',
    refId: doc.id,
    url: cleanString(google.webViewLink) ?? cleanString(google.url) ?? cleanString(data.piBCanonicalUrl),
    mimeType: cleanString(data.mimeType),
  })
}

function fromResearchItem(doc: FirestoreDoc): CreativeCanvasSourceLibraryItem | null {
  const data = doc.data()
  return sourceItem({
    id: doc.id,
    title: cleanString(data.title),
    description: cleanString(data.summary) ?? 'Research item',
    sourceCollection: 'research_items',
    kind: 'research_item',
    refId: doc.id,
    altText: cleanString(data.summary),
  })
}

function fromSocialMedia(doc: FirestoreDoc): CreativeCanvasSourceLibraryItem | null {
  const data = doc.data()
  return sourceItem({
    id: doc.id,
    title: cleanString(data.title) ?? cleanString(data.name) ?? cleanString(data.fileName),
    description: cleanString(data.type) ? `Social media / ${cleanString(data.type)}` : 'Social media',
    sourceCollection: 'social_media',
    kind: 'social_post',
    refId: doc.id,
    url: cleanString(data.url) ?? cleanString(data.originalUrl),
    thumbnailUrl: cleanString(data.thumbnailUrl),
    storagePath: cleanString(data.storagePath),
    mimeType: cleanString(data.mimeType),
  })
}

function fromSocialPost(doc: FirestoreDoc): CreativeCanvasSourceLibraryItem | null {
  const data = doc.data()
  const media = firstMedia(data.media)
  return sourceItem({
    id: doc.id,
    title: cleanString(data.title) ?? cleanString(data.platform) ?? 'Social post',
    description: cleanString(data.platform) ? `Social post / ${cleanString(data.platform)}` : 'Social post',
    sourceCollection: 'social_posts',
    kind: 'social_post',
    refId: doc.id,
    url: cleanString(media.url),
    thumbnailUrl: cleanString(media.thumbnailUrl),
    previewUrl: cleanString(media.previewUrl),
    mimeType: cleanString(media.mimeType) ?? cleanString(media.type),
  })
}

function fromYouTubeSourceAsset(doc: FirestoreDoc): CreativeCanvasSourceLibraryItem | null {
  const data = doc.data()
  return sourceItem({
    id: doc.id,
    title: cleanString(data.title) ?? cleanString(data.name),
    description: cleanString(data.mediaFormat) ? `YouTube asset / ${cleanString(data.mediaFormat)}` : 'YouTube asset',
    sourceCollection: 'youtube_source_assets',
    kind: 'youtube_asset',
    refId: doc.id,
    url: cleanString(data.sourceUrl),
    thumbnailUrl: cleanString(data.thumbnailUrl),
    storagePath: cleanString(data.storagePath),
    mimeType: cleanString(data.mimeType),
  })
}

function fromBookStudioArtifact(doc: FirestoreDoc): CreativeCanvasSourceLibraryItem | null {
  const data = doc.data()
  return sourceItem({
    id: doc.id,
    title: cleanString(data.label) ?? cleanString(data.title),
    description: 'Book Studio artifact',
    sourceCollection: 'book_studio_artifact_links',
    kind: 'book_studio_record',
    refId: doc.id,
    url: cleanString(data.href) ?? cleanString(data.url),
    thumbnailUrl: cleanString(data.thumbnailUrl),
    mimeType: cleanString(data.mimeType),
  })
}

function mapDoc(collection: string, doc: FirestoreDoc): CreativeCanvasSourceLibraryItem | null {
  const data = doc.data()
  if (data.deleted === true) return null
  switch (collection) {
    case 'uploads':
      return fromUpload(doc)
    case 'workspace_artifacts':
      return fromWorkspaceArtifact(doc)
    case 'research_items':
      return fromResearchItem(doc)
    case 'social_media':
      return fromSocialMedia(doc)
    case 'social_posts':
      return fromSocialPost(doc)
    case 'youtube_source_assets':
      return fromYouTubeSourceAsset(doc)
    case 'book_studio_artifact_links':
      return fromBookStudioArtifact(doc)
    default:
      return null
  }
}

export async function listCreativeCanvasSourceLibrary(input: {
  orgId: string
  query?: string | null
  sourceKind?: string | null
  referenceRole?: string | null
  mediaType?: string | null
  limit?: number
}): Promise<CreativeCanvasSourceLibraryItem[]> {
  const collections = await Promise.all(COLLECTIONS.map(async (collection) => {
    const snapshot = await adminDb.collection(collection).where('orgId', '==', input.orgId).get()
    return snapshot.docs
      .map((doc) => mapDoc(collection, doc as FirestoreDoc))
      .filter((item): item is CreativeCanvasSourceLibraryItem => Boolean(item))
  }))

  const query = cleanString(input.query)?.toLowerCase()
  const sourceKind = enumSourceKind(input.sourceKind)
  const referenceRole = enumReferenceRole(input.referenceRole)
  const mediaType = enumMediaType(input.mediaType)
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100)
  return collections
    .flat()
    .filter((item) => !query || `${item.title} ${item.description ?? ''} ${item.source.kind}`.toLowerCase().includes(query))
    .filter((item) => !sourceKind || item.source.kind === sourceKind)
    .filter((item) => !referenceRole || item.source.referenceRole === referenceRole)
    .filter((item) => !mediaType || mediaTypeForItem(item) === mediaType)
    .sort((a, b) => a.title.localeCompare(b.title))
    .slice(0, limit)
}
