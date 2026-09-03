'use client'

import { Icon } from '@/components/studio'

import { EASE_BEZIER } from '@/lib/video-editor/keyframes'
import type { EditorClip, EditorKeyframe, EditorKeyframeProperty } from '@/lib/video-editor/types'
import { BezierCurveEditor } from './BezierCurveEditor'

const LANES: Array<{ property: EditorKeyframeProperty; label: string; step: number; fallback: (clip: EditorClip) => number }> = [
  { property: 'transform.x', label: 'x', step: 1, fallback: (clip) => clip.transform?.x ?? 0 },
  { property: 'transform.y', label: 'y', step: 1, fallback: (clip) => clip.transform?.y ?? 0 },
  { property: 'transform.scale', label: 'scale', step: 0.05, fallback: (clip) => clip.transform?.scale ?? 1 },
  { property: 'transform.rotation', label: 'rotation', step: 1, fallback: (clip) => clip.transform?.rotation ?? 0 },
  { property: 'transform.opacity', label: 'opacity', step: 0.05, fallback: (clip) => clip.transform?.opacity ?? 1 },
  { property: 'volume', label: 'volume', step: 0.05, fallback: (clip) => clip.volume ?? 1 },
]

const EASING_OPTIONS = ['linear', 'ease_in', 'ease_out', 'ease_in_out', 'bezier'] as const

function replaceKeyframes(clip: EditorClip, next: EditorKeyframe[]): { keyframes: EditorKeyframe[] | undefined } {
  const sorted = [...next].sort((a, b) => a.property.localeCompare(b.property) || a.atSeconds - b.atSeconds)
  return { keyframes: sorted.length ? sorted : undefined }
}

export function KeyframeEditor({
  clip,
  playheadSeconds,
  onPatch,
}: {
  clip: EditorClip
  playheadSeconds: number
  onPatch: (patch: Partial<EditorClip>) => void
}) {
  const keyframes = clip.keyframes ?? []
  const clipSeconds = Math.round(Math.min(Math.max(playheadSeconds - clip.timelineStart, 0), clip.duration) * 1000) / 1000

  function addAtPlayhead(lane: (typeof LANES)[number]) {
    const others = keyframes.filter((k) => !(k.property === lane.property && Math.abs(k.atSeconds - clipSeconds) < 0.001))
    onPatch(replaceKeyframes(clip, [...others, { property: lane.property, atSeconds: clipSeconds, value: lane.fallback(clip) }]))
  }

  function updateKeyframe(target: EditorKeyframe, patch: Partial<EditorKeyframe>) {
    onPatch(replaceKeyframes(clip, keyframes.map((k) => (k === target ? { ...k, ...patch } : k))))
  }

  function removeKeyframe(target: EditorKeyframe) {
    onPatch(replaceKeyframes(clip, keyframes.filter((k) => k !== target)))
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm text-[var(--color-pib-text)]">Keyframes</h3>
      {LANES.map((lane) => {
        const laneFrames = keyframes
          .filter((k) => k.property === lane.property)
          .sort((a, b) => a.atSeconds - b.atSeconds)
        return (
          <div key={lane.property} className="rounded-lg border border-[var(--color-pib-line)] p-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase text-[var(--color-pib-text-muted)]">{lane.label}</span>
              <button
                type="button"
                className="pib-btn-ghost text-xs"
                aria-label={`Add ${lane.label} keyframe at playhead`}
                onClick={() => addAtPlayhead(lane)}
              >
                ◆ {clipSeconds}s
              </button>
            </div>
            {laneFrames.map((keyframe, index) => (
              <div key={`${keyframe.atSeconds}-${index}`} className="mt-2 space-y-1 border-t border-[var(--color-pib-line)] pt-2">
                <div className="grid grid-cols-[1fr_1fr_1fr_auto] items-end gap-1 text-xs text-[var(--color-pib-text-muted)]">
                  <label className="block">
                    at (s)
                    <input aria-label={`${lane.label} keyframe ${index + 1} time`} className="mt-0.5 w-full rounded border border-[var(--color-pib-line)] bg-transparent px-1 py-0.5" type="number" step="0.1" min="0" max={clip.duration} value={keyframe.atSeconds}
                      onChange={(event) => updateKeyframe(keyframe, { atSeconds: Math.min(Math.max(Number(event.target.value), 0), clip.duration) })} />
                  </label>
                  <label className="block">
                    value
                    <input aria-label={`${lane.label} keyframe ${index + 1} value`} className="mt-0.5 w-full rounded border border-[var(--color-pib-line)] bg-transparent px-1 py-0.5" type="number" step={lane.step} value={keyframe.value}
                      onChange={(event) => updateKeyframe(keyframe, { value: Number(event.target.value) })} />
                  </label>
                  <label className="block">
                    easing
                    <select aria-label={`${lane.label} keyframe ${index + 1} easing`} className="mt-0.5 w-full rounded border border-[var(--color-pib-line)] bg-transparent px-1 py-0.5" value={keyframe.easing ?? 'linear'}
                      onChange={(event) => {
                        const easing = event.target.value as EditorKeyframe['easing']
                        updateKeyframe(keyframe, easing === 'bezier'
                          ? { easing, bezier: keyframe.bezier ?? EASE_BEZIER.ease_in_out }
                          : { easing, bezier: undefined })
                      }}>
                      {EASING_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                  </label>
                  <button type="button" className="pib-btn-ghost text-xs" aria-label={`Remove ${lane.label} keyframe ${index + 1}`} onClick={() => removeKeyframe(keyframe)}>
                    <Icon name="close" />
                  </button>
                </div>
                {keyframe.easing === 'bezier' ? (
                  <BezierCurveEditor
                    value={keyframe.bezier ?? EASE_BEZIER.ease_in_out}
                    onChange={(bezier) => updateKeyframe(keyframe, { bezier })}
                  />
                ) : null}
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}
