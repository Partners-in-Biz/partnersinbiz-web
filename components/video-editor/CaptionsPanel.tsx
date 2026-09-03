'use client'

import { useMemo, useState } from 'react'
import type { EditorClip, EditorTimeline, EditorTrack } from '@/lib/video-editor/types'
import { EDITOR_CAPTION_STYLE_PRESETS, EDITOR_CAPTION_ANIMATION_PRESETS } from '@/lib/video-editor/types'
import {
  distributeWordsAcrossSpan,
  splitCaptionCue,
  mergeCaptionCueWithNext,
  nudgeCaptionCue,
} from '@/lib/video-editor/captions'

export interface CaptionsPanelTranscriptOption {
  id: string
  status: string
  label: string
  language?: string
}

interface CaptionsPanelProps {
  timeline: EditorTimeline
  transcripts: CaptionsPanelTranscriptOption[]
  busy: boolean
  onApplyTimeline: (next: EditorTimeline, description: string) => void
  onTranscribe: () => void
  onGenerateCaptions: (transcriptId: string) => void
  onSeek: (seconds: number) => void
}

function captionTrack(timeline: EditorTimeline): EditorTrack | undefined {
  return timeline.tracks.find((track) => track.kind === 'caption')
}

/** Ensure a cue has at least two words so split ops have a boundary to use. */
function ensureWords(clip: EditorClip): EditorClip {
  const words = clip.caption?.words ?? []
  if (words.length >= 2 || !clip.caption) return clip
  const distributed = distributeWordsAcrossSpan(clip.caption.text, clip.timelineStart, clip.timelineStart + clip.duration)
  return {
    ...clip,
    caption: {
      ...clip.caption,
      words: distributed.map((word) => ({
        text: word.text,
        offsetStart: Math.max(0, word.start - clip.timelineStart),
        offsetEnd: Math.max(0, word.end - clip.timelineStart),
      })),
    },
  }
}

export function CaptionsPanel({
  timeline,
  transcripts,
  busy,
  onApplyTimeline,
  onTranscribe,
  onGenerateCaptions,
  onSeek,
}: CaptionsPanelProps) {
  const track = useMemo(() => captionTrack(timeline), [timeline])
  const [selectedTranscript, setSelectedTranscript] = useState('')
  const completed = transcripts.filter((t) => t.status === 'completed')

  const updateCueText = (clipId: string, text: string) => {
    if (!track) return
    const next: EditorTimeline = {
      ...timeline,
      tracks: timeline.tracks.map((t) =>
        t.id !== track.id
          ? t
          : {
              ...t,
              clips: t.clips.map((clip) =>
                clip.id === clipId && clip.caption ? { ...clip, caption: { ...clip.caption, text } } : clip,
              ),
            },
      ),
    }
    onApplyTimeline(next, 'Edit caption text')
  }

  const applyOp = (
    fn: (timeline: EditorTimeline, trackId: string, clipId: string) => EditorTimeline,
    clipId: string,
    description: string,
  ) => {
    if (!track) return
    onApplyTimeline(fn(timeline, track.id, clipId), description)
  }

  const applySplit = (clip: EditorClip) => {
    if (!track) return
    // Guarantee at least two words to split on, then split at the cue midpoint.
    const withWords = ensureWords(clip)
    const timelineWithWords: EditorTimeline = {
      ...timeline,
      tracks: timeline.tracks.map((t) =>
        t.id !== track.id ? t : { ...t, clips: t.clips.map((c) => (c.id === clip.id ? withWords : c)) },
      ),
    }
    const midpoint = clip.timelineStart + clip.duration / 2
    onApplyTimeline(splitCaptionCue(timelineWithWords, track.id, clip.id, midpoint), 'Split caption')
  }

  const setTrackPreset = (key: 'stylePreset' | 'animationPreset', value: string) => {
    if (!track) return
    const next: EditorTimeline = {
      ...timeline,
      tracks: timeline.tracks.map((t) =>
        t.id !== track.id
          ? t
          : { ...t, clips: t.clips.map((clip) => (clip.caption ? { ...clip, caption: { ...clip.caption, [key]: value } } : clip)) },
      ),
    }
    onApplyTimeline(next, 'Change caption preset')
  }

  return (
    <div className="pib-card-section flex flex-col gap-3" aria-label="Captions">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm">Captions</h3>
        <button type="button" className="pib-button-secondary text-xs" onClick={onTranscribe} disabled={busy}>
          Transcribe project audio
        </button>
      </div>

      <div className="flex items-end gap-2">
        <label className="flex flex-1 flex-col gap-1 text-xs">
          <span>Transcript</span>
          <select
            className="pib-input"
            aria-label="Transcript"
            value={selectedTranscript}
            onChange={(event) => setSelectedTranscript(event.target.value)}
          >
            <option value="">Select a transcript…</option>
            {completed.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label} {t.language ? `(${t.language})` : ''}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="pib-button-primary text-xs"
          disabled={busy || !selectedTranscript}
          onClick={() => onGenerateCaptions(selectedTranscript)}
        >
          Generate captions
        </button>
      </div>

      {track ? (
        <>
          <div className="flex gap-2">
            <label className="flex flex-1 flex-col gap-1 text-xs">
              <span>Style</span>
              <select
                className="pib-input"
                onChange={(event) => setTrackPreset('stylePreset', event.target.value)}
                defaultValue={track.clips[0]?.caption?.stylePreset ?? 'clean'}
               aria-label="Input">
                {EDITOR_CAPTION_STYLE_PRESETS.map((preset) => (
                  <option key={preset} value={preset}>
                    {preset}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-1 flex-col gap-1 text-xs">
              <span>Animation</span>
              <select
                className="pib-input"
                onChange={(event) => setTrackPreset('animationPreset', event.target.value)}
                defaultValue={track.clips[0]?.caption?.animationPreset ?? 'none'}
               aria-label="Input">
                {EDITOR_CAPTION_ANIMATION_PRESETS.map((preset) => (
                  <option key={preset} value={preset}>
                    {preset}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <ol className="flex max-h-80 flex-col gap-1 overflow-y-auto">
            {track.clips.map((clip, index) => (
              <li key={clip.id} className="flex items-center gap-2 rounded border border-slate-200 p-2">
                <button type="button" className="text-xs tabular-nums text-slate-500" onClick={() => onSeek(clip.timelineStart)}>
                  {clip.timelineStart.toFixed(2)}s
                </button>
                <input
                  className="pib-input flex-1 text-sm"
                  defaultValue={clip.caption?.text ?? ''}
                  onBlur={(event) => {
                    if (event.target.value !== clip.caption?.text) updateCueText(clip.id, event.target.value)
                  }}
                  aria-label={`Caption ${index + 1} text`}
                />
                <button type="button" className="pib-button-secondary text-xs" onClick={() => applySplit(clip)}>
                  Split
                </button>
                <button
                  type="button"
                  className="pib-button-secondary text-xs"
                  disabled={index === track.clips.length - 1}
                  onClick={() => applyOp((tl, trackId, clipId) => mergeCaptionCueWithNext(tl, trackId, clipId), clip.id, 'Merge caption')}
                >
                  Merge ↓
                </button>
                <button
                  type="button"
                  className="pib-button-secondary text-xs"
                  aria-label={`Nudge caption ${index + 1} later`}
                  onClick={() => applyOp((tl, trackId, clipId) => nudgeCaptionCue(tl, trackId, clipId, 0.1), clip.id, 'Nudge caption')}
                >
                  +0.1s
                </button>
              </li>
            ))}
          </ol>
        </>
      ) : (
        <p className="text-xs text-slate-500">
          No captions yet. Transcribe your project audio (or generate a voiceover) and captions are created from the
          transcript with word-level timing.
        </p>
      )}
    </div>
  )
}
