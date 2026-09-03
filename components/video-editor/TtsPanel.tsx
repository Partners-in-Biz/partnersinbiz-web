'use client'

import { useMemo, useState } from 'react'
import { estimateTtsCredits } from '@/lib/video-editor/credits'

export interface TtsVoiceOption {
  id: string
  label: string
  provider: 'gateway' | 'elevenlabs'
}

export interface TtsGenerateRequest {
  voice: string
  provider: 'gateway' | 'elevenlabs'
  sections: Array<{ text: string }>
}

interface TtsPanelProps {
  voices: TtsVoiceOption[]
  busy: boolean
  onGenerate: (request: TtsGenerateRequest) => Promise<void>
}

export function TtsPanel({ voices, busy, onGenerate }: TtsPanelProps) {
  const [script, setScript] = useState('')
  const [voiceId, setVoiceId] = useState(voices[0]?.id ?? '')

  const sections = useMemo(
    () =>
      script
        .split(/\n{2,}/)
        .map((part) => part.trim())
        .filter(Boolean)
        .map((text) => ({ text })),
    [script],
  )
  const credits = useMemo(() => estimateTtsCredits(script.replace(/\s+/g, ' ').length), [script])
  const voice = voices.find((v) => v.id === voiceId)

  return (
    <div className="pib-card-section flex flex-col gap-3" aria-label="Voiceover">
      <h3 className="text-sm">AI voiceover</h3>
      <label className="flex flex-col gap-1 text-xs">
        <span>Voiceover script (blank line = new section)</span>
        <textarea
          className="pib-input min-h-32 text-sm"
          value={script}
          onChange={(event) => setScript(event.target.value)}
          aria-label="Voiceover script"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        <span>Voice</span>
        <select
          className="pib-input"
          value={voiceId}
          onChange={(event) => setVoiceId(event.target.value)}
          aria-label="Voice"
        >
          {voices.map((v) => (
            <option key={v.id} value={v.id}>
              {v.label} {v.provider === 'elevenlabs' ? '· ElevenLabs (your key)' : '· Platform'}
            </option>
          ))}
        </select>
      </label>
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-500">
          {sections.length} section{sections.length === 1 ? '' : 's'} · ~{credits} credits
        </span>
        <button
          type="button"
          className="pib-button-primary text-xs"
          disabled={busy || sections.length === 0 || !voice}
          onClick={() => {
            if (!voice) return
            void onGenerate({ voice: voice.id, provider: voice.provider, sections })
          }}
        >
          Generate voiceover
        </button>
      </div>
      <p className="text-[11px] text-slate-400">
        Captions generated afterwards use this voiceover&apos;s own word timing  -  they can never drift out of sync.
      </p>
    </div>
  )
}
