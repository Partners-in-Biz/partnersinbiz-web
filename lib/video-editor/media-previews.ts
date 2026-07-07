import { MEDIA_PREVIEW_STATUSES } from './types'
import type {
  MediaPreviewFilmstrip,
  MediaPreviewProxy,
  MediaPreviewWaveform,
  MediaRef,
  VideoEditorMediaPreviewStatus,
} from './types'

/** Deterministic identity for a media source, shared by client, platform APIs and the executor. */
export function mediaKeyForRef(media: MediaRef): string {
  if (media.type === 'upload') return `upload:${media.fileId}`
  if (media.type === 'youtube_source_asset') return `yt:${media.sourceAssetId}`
  return `canvas:${media.canvasId}:${media.nodeId}:${media.runId}`
}

type PlainRecord = Record<string, unknown>

const clean = (value: unknown): PlainRecord =>
  (value && typeof value === 'object' && !Array.isArray(value) ? (value as PlainRecord) : {})
const str = (value: unknown): string | undefined =>
  (typeof value === 'string' && value.trim() ? value.trim() : undefined)
const num = (value: unknown): number | undefined =>
  (typeof value === 'number' && Number.isFinite(value) ? value : undefined)
const httpsUrl = (value: unknown): string | undefined => {
  const url = str(value)
  return url && /^https:\/\//.test(url) ? url : undefined
}

export interface MediaPreviewReportPatch {
  status?: VideoEditorMediaPreviewStatus
  waveform?: MediaPreviewWaveform
  filmstrip?: MediaPreviewFilmstrip
  proxy?: MediaPreviewProxy
  error?: { code: string; message: string }
}

export function sanitizeMediaPreviewReportInput(value: unknown): MediaPreviewReportPatch {
  const source = clean(value)
  const patch: MediaPreviewReportPatch = {}
  if (MEDIA_PREVIEW_STATUSES.includes(source.status as VideoEditorMediaPreviewStatus)) {
    patch.status = source.status as VideoEditorMediaPreviewStatus
  }
  const waveform = clean(source.waveform)
  const waveformUrl = httpsUrl(waveform.url)
  const waveformPath = str(waveform.storagePath)
  const peaksPerSecond = num(waveform.peaksPerSecond)
  const peakCount = num(waveform.peakCount)
  if (waveformUrl && waveformPath && peaksPerSecond && peakCount) {
    patch.waveform = { url: waveformUrl, storagePath: waveformPath, peaksPerSecond, peakCount }
  }
  const filmstrip = clean(source.filmstrip)
  const filmstripUrl = httpsUrl(filmstrip.url)
  const filmstripPath = str(filmstrip.storagePath)
  const frameIntervalSeconds = num(filmstrip.frameIntervalSeconds)
  const frameWidth = num(filmstrip.frameWidth)
  const frameHeight = num(filmstrip.frameHeight)
  const frameCount = num(filmstrip.frameCount)
  if (filmstripUrl && filmstripPath && frameIntervalSeconds && frameWidth && frameHeight && frameCount) {
    patch.filmstrip = { url: filmstripUrl, storagePath: filmstripPath, frameIntervalSeconds, frameWidth, frameHeight, frameCount }
  }
  const proxy = clean(source.proxy)
  const proxyUrl = httpsUrl(proxy.url)
  const proxyPath = str(proxy.storagePath)
  const sizeBytes = num(proxy.sizeBytes)
  const width = num(proxy.width)
  const height = num(proxy.height)
  if (proxyUrl && proxyPath && sizeBytes && width && height) {
    patch.proxy = { url: proxyUrl, storagePath: proxyPath, sizeBytes, width, height }
  }
  const error = clean(source.error)
  const message = str(error.message)
  if (message) patch.error = { code: str(error.code) ?? 'preview_failed', message: message.slice(0, 2000) }
  return patch
}
