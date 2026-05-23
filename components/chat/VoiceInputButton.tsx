'use client'

import { useEffect, useRef, useState } from 'react'

type SpeechRecognitionResultListLike = SpeechRecognitionResultList

type SpeechRecognitionLike = {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((event: { results: SpeechRecognitionResultListLike }) => void) | null
  onerror: ((event: { error?: string }) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike

declare global {
  interface Window {
    webkitSpeechRecognition?: SpeechRecognitionCtor
    SpeechRecognition?: SpeechRecognitionCtor
  }
}

interface VoiceInputButtonProps {
  disabled?: boolean
  onTranscript: (text: string) => void
  className?: string
}

function recognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null
}

export default function VoiceInputButton({
  disabled = false,
  onTranscript,
  className = '',
}: VoiceInputButtonProps) {
  const [supported, setSupported] = useState(() => Boolean(recognitionCtor()))
  const [listening, setListening] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const transcriptRef = useRef('')
  const appendedRef = useRef(false)

  useEffect(() => {
    return () => {
      recognitionRef.current?.abort()
      recognitionRef.current = null
    }
  }, [])

  function appendTranscript() {
    if (appendedRef.current) return
    const text = transcriptRef.current.trim()
    if (!text) return
    appendedRef.current = true
    onTranscript(text)
  }

  function startListening(pointerId?: number, target?: EventTarget | null) {
    if (disabled || !supported || listening) return

    const Ctor = recognitionCtor()
    if (!Ctor) {
      setSupported(false)
      return
    }

    transcriptRef.current = ''
    appendedRef.current = false
    setError(null)

    const recognition = new Ctor()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'en-ZA'
    recognition.onresult = (event) => {
      let transcript = ''
      for (let i = 0; i < event.results.length; i += 1) {
        transcript += event.results[i][0]?.transcript ?? ''
      }
      transcriptRef.current = transcript
    }
    recognition.onerror = (event) => {
      setError(event.error === 'not-allowed' ? 'Microphone permission denied' : 'Voice input unavailable')
      setListening(false)
    }
    recognition.onend = () => {
      appendTranscript()
      setListening(false)
      recognitionRef.current = null
    }

    recognitionRef.current = recognition
    try {
      if (typeof pointerId === 'number' && target instanceof HTMLElement) {
        target.setPointerCapture(pointerId)
      }
      recognition.start()
      setListening(true)
    } catch {
      recognitionRef.current = null
      setListening(false)
      setError('Voice input unavailable')
    }
  }

  function stopListening() {
    if (!recognitionRef.current) return
    try {
      recognitionRef.current.stop()
    } catch {
      recognitionRef.current = null
      setListening(false)
    }
  }

  const isDisabled = disabled || !supported
  const title = !supported
    ? 'Voice input is not supported in this browser'
    : error ?? (listening ? 'Release to add voice text' : 'Hold to dictate')

  return (
    <button
      type="button"
      disabled={isDisabled}
      title={title}
      aria-label={listening ? 'Release to add voice text' : 'Hold to dictate'}
      aria-pressed={listening}
      onPointerDown={(event) => {
        event.preventDefault()
        startListening(event.pointerId, event.currentTarget)
      }}
      onPointerUp={(event) => {
        event.preventDefault()
        stopListening()
      }}
      onPointerCancel={stopListening}
      onPointerLeave={() => {
        if (listening) stopListening()
      }}
      className={[
        'relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-on-surface-variant transition-colors',
        listening
          ? 'bg-primary text-on-primary shadow-[0_0_0_4px_rgba(245,158,11,0.16)]'
          : 'hover:bg-white/[0.08] hover:text-on-surface',
        isDisabled ? 'cursor-not-allowed opacity-40' : '',
        className,
      ].join(' ')}
    >
      {listening && (
        <span className="absolute inset-0 animate-ping rounded-full bg-primary/30" />
      )}
      <span className="material-symbols-outlined relative text-[20px]">
        {listening ? 'mic' : 'mic_none'}
      </span>
    </button>
  )
}
