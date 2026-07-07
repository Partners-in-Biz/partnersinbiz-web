import type { MediaRef } from './types'

/** Deterministic identity for a media source, shared by client, platform APIs and the executor. */
export function mediaKeyForRef(media: MediaRef): string {
  if (media.type === 'upload') return `upload:${media.fileId}`
  if (media.type === 'youtube_source_asset') return `yt:${media.sourceAssetId}`
  return `canvas:${media.canvasId}:${media.nodeId}:${media.runId}`
}
