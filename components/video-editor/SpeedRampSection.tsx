'use client'

import { SPEED_RAMP_PRESETS, hasSpeedRamp } from '@/lib/video-editor/speed-ramps'
import { SPEED_RAMP_PRESET_IDS } from '@/lib/video-editor/types'
import type { EditorClip, EditorKeyframe } from '@/lib/video-editor/types'

export function SpeedRampSection({ clip, onPatch }: { clip: EditorClip; onPatch: (patch: Partial<EditorClip>) => void }) {
  const nonSpeed = (clip.keyframes ?? []).filter((keyframe) => keyframe.property !== 'speed')

  function apply(keyframes: EditorKeyframe[]) {
    const merged = [...nonSpeed, ...keyframes]
      .sort((a, b) => a.property.localeCompare(b.property) || a.atSeconds - b.atSeconds)
    onPatch({ keyframes: merged.length ? merged : undefined })
  }

  return (
    <div className="space-y-2">
      <h3 className="text-sm text-[var(--color-pib-text)]">Speed ramp</h3>
      <div className="flex flex-wrap gap-1">
        {SPEED_RAMP_PRESET_IDS.map((id) => (
          <button
            key={id}
            type="button"
            className="pib-btn-ghost text-xs"
            title={SPEED_RAMP_PRESETS[id].description}
            onClick={() => apply(SPEED_RAMP_PRESETS[id].build(clip.duration))}
          >
            {SPEED_RAMP_PRESETS[id].label}
          </button>
        ))}
        <button type="button" className="pib-btn-ghost text-xs" disabled={!hasSpeedRamp(clip)} onClick={() => apply([])}>
          Clear ramp
        </button>
      </div>
      <p className="text-xs text-[var(--color-pib-text-muted)]">
        Presets write <code>speed</code> keyframes — fine-tune them (including custom bezier curves) in the Keyframes panel above. Audio pitch is preserved on render.
      </p>
    </div>
  )
}
