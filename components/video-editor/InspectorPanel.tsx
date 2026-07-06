'use client'

import type { EditorClip } from '@/lib/video-editor/types'

export function InspectorPanel({
  clip,
  onPatch,
}: {
  clip: EditorClip | null
  onPatch: (patch: Partial<EditorClip>) => void
}) {
  if (!clip) {
    return <section className="pib-card-section p-4 text-sm text-on-surface-variant">Select a clip to edit timing, text, volume, speed, transform, and transition.</section>
  }
  return (
    <section className="pib-card-section space-y-3 p-4">
      <h2 className="font-headline text-lg font-semibold text-on-surface">Inspector</h2>
      <label className="block text-sm text-on-surface-variant">
        Start
        <input className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" type="number" step="0.1" value={clip.timelineStart} onChange={(event) => onPatch({ timelineStart: Number(event.target.value) })} />
      </label>
      <label className="block text-sm text-on-surface-variant">
        Duration
        <input className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" type="number" step="0.1" min="0.1" value={clip.duration} onChange={(event) => onPatch({ duration: Number(event.target.value) })} />
      </label>
      {clip.text ? (
        <label className="block text-sm text-on-surface-variant">
          Text
          <textarea className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" rows={4} value={clip.text.content} onChange={(event) => onPatch({ text: { ...clip.text!, content: event.target.value } })} />
        </label>
      ) : null}
      <label className="block text-sm text-on-surface-variant">
        Volume
        <input className="mt-1 w-full" type="range" min={0} max={2} step={0.05} value={clip.volume ?? 0} onChange={(event) => onPatch({ volume: Number(event.target.value) })} />
      </label>
      <label className="block text-sm text-on-surface-variant">
        Speed
        <input className="mt-1 w-full" type="range" min={0.25} max={4} step={0.25} value={clip.speed ?? 1} onChange={(event) => onPatch({ speed: Number(event.target.value) })} />
      </label>
    </section>
  )
}
