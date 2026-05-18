import crypto from 'crypto'
import { TIKTOK_ADS_API_BASE } from './constants'

export interface TiktokCreativeCallArgs {
  advertiserId: string
  accessToken: string
  fetchImpl?: typeof fetch
}

export interface ImageUploadResult {
  imageId: string
  imageUrl: string
  fileName?: string
  format?: string
  width?: number
  height?: number
  size?: number
  signature?: string
}

export interface VideoUploadResult {
  videoId: string
  videoCoverUrl?: string
  duration?: number
  format?: string
  width?: number
  height?: number
  size?: number
  signature?: string
}

/** MD5 hex of bytes — TikTok requires this for upload integrity validation. */
export function md5Hex(bytes: Buffer | Uint8Array): string {
  return crypto.createHash('md5').update(bytes).digest('hex')
}

interface TiktokEnvelope<T> {
  code: number
  message: string
  data: T
}

/** Upload an image to TikTok via multipart UPLOAD_BY_FILE. Returns the image_id for use in /ad/create/. */
export async function uploadImageBytes(
  args: TiktokCreativeCallArgs & {
    bytes: Buffer | Uint8Array
    fileName?: string
  },
): Promise<ImageUploadResult> {
  const url = `${TIKTOK_ADS_API_BASE}/file/image/ad/upload/`
  const signature = md5Hex(args.bytes)

  const formData = new FormData()
  formData.append('advertiser_id', args.advertiserId)
  formData.append('upload_type', 'UPLOAD_BY_FILE')
  formData.append('image_signature', signature)
  if (args.fileName) formData.append('file_name', args.fileName)

  // FormData accepts Blob in browsers + Node 22 — wrap bytes as Blob
  const blob = new Blob([args.bytes as unknown as BlobPart])
  formData.append('image_file', blob, args.fileName ?? 'image.jpg')

  const fetchImpl = args.fetchImpl ?? fetch
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Access-Token': args.accessToken },
    body: formData as unknown as BodyInit,
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`TikTok image upload HTTP ${res.status} — ${text.slice(0, 200)}`)
  }
  const env = (await res.json()) as TiktokEnvelope<{
    image_id: string
    image_url: string
    file_name?: string
    format?: string
    width?: number
    height?: number
    size?: number
    signature?: string
  }>
  if (env.code !== 0) {
    throw new Error(`TikTok image upload code=${env.code} message=${env.message}`)
  }
  return {
    imageId: env.data.image_id,
    imageUrl: env.data.image_url,
    fileName: env.data.file_name,
    format: env.data.format,
    width: env.data.width,
    height: env.data.height,
    size: env.data.size,
    signature: env.data.signature,
  }
}

/** Upload an image to TikTok by URL fetch. */
export async function uploadImageByUrl(
  args: TiktokCreativeCallArgs & { imageUrl: string; fileName?: string },
): Promise<ImageUploadResult> {
  const url = `${TIKTOK_ADS_API_BASE}/file/image/ad/upload/`
  const formData = new FormData()
  formData.append('advertiser_id', args.advertiserId)
  formData.append('upload_type', 'UPLOAD_BY_URL')
  formData.append('image_url', args.imageUrl)
  if (args.fileName) formData.append('file_name', args.fileName)

  const fetchImpl = args.fetchImpl ?? fetch
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Access-Token': args.accessToken },
    body: formData as unknown as BodyInit,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`TikTok image upload (URL) HTTP ${res.status} — ${text.slice(0, 200)}`)
  }
  const env = (await res.json()) as TiktokEnvelope<{
    image_id: string
    image_url: string
    file_name?: string
    format?: string
    width?: number
    height?: number
    size?: number
    signature?: string
  }>
  if (env.code !== 0) {
    throw new Error(`TikTok image upload (URL) code=${env.code} message=${env.message}`)
  }
  return {
    imageId: env.data.image_id,
    imageUrl: env.data.image_url,
    fileName: env.data.file_name,
    format: env.data.format,
    width: env.data.width,
    height: env.data.height,
    size: env.data.size,
    signature: env.data.signature,
  }
}

/** Upload a video to TikTok via multipart UPLOAD_BY_FILE. */
export async function uploadVideoBytes(
  args: TiktokCreativeCallArgs & {
    bytes: Buffer | Uint8Array
    fileName?: string
  },
): Promise<VideoUploadResult> {
  const url = `${TIKTOK_ADS_API_BASE}/file/video/ad/upload/`
  const signature = md5Hex(args.bytes)

  const formData = new FormData()
  formData.append('advertiser_id', args.advertiserId)
  formData.append('upload_type', 'UPLOAD_BY_FILE')
  formData.append('video_signature', signature)
  if (args.fileName) formData.append('file_name', args.fileName)

  const blob = new Blob([args.bytes as unknown as BlobPart])
  formData.append('video_file', blob, args.fileName ?? 'video.mp4')

  const fetchImpl = args.fetchImpl ?? fetch
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Access-Token': args.accessToken },
    body: formData as unknown as BodyInit,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`TikTok video upload HTTP ${res.status} — ${text.slice(0, 200)}`)
  }
  const env = (await res.json()) as TiktokEnvelope<{
    video_id: string
    video_cover_url?: string
    duration?: number
    format?: string
    width?: number
    height?: number
    size?: number
    signature?: string
  }>
  if (env.code !== 0) {
    throw new Error(`TikTok video upload code=${env.code} message=${env.message}`)
  }
  return {
    videoId: env.data.video_id,
    videoCoverUrl: env.data.video_cover_url,
    duration: env.data.duration,
    format: env.data.format,
    width: env.data.width,
    height: env.data.height,
    size: env.data.size,
    signature: env.data.signature,
  }
}

/** Upload a video by URL. */
export async function uploadVideoByUrl(
  args: TiktokCreativeCallArgs & { videoUrl: string; fileName?: string },
): Promise<VideoUploadResult> {
  const url = `${TIKTOK_ADS_API_BASE}/file/video/ad/upload/`
  const formData = new FormData()
  formData.append('advertiser_id', args.advertiserId)
  formData.append('upload_type', 'UPLOAD_BY_URL')
  formData.append('video_url', args.videoUrl)
  if (args.fileName) formData.append('file_name', args.fileName)

  const fetchImpl = args.fetchImpl ?? fetch
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Access-Token': args.accessToken },
    body: formData as unknown as BodyInit,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`TikTok video upload (URL) HTTP ${res.status} — ${text.slice(0, 200)}`)
  }
  const env = (await res.json()) as TiktokEnvelope<{
    video_id: string
    video_cover_url?: string
    duration?: number
    format?: string
    width?: number
    height?: number
    size?: number
    signature?: string
  }>
  if (env.code !== 0) {
    throw new Error(`TikTok video upload (URL) code=${env.code} message=${env.message}`)
  }
  return {
    videoId: env.data.video_id,
    videoCoverUrl: env.data.video_cover_url,
    duration: env.data.duration,
    format: env.data.format,
    width: env.data.width,
    height: env.data.height,
    size: env.data.size,
    signature: env.data.signature,
  }
}
