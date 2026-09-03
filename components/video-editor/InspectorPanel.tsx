'use client'

import { useEffect, useState } from 'react'
import { scopedApiPath } from '@/lib/portal/scoped-routing'
import { applyLayoutPreset, LAYOUT_PRESETS } from '@/lib/video-editor/layout-presets'
import { EDITOR_BLEND_MODES } from '@/lib/video-editor/types'
import type { LayoutPatch } from '@/lib/video-editor/layout-presets'
import type { EditorBlendMode, EditorClip, VideoEditorProjectSettings } from '@/lib/video-editor/types'
import { EffectsSection, type EffectsSectionLut } from './EffectsSection'
import { KeyframeEditor } from './KeyframeEditor'
import { SpeedRampSection } from './SpeedRampSection'

function effectTargetForClip(clip: EditorClip): 'video' | 'audio' | undefined {
  if (clip.media?.mediaKind === 'audio') return 'audio'
  if (clip.media?.mediaKind === 'video' || clip.media?.mediaKind === 'image' || clip.text || clip.caption) return 'video'
  return undefined
}

export function InspectorPanel({
  clip,
  orgId,
  playheadSeconds = 0,
  settings,
  selectedClipIds = [],
  layoutDisabledReason,
  onPatch,
  onApplyLayout,
  onTrim,
}: {
  clip: EditorClip | null
  orgId?: string
  playheadSeconds?: number
  settings: VideoEditorProjectSettings
  selectedClipIds?: string[]
  layoutDisabledReason?: string
  onPatch: (patch: Partial<EditorClip>) => void
  onApplyLayout: (patches: LayoutPatch[]) => void
  onTrim?: (edge: 'start' | 'end', deltaSeconds: number) => void
}) {
  const [luts, setLuts] = useState<EffectsSectionLut[]>([])

  useEffect(() => {
    if (!orgId) {
      setLuts([])
      return
    }
    void fetch(scopedApiPath('/api/v1/video-editor/luts', { orgId }))
      .then((res) => res.json())
      .then((body) => setLuts((body.data?.luts ?? []) as EffectsSectionLut[]))
      .catch(() => setLuts([]))
  }, [orgId])

  if (!clip) {
    return <section className="pib-card-section p-4 text-sm text-[var(--color-pib-text-muted)]">Select a clip to edit timing, text, volume, speed, transform, and transition.</section>
  }
  return (
    <section className="pib-card-section space-y-3 p-4">
      <h2 className="font-headline text-lg text-[var(--color-pib-text)]">Inspector</h2>
      <label className="block text-sm text-[var(--color-pib-text-muted)]">
        Start
        <input className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" type="number" step="0.1" value={clip.timelineStart} onChange={(event) => onPatch({ timelineStart: Number(event.target.value) })}  aria-label="Number"/>
      </label>
      <label className="block text-sm text-[var(--color-pib-text-muted)]">
        Duration
        <input className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" type="number" step="0.1" min="0.1" value={clip.duration} onChange={(event) => onPatch({ duration: Number(event.target.value) })}  aria-label="Number"/>
      </label>
      {onTrim ? (
        <fieldset className="space-y-3 rounded-lg border border-[var(--color-pib-line)] p-3">
          <legend className="px-1 text-xs font-label uppercase tracking-widest text-[var(--color-pib-text-muted)]">Trim</legend>
          <label className="block text-sm text-[var(--color-pib-text-muted)]">
            In point (s)
            <input
              className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2"
              type="number"
              step="0.1"
              min="0"
              value={clip.timelineStart}
              onChange={(event) => {
                const value = Number(event.target.value)
                if (!Number.isFinite(value)) return
                const delta = Math.round((value - clip.timelineStart) * 1000) / 1000
                if (delta !== 0) onTrim('start', delta)
              }}
             aria-label="Number"/>
          </label>
          <label className="block text-sm text-[var(--color-pib-text-muted)]">
            Out point (s)
            <input
              className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2"
              type="number"
              step="0.1"
              value={clip.timelineStart + clip.duration}
              onChange={(event) => {
                const value = Number(event.target.value)
                if (!Number.isFinite(value)) return
                const delta = Math.round((value - (clip.timelineStart + clip.duration)) * 1000) / 1000
                if (delta !== 0) onTrim('end', delta)
              }}
             aria-label="Number"/>
          </label>
          <p className="text-xs text-[var(--color-pib-text-muted)]">Trimming keeps the source offset in sync — use Start/Duration above to move or stretch instead.</p>
        </fieldset>
      ) : null}
      {clip.text ? (
        <label className="block text-sm text-[var(--color-pib-text-muted)]">
          Text
          <textarea className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" rows={4} value={clip.text.content} onChange={(event) => onPatch({ text: { ...clip.text!, content: event.target.value } })}  aria-label="Input"/>
        </label>
      ) : null}
      <label className="block text-sm text-[var(--color-pib-text-muted)]">
        Volume
        <input className="mt-1 w-full" type="range" min={0} max={2} step={0.05} value={clip.volume ?? 0} onChange={(event) => onPatch({ volume: Number(event.target.value) })}  aria-label="Value"/>
      </label>
      <label className="block text-sm text-[var(--color-pib-text-muted)]">
        Speed
        <input className="mt-1 w-full" type="range" min={0.25} max={4} step={0.25} value={clip.speed ?? 1} onChange={(event) => onPatch({ speed: Number(event.target.value) })}  aria-label="Value"/>
      </label>
      <label className="block text-sm text-[var(--color-pib-text-muted)]">
        Fade in (s)
        <input
          className="mt-1 w-full"
          type="range"
          min={0}
          max={5}
          step={0.1}
          value={clip.fadeInSeconds ?? 0}
          onChange={(event) => {
            const value = Number(event.target.value)
            onPatch({ fadeInSeconds: value > 0 ? value : undefined })
          }}
         aria-label="Value"/>
      </label>
      <label className="block text-sm text-[var(--color-pib-text-muted)]">
        Fade out (s)
        <input
          className="mt-1 w-full"
          type="range"
          min={0}
          max={5}
          step={0.1}
          value={clip.fadeOutSeconds ?? 0}
          onChange={(event) => {
            const value = Number(event.target.value)
            onPatch({ fadeOutSeconds: value > 0 ? value : undefined })
          }}
         aria-label="Value"/>
      </label>
      <label className="block text-sm text-[var(--color-pib-text-muted)]">
        Blend mode
        <select
          className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2"
          value={clip.blendMode ?? 'normal'}
          onChange={(event) => onPatch({
            blendMode: event.target.value === 'normal' ? undefined : (event.target.value as EditorBlendMode),
          })}
         aria-label="Input">
          {EDITOR_BLEND_MODES.map((mode) => <option key={mode} value={mode}>{mode}</option>)}
        </select>
      </label>
      <EffectsSection
        effects={clip.effects ?? []}
        luts={luts}
        target={effectTargetForClip(clip)}
        onChange={(effects) => onPatch({ effects: effects.length ? effects : undefined })}
      />
      <div>
        <h3 className="text-sm text-[var(--color-pib-text)]">Layout presets</h3>
        <div className="mt-1 flex flex-wrap gap-1">
          {LAYOUT_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className="pib-btn-ghost text-xs"
              disabled={Boolean(layoutDisabledReason) || selectedClipIds.length !== preset.clipCount}
              title={layoutDisabledReason ?? (preset.clipCount === 2 ? 'Select two visual clips' : 'Applies to the selected visual clip')}
              onClick={() => onApplyLayout(applyLayoutPreset(preset.id, settings, selectedClipIds))}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>
      {clip.media ? <SpeedRampSection clip={clip} onPatch={onPatch} /> : null}
      <KeyframeEditor clip={clip} playheadSeconds={playheadSeconds} onPatch={onPatch} />
    </section>
  )
}
