'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export interface SignatureCaptureProps {
  /** Pre-fills the type-mode signature field with the signer's name. */
  defaultTypedName?: string
  /**
   * Fires whenever the captured signature changes. `dataUrl` is a PNG data-URL
   * (null when the signature is cleared/empty).
   */
  onChange: (value: { dataUrl: string | null; typedName: string }) => void
}

type Mode = 'draw' | 'type'

const CANVAS_W = 520
const CANVAS_H = 180

const SCRIPT_FONT = '"Brush Script MT", "Segoe Script", "Snell Roundhand", cursive'

/** Render a typed name onto an offscreen canvas to produce a PNG data-URL. */
function renderTypedSignature(name: string): string | null {
  if (!name.trim()) return null
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = CANVAS_W
  canvas.height = CANVAS_H
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H)
  ctx.fillStyle = '#111827'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `48px ${SCRIPT_FONT}`
  ctx.fillText(name.trim(), CANVAS_W / 2, CANVAS_H / 2)
  return canvas.toDataURL('image/png')
}

export function SignatureCapture({ defaultTypedName = '', onChange }: SignatureCaptureProps) {
  const [mode, setMode] = useState<Mode>('draw')
  const [typedName, setTypedName] = useState(defaultTypedName)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const drawingRef = useRef(false)
  const hasDrawnRef = useRef(false)
  const lastRef = useRef<{ x: number; y: number } | null>(null)

  const emit = useCallback(
    (dataUrl: string | null, name: string) => {
      onChange({ dataUrl, typedName: name })
    },
    [onChange],
  )

  // Prepare the draw canvas (white background) when entering draw mode.
  useEffect(() => {
    if (mode !== 'draw') return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#111827'
    hasDrawnRef.current = false
  }, [mode])

  // When switching to type mode, immediately reflect the typed signature.
  useEffect(() => {
    if (mode === 'type') {
      emit(renderTypedSignature(typedName), typedName)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  function pointFromEvent(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY }
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    e.preventDefault()
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.setPointerCapture(e.pointerId)
    drawingRef.current = true
    lastRef.current = pointFromEvent(e)
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const p = pointFromEvent(e)
    const last = lastRef.current ?? p
    ctx.beginPath()
    ctx.moveTo(last.x, last.y)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
    lastRef.current = p
    hasDrawnRef.current = true
  }

  function handlePointerUp() {
    if (!drawingRef.current) return
    drawingRef.current = false
    lastRef.current = null
    const canvas = canvasRef.current
    if (!canvas || !hasDrawnRef.current) return
    emit(canvas.toDataURL('image/png'), typedName)
  }

  function clearDraw() {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    hasDrawnRef.current = false
    emit(null, typedName)
  }

  function handleTypedChange(value: string) {
    setTypedName(value)
    if (mode === 'type') emit(renderTypedSignature(value), value)
    else emit(hasDrawnRef.current && canvasRef.current ? canvasRef.current.toDataURL('image/png') : null, value)
  }

  return (
    <div className="space-y-3">
      <div className="inline-flex rounded-lg border border-[var(--color-pib-line,#e5e7eb)] p-0.5 text-sm">
        <button
          type="button"
          onClick={() => setMode('draw')}
          className={`rounded-md px-3 py-1.5 ${mode === 'draw' ? 'bg-[var(--color-pib-accent,#111827)] text-white' : 'text-[var(--color-pib-text-muted,#6b7280)]'}`}
        >
          Draw
        </button>
        <button
          type="button"
          onClick={() => setMode('type')}
          className={`rounded-md px-3 py-1.5 ${mode === 'type' ? 'bg-[var(--color-pib-accent,#111827)] text-white' : 'text-[var(--color-pib-text-muted,#6b7280)]'}`}
        >
          Type
        </button>
      </div>

      {mode === 'draw' ? (
        <div className="space-y-2">
          <div className="overflow-hidden rounded-lg border border-[var(--color-pib-line,#e5e7eb)] bg-white">
            <canvas
              ref={canvasRef}
              width={CANVAS_W}
              height={CANVAS_H}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerLeave={handlePointerUp}
              className="block w-full touch-none cursor-crosshair"
              style={{ aspectRatio: `${CANVAS_W} / ${CANVAS_H}` }}
              aria-label="Draw your signature"
            />
          </div>
          <button
            type="button"
            onClick={clearDraw}
            className="text-xs text-[var(--color-pib-text-muted,#6b7280)] underline-offset-2 hover:underline"
          >
            Clear signature
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <input
            type="text"
            value={typedName}
            onChange={(e) => handleTypedChange(e.target.value)}
            placeholder="Type your full name"
            className="w-full rounded-lg border border-[var(--color-pib-line,#e5e7eb)] bg-white px-3 py-2 text-sm text-[#111827] focus:outline-none focus:ring-1 focus:ring-[var(--color-pib-accent,#111827)]"
          />
          <div className="grid h-[120px] place-items-center rounded-lg border border-[var(--color-pib-line,#e5e7eb)] bg-white">
            {typedName.trim() ? (
              <span style={{ fontFamily: SCRIPT_FONT, fontSize: 40, color: '#111827' }}>{typedName}</span>
            ) : (
              <span className="text-sm text-[var(--color-pib-text-muted,#9ca3af)]">Your signature preview</span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
