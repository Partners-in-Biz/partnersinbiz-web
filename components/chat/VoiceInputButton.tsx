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
  const [locked, setLocked] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const transcriptRef = useRef('')
  const appendedRef = useRef(false)
  const pointerStartYRef = useRef<number | null>(null)
  const activePointerIdRef = useRef<number | null>(null)
  const lockedRef = useRef(false)
  const pointerMoveDeltaYRef = useRef(0)
  const LOCK_SWIPE_DISTANCE_PX = 56

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

  function startListening(pointerId?: number, target?: EventTarget | null, clientY?: number) {
    if (listening && lockedRef.current) {
      stopListening()
      return
    }
    if (disabled || !supported || listening) return

    const Ctor = recognitionCtor()
    if (!Ctor) {
      setSupported(false)
      return
    }

    transcriptRef.current = ''
    appendedRef.current = false
    pointerStartYRef.current = typeof clientY === 'number' ? clientY : null
    activePointerIdRef.current = typeof pointerId === 'number' ? pointerId : null
    pointerMoveDeltaYRef.current = 0
    lockedRef.current = false
    setLocked(false)
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
      lockedRef.current = false
      setLocked(false)
      recognitionRef.current = null
      pointerStartYRef.current = null
      activePointerIdRef.current = null
      pointerMoveDeltaYRef.current = 0
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
    pointerStartYRef.current = null
    activePointerIdRef.current = null
    pointerMoveDeltaYRef.current = 0
    lockedRef.current = false
    setLocked(false)
    try {
      recognitionRef.current.stop()
    } catch {
      recognitionRef.current = null
      setListening(false)
      lockedRef.current = false
      setLocked(false)
    }
  }

  function lockListening(pointerId?: number) {
    if (!listening) return
    if (typeof pointerId === 'number' && activePointerIdRef.current !== null && activePointerIdRef.current !== pointerId) return
    lockedRef.current = true
    setLocked(true)
  }

  function handlePointerRelease(pointerId?: number, clientY?: number, pointerType?: string) {
    const startY = pointerStartYRef.current
    const swipedByPosition =
      typeof startY === 'number' &&
      typeof clientY === 'number' &&
      startY - clientY >= LOCK_SWIPE_DISTANCE_PX
    const swipedByMovement = pointerMoveDeltaYRef.current <= -LOCK_SWIPE_DISTANCE_PX
    const tapToLock = pointerType === 'mouse' || pointerType === 'touch' || pointerType === 'pen'
    const swipedToLock =
      (tapToLock || swipedByPosition || swipedByMovement) &&
      (typeof pointerId !== 'number' || activePointerIdRef.current === null || activePointerIdRef.current === pointerId)

    if (!listening || lockedRef.current || swipedToLock) {
      if (swipedToLock) lockListening(pointerId)
      return
    }
    stopListening()
  }

  const isDisabled = disabled || !supported
  const title = !supported
    ? 'Voice input is not supported in this browser'
    : error ?? (locked ? 'Voice recording locked — tap to stop' : listening ? 'Release to lock voice recording' : 'Tap to start voice recording')
  const ariaLabel = locked ? 'Stop voice recording' : listening ? 'Release to lock voice recording' : 'Tap to start voice recording'

  return (
    <button
      type="button"
      disabled={isDisabled}
      draggable={false}
      title={title}
      aria-label={ariaLabel}
      aria-pressed={listening}
      onPointerDown={(event) => {
        event.preventDefault()
        startListening(event.pointerId, event.currentTarget, event.clientY)
      }}
      onPointerMove={(event) => {
        if (!listening || locked) return
        if (activePointerIdRef.current !== null && activePointerIdRef.current !== event.pointerId) return
        const startY = pointerStartYRef.current
        pointerMoveDeltaYRef.current += event.movementY ?? 0
        if (
          (typeof startY === 'number' && startY - event.clientY >= LOCK_SWIPE_DISTANCE_PX) ||
          pointerMoveDeltaYRef.current <= -LOCK_SWIPE_DISTANCE_PX
        ) {
          lockListening(event.pointerId)
        }
      }}
      onPointerUp={(event) => {
        event.preventDefault()
        handlePointerRelease(event.pointerId, event.clientY, event.pointerType)
      }}
      onPointerCancel={(event) => handlePointerRelease(event.pointerId, event.clientY, event.pointerType)}
      onContextMenu={(event) => event.preventDefault()}
      onPointerLeave={() => {
        if (listening && !locked) stopListening()
      }}
      className={[
        'relative flex h-9 w-9 shrink-0 touch-none select-none items-center justify-center rounded-full text-on-surface-variant transition-colors',
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
      {listening && (
        <span className="absolute bottom-full mb-2 whitespace-nowrap rounded-full bg-[var(--color-surface,#1c1c1c)] px-2 py-1 text-[11px] font-medium text-on-surface shadow-lg">
          {locked ? 'Locked — tap to stop' : 'Release to lock'}
        </span>
      )}
      <span className="material-symbols-outlined relative select-none text-[20px]" aria-hidden="true">
        {listening ? (locked ? 'lock' : 'mic') : 'mic_none'}
      </span>
    </button>
  )
}
