import type { EditorMediaKind } from './types'

export interface StockResult {
  id: string
  provider: 'pexels' | 'pixabay'
  mediaKind: Extract<EditorMediaKind, 'image' | 'video'>
  title: string
  thumbnailUrl: string
  downloadUrl: string
  attribution: string
  durationSeconds?: number
}

function stockImportHosts(): Set<string> {
  return new Set([
    'images.pexels.com',
    'videos.pexels.com',
    'cdn.pixabay.com',
    'pixabay.com',
    ...(process.env.STOCK_IMPORT_EXTRA_HOSTS ?? '').split(',').map((host) => host.trim()).filter(Boolean),
  ])
}

export function isAllowedStockImportUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' && stockImportHosts().has(parsed.hostname)
  } catch {
    return false
  }
}

interface PexelsPhoto {
  id: number
  alt?: string
  photographer?: string
  src?: { large2x?: string; large?: string; medium?: string }
}

interface PexelsVideoFile {
  link?: string
  height?: number
  width?: number
  quality?: string
}

interface PexelsVideo {
  id: number
  image?: string
  duration?: number
  user?: { name?: string }
  video_files?: PexelsVideoFile[]
}

export function normalizePexelsResults(body: { photos?: PexelsPhoto[]; videos?: PexelsVideo[] }): StockResult[] {
  const photos = (body.photos ?? []).map((photo): StockResult => ({
    id: `pexels-photo-${photo.id}`,
    provider: 'pexels',
    mediaKind: 'image',
    title: photo.alt || 'Pexels photo',
    thumbnailUrl: photo.src?.medium ?? '',
    downloadUrl: photo.src?.large2x ?? photo.src?.large ?? '',
    attribution: `${photo.photographer ?? 'Unknown'} - Pexels`,
  }))

  const videos = (body.videos ?? []).map((video): StockResult => {
    const best = [...(video.video_files ?? [])].sort((a, b) => (b.height ?? 0) - (a.height ?? 0))[0]
    return {
      id: `pexels-video-${video.id}`,
      provider: 'pexels',
      mediaKind: 'video',
      title: 'Pexels video',
      thumbnailUrl: video.image ?? '',
      downloadUrl: best?.link ?? '',
      attribution: `${video.user?.name ?? 'Unknown'} - Pexels`,
      durationSeconds: typeof video.duration === 'number' ? video.duration : undefined,
    }
  })

  return [...photos, ...videos].filter((result) => result.downloadUrl)
}

interface PixabayVideoVariant {
  url?: string
  width?: number
  height?: number
  size?: number
}

interface PixabayHit {
  id: number
  tags?: string
  user?: string
  previewURL?: string
  webformatURL?: string
  largeImageURL?: string
  videos?: {
    large?: PixabayVideoVariant
    medium?: PixabayVideoVariant
    small?: PixabayVideoVariant
    tiny?: PixabayVideoVariant
  }
  duration?: number
}

export function normalizePixabayResults(body: { hits?: PixabayHit[] }): StockResult[] {
  return (body.hits ?? [])
    .map((hit): StockResult => {
      const videoUrl = hit.videos?.large?.url ?? hit.videos?.medium?.url ?? hit.videos?.small?.url ?? hit.videos?.tiny?.url
      if (videoUrl) {
        return {
          id: `pixabay-video-${hit.id}`,
          provider: 'pixabay',
          mediaKind: 'video',
          title: hit.tags || 'Pixabay video',
          thumbnailUrl: hit.previewURL ?? hit.webformatURL ?? '',
          downloadUrl: videoUrl,
          attribution: `${hit.user ?? 'Unknown'} - Pixabay`,
          durationSeconds: typeof hit.duration === 'number' ? hit.duration : undefined,
        }
      }
      return {
        id: `pixabay-image-${hit.id}`,
        provider: 'pixabay',
        mediaKind: 'image',
        title: hit.tags || 'Pixabay image',
        thumbnailUrl: hit.previewURL ?? hit.webformatURL ?? '',
        downloadUrl: hit.largeImageURL ?? hit.webformatURL ?? '',
        attribution: `${hit.user ?? 'Unknown'} - Pixabay`,
      }
    })
    .filter((result) => result.downloadUrl)
}
