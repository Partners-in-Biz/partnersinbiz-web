import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { ensureOrgAccess } from '@/lib/youtube-studio/api'
import { isAllowedStockImportUrl, type StockResult } from '@/lib/video-editor/stock'
import { saveVideoEditorUpload } from '@/lib/video-editor/storage'

export const dynamic = 'force-dynamic'

const MAX_STOCK_IMPORT_BYTES = 50 * 1024 * 1024
const MAX_REDIRECTS = 5

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function cleanText(value: string, maxLength: number): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, maxLength)
}

function isStockResult(value: unknown): value is StockResult {
  const result = value as Partial<StockResult> | null
  return Boolean(result
    && (result.provider === 'pexels' || result.provider === 'pixabay')
    && (result.mediaKind === 'image' || result.mediaKind === 'video')
    && cleanString(result.id)
    && cleanString(result.downloadUrl)
    && cleanString(result.thumbnailUrl)
    && isAllowedStockImportUrl(cleanString(result.thumbnailUrl))
    && cleanString(result.title)
    && cleanString(result.attribution))
}

function inferMimeType(result: StockResult, mimeType: string, url: string): string | null {
  const normalized = mimeType.toLowerCase()
  if (normalized.startsWith(`${result.mediaKind}/`)) return normalized
  if (normalized.startsWith('image/') || normalized.startsWith('video/')) return null
  if (normalized && normalized !== 'application/octet-stream') return null
  if (result.mediaKind === 'image') {
    if (/\.(jpe?g)(\?|$)/i.test(url)) return 'image/jpeg'
    if (/\.png(\?|$)/i.test(url)) return 'image/png'
    if (/\.webp(\?|$)/i.test(url)) return 'image/webp'
  }
  if (result.mediaKind === 'video') {
    if (/\.mp4(\?|$)/i.test(url)) return 'video/mp4'
    if (/\.webm(\?|$)/i.test(url)) return 'video/webm'
  }
  return null
}

function extensionFor(mimeType: string, url: string, result: StockResult): string {
  const pathExt = new URL(url).pathname.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '')
  if (mimeType === 'image/png') return 'png'
  if (mimeType === 'image/webp') return 'webp'
  if (mimeType === 'image/jpeg') return 'jpg'
  if (mimeType === 'video/webm') return 'webm'
  if (mimeType === 'video/mp4') return 'mp4'
  if (pathExt && pathExt.length <= 5) return pathExt === 'jpeg' ? 'jpg' : pathExt
  return result.mediaKind === 'image' ? 'jpg' : 'mp4'
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 80) || `stock-${Date.now()}`
}

async function fetchStockAsset(url: string): Promise<{ buffer: Buffer; mimeType: string; finalUrl: string }> {
  let currentUrl = url
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    if (!isAllowedStockImportUrl(currentUrl)) throw new Error('Stock redirect URL is not allowed')
    const res = await fetch(currentUrl, { redirect: 'manual' })
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location')
      if (!location) throw new Error('Stock redirect did not include a location')
      currentUrl = new URL(location, currentUrl).toString()
      continue
    }
    if (!res.ok) throw new Error(`Stock download failed with ${res.status}`)
    const contentLength = Number(res.headers.get('content-length') ?? '0')
    if (contentLength > MAX_STOCK_IMPORT_BYTES) throw new Error('Stock asset is larger than 50 MB')
    const chunks: Buffer[] = []
    let size = 0
    if (res.body) {
      const reader = res.body.getReader()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = Buffer.from(value)
        size += chunk.length
        if (size > MAX_STOCK_IMPORT_BYTES) {
          await reader.cancel().catch(() => {})
          throw new Error('Stock asset is larger than 50 MB')
        }
        chunks.push(chunk)
      }
    } else {
      const arrayBuffer = await res.arrayBuffer()
      size = arrayBuffer.byteLength
      if (size > MAX_STOCK_IMPORT_BYTES) throw new Error('Stock asset is larger than 50 MB')
      chunks.push(Buffer.from(arrayBuffer))
    }
    const mimeType = res.headers.get('content-type')?.split(';')[0].trim() ?? ''
    return { buffer: Buffer.concat(chunks), mimeType, finalUrl: currentUrl }
  }
  throw new Error('Stock redirect limit exceeded')
}

export const POST = withAuth('client', async (req: NextRequest, user) => {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const orgId = cleanString(body.orgId)
  if (!orgId) return apiError('orgId is required', 400)
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied

  const result = body.result
  if (!isStockResult(result)) return apiError('result is required', 400)
  if (!isAllowedStockImportUrl(result.downloadUrl)) return apiError('Stock URL is not allowed', 400)

  let asset
  try {
    asset = await fetchStockAsset(result.downloadUrl)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not download stock asset'
    const status = message.includes('allowed') || message.includes('larger') ? 400 : 502
    return apiError(message, status)
  }

  const mimeType = inferMimeType(result, asset.mimeType, asset.finalUrl)
  if (!mimeType) return apiError('Downloaded stock asset did not match the requested media kind', 400)
  const ext = extensionFor(mimeType, asset.finalUrl, result)
  const filename = `${safeId(result.id)}.${ext}`
  const title = cleanText(result.title, 160)
  const attribution = cleanText(result.attribution, 200)
  const uploaded = await saveVideoEditorUpload(asset.buffer, {
    orgId,
    folder: `video-editor/${orgId}/stock`,
    filename,
    mimeType,
    user,
    relatedTo: { type: 'video_editor_stock', id: result.id },
  })

  await adminDb.collection('uploads').doc(uploaded.id).set({
    name: title,
    filename,
    source: 'stock',
    attribution,
    previewUrl: uploaded.url,
    thumbnailUrl: result.mediaKind === 'image' ? uploaded.url : result.thumbnailUrl,
    stock: {
      provider: result.provider,
      sourceId: result.id,
      sourceUrl: result.downloadUrl,
      importedFromUrl: asset.finalUrl,
    },
    provenance: {
      source: 'stock',
      provider: result.provider,
      sourceId: result.id,
      sourceUrl: result.downloadUrl,
      importedFromUrl: asset.finalUrl,
      attribution,
    },
  }, { merge: true })

  return apiSuccess({
    upload: {
      fileId: uploaded.id,
      url: uploaded.url,
      mediaKind: result.mediaKind,
    },
  }, 201)
})
