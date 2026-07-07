import type { EditorClipTransform, VideoEditorProjectSettings } from './types'

const PIP_SCALE = 0.3
const PIP_MARGIN = 48

export type LayoutPresetId =
  | 'pip_top_left'
  | 'pip_top_right'
  | 'pip_bottom_left'
  | 'pip_bottom_right'
  | 'side_by_side'
  | 'top_bottom'

export interface LayoutPreset {
  id: LayoutPresetId
  label: string
  clipCount: 1 | 2
}

export interface LayoutPatch {
  clipId: string
  transform: EditorClipTransform
}

export const LAYOUT_PRESETS: LayoutPreset[] = [
  { id: 'pip_top_left', label: 'PiP top-left', clipCount: 1 },
  { id: 'pip_top_right', label: 'PiP top-right', clipCount: 1 },
  { id: 'pip_bottom_left', label: 'PiP bottom-left', clipCount: 1 },
  { id: 'pip_bottom_right', label: 'PiP bottom-right', clipCount: 1 },
  { id: 'side_by_side', label: 'Side by side', clipCount: 2 },
  { id: 'top_bottom', label: 'Top / bottom', clipCount: 2 },
]

function transform(x: number, y: number, scale: number): EditorClipTransform {
  return { x, y, scale, rotation: 0, opacity: 1 }
}

export function applyLayoutPreset(
  presetId: string,
  settings: VideoEditorProjectSettings,
  clipIds: string[],
): LayoutPatch[] {
  const preset = LAYOUT_PRESETS.find((entry) => entry.id === presetId)
  if (!preset || clipIds.length !== preset.clipCount) return []
  const edgeX = (settings.width - settings.width * PIP_SCALE) / 2 - PIP_MARGIN
  const edgeY = (settings.height - settings.height * PIP_SCALE) / 2 - PIP_MARGIN

  if (presetId === 'pip_top_left') return [{ clipId: clipIds[0], transform: transform(-edgeX, -edgeY, PIP_SCALE) }]
  if (presetId === 'pip_top_right') return [{ clipId: clipIds[0], transform: transform(edgeX, -edgeY, PIP_SCALE) }]
  if (presetId === 'pip_bottom_left') return [{ clipId: clipIds[0], transform: transform(-edgeX, edgeY, PIP_SCALE) }]
  if (presetId === 'pip_bottom_right') return [{ clipId: clipIds[0], transform: transform(edgeX, edgeY, PIP_SCALE) }]
  if (presetId === 'side_by_side') {
    return [
      { clipId: clipIds[0], transform: transform(-settings.width / 4, 0, 0.5) },
      { clipId: clipIds[1], transform: transform(settings.width / 4, 0, 0.5) },
    ]
  }
  return [
    { clipId: clipIds[0], transform: transform(0, -settings.height / 4, 0.5) },
    { clipId: clipIds[1], transform: transform(0, settings.height / 4, 0.5) },
  ]
}
