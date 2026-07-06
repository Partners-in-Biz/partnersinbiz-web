import type { EditorTimeline, VideoEditorProjectSettings } from './types'

export const VIDEO_EDITOR_CREDIT_RATE_PER_OUTPUT_MINUTE = 2
export const VIDEO_EDITOR_UHD_MULTIPLIER = 2
export const VIDEO_EDITOR_COST_LABEL = 'video_editor_render'

export interface EditorRenderCreditEstimate {
  outputSeconds: number
  billedMinutes: number
  credits: number
}

export function timelineDurationSeconds(timeline: EditorTimeline): number {
  let max = 0
  for (const track of timeline?.tracks ?? []) {
    for (const clip of track?.clips ?? []) {
      const end = (clip.timelineStart ?? 0) + (clip.duration ?? 0)
      if (Number.isFinite(end) && end > max) max = end
    }
  }
  return Math.round(max * 1000) / 1000
}

export function estimateEditorRenderCredits(
  timeline: EditorTimeline,
  settings: VideoEditorProjectSettings,
): EditorRenderCreditEstimate {
  const outputSeconds = timelineDurationSeconds(timeline)
  if (outputSeconds <= 0) return { outputSeconds: 0, billedMinutes: 0, credits: 0 }
  const billedMinutes = Math.max(1, Math.ceil(outputSeconds / 60))
  const isUhd = Math.max(settings.width, settings.height) >= 3840 || Math.min(settings.width, settings.height) >= 2160
  const multiplier = isUhd ? VIDEO_EDITOR_UHD_MULTIPLIER : 1
  return {
    outputSeconds,
    billedMinutes,
    credits: billedMinutes * VIDEO_EDITOR_CREDIT_RATE_PER_OUTPUT_MINUTE * multiplier,
  }
}
