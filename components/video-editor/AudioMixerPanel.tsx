'use client'

import { EDITOR_AUDIO_ROLES } from '@/lib/video-editor/types'
import type { EditorAudioRole, EditorTimeline, EditorTrack } from '@/lib/video-editor/types'

function inputClass() {
  return 'mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-2 py-1 text-sm'
}

function displayNumber(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function optionalNumber(value: string): number | undefined {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed !== 0 ? parsed : undefined
}

function optionalBoolean(checked: boolean): true | undefined {
  return checked ? true : undefined
}

function roleLabel(role: EditorAudioRole): string {
  return role.replace(/_/g, ' ')
}

export function AudioMixerPanel({
  timeline,
  onPatchTrack,
}: {
  timeline: EditorTimeline
  onPatchTrack: (trackId: string, patch: Partial<EditorTrack>) => void
}) {
  const tracks = timeline.tracks.filter((track) => track.kind === 'audio' || track.kind === 'video')
  if (!tracks.length) return null

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-headline text-lg text-[var(--color-pib-text)]">Mixer</h2>
        <span className="text-xs text-[var(--color-pib-text-muted)]">{tracks.length} tracks</span>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-1">
        {tracks.map((track) => {
          const gainDb = displayNumber(track.gainDb, 0)
          const pan = displayNumber(track.pan, 0)
          return (
            <div key={track.id} className="w-44 shrink-0 rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-[var(--color-pib-text)]">{track.label ?? track.id}</p>
                  <p className="text-[10px] uppercase text-[var(--color-pib-text-muted)]">{track.kind}</p>
                </div>
                {track.solo ? <span className="rounded border border-[var(--color-pib-line)] px-1.5 py-0.5 text-[10px] text-[var(--color-pib-text)]">Solo</span> : null}
              </div>

              <label className="mt-3 block text-xs text-[var(--color-pib-text-muted)]">
                Gain (dB)
                <input
                  aria-label={`Gain (dB) ${track.label ?? track.id}`}
                  className="mt-1 w-full"
                  type="range"
                  min={-60}
                  max={12}
                  step={1}
                  value={gainDb}
                  onChange={(event) => onPatchTrack(track.id, { gainDb: optionalNumber(event.target.value) })}
                />
                <span className="text-[10px]">{gainDb} dB</span>
              </label>

              <label className="mt-2 block text-xs text-[var(--color-pib-text-muted)]">
                Pan
                <input
                  aria-label={`Pan ${track.label ?? track.id}`}
                  className="mt-1 w-full"
                  type="range"
                  min={-1}
                  max={1}
                  step={0.05}
                  value={pan}
                  onChange={(event) => onPatchTrack(track.id, { pan: optionalNumber(event.target.value) })}
                />
                <span className="text-[10px]">{pan.toFixed(2)}</span>
              </label>

              <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-[var(--color-pib-text-muted)]">
                <label className="flex items-center gap-1">
                  <input
                    aria-label={`Mute ${track.label ?? track.id}`}
                    type="checkbox"
                    checked={track.muted === true}
                    onChange={(event) => onPatchTrack(track.id, { muted: optionalBoolean(event.target.checked) })}
                  />
                  Mute
                </label>
                <label className="flex items-center gap-1">
                  <input
                    aria-label={`Solo ${track.label ?? track.id}`}
                    type="checkbox"
                    checked={track.solo === true}
                    onChange={(event) => onPatchTrack(track.id, { solo: optionalBoolean(event.target.checked) })}
                  />
                  Solo
                </label>
                {track.kind === 'audio' ? (
                  <label className="col-span-2 flex items-center gap-1">
                    <input
                      aria-label={`Duck under voice ${track.label ?? track.id}`}
                      type="checkbox"
                      checked={track.duckUnderVoice === true}
                      onChange={(event) => onPatchTrack(track.id, { duckUnderVoice: optionalBoolean(event.target.checked) })}
                    />
                    Duck under voice
                  </label>
                ) : null}
              </div>

              {track.kind === 'audio' ? (
                <label className="mt-3 block text-xs text-[var(--color-pib-text-muted)]">
                  Role
                  <select
                    aria-label={`Role ${track.label ?? track.id}`}
                    className={inputClass()}
                    value={track.audioRole ?? ''}
                    onChange={(event) => onPatchTrack(track.id, { audioRole: (event.target.value || undefined) as EditorTrack['audioRole'] })}
                  >
                    <option value="">none</option>
                    {EDITOR_AUDIO_ROLES.map((role) => <option key={role} value={role}>{roleLabel(role)}</option>)}
                  </select>
                </label>
              ) : (
                <p className="mt-3 rounded border border-[var(--color-pib-line)] px-2 py-1 text-[10px] text-[var(--color-pib-text-muted)]">Video audio is treated as voice.</p>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
