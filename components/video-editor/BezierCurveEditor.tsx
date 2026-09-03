'use client'

import { useRef } from 'react'

type BezierTuple = [number, number, number, number]

const WIDTH = 160
const HEIGHT = 120

function toSvg(x: number, y: number): { cx: number; cy: number } {
  return { cx: x * WIDTH, cy: HEIGHT - y * HEIGHT }
}

export function BezierCurveEditor({ value, onChange }: { value: BezierTuple; onChange: (next: BezierTuple) => void }) {
  const svgRef = useRef<SVGSVGElement>(null)
  const dragging = useRef<0 | 1 | null>(null)
  const [p1x, p1y, p2x, p2y] = value
  const p1 = toSvg(p1x, p1y)
  const p2 = toSvg(p2x, p2y)

  function pointFromEvent(event: React.PointerEvent): { x: number; y: number } {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    return {
      x: Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1),
      y: Math.min(Math.max(1 - (event.clientY - rect.top) / rect.height, -0.5), 1.5),
    }
  }

  function update(index: 0 | 1, x: number, y: number) {
    const next: BezierTuple = index === 0 ? [x, y, p2x, p2y] : [p1x, p1y, x, y]
    onChange(next.map((entry) => Math.round(entry * 100) / 100) as BezierTuple)
  }

  const setField = (index: number) => (event: React.ChangeEvent<HTMLInputElement>) => {
    const num = Number(event.target.value)
    if (!Number.isFinite(num)) return
    const next = [...value] as BezierTuple
    next[index] = num
    onChange(next)
  }

  return (
    <div data-testid="bezier-editor" className="space-y-2">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-28 w-full touch-none rounded-lg border border-[var(--color-pib-line)] bg-white/[0.03]"
        onPointerMove={(event) => {
          if (dragging.current === null) return
          const { x, y } = pointFromEvent(event)
          update(dragging.current, x, y)
        }}
        onPointerUp={() => { dragging.current = null }}
        onPointerLeave={() => { dragging.current = null }}
      >
        <path
          d={`M 0 ${HEIGHT} C ${p1.cx} ${p1.cy}, ${p2.cx} ${p2.cy}, ${WIDTH} 0`}
          fill="none"
          stroke="var(--sc-ink-soft)"
          strokeWidth="2"
        />
        <line x1={0} y1={HEIGHT} x2={p1.cx} y2={p1.cy} stroke="rgba(255,255,255,0.3)" />
        <line x1={WIDTH} y1={0} x2={p2.cx} y2={p2.cy} stroke="rgba(255,255,255,0.3)" />
        <circle cx={p1.cx} cy={p1.cy} r={6} fill="#fbbf24" className="cursor-grab" onPointerDown={() => { dragging.current = 0 }} />
        <circle cx={p2.cx} cy={p2.cy} r={6} fill="#60a5fa" className="cursor-grab" onPointerDown={() => { dragging.current = 1 }} />
      </svg>
      <div className="grid grid-cols-4 gap-1 text-xs text-[var(--color-pib-text-muted)]">
        {(['P1 x', 'P1 y', 'P2 x', 'P2 y'] as const).map((label, index) => (
          <label key={label} className="block">
            {label}
            <input
              aria-label={label}
              className="mt-0.5 w-full rounded border border-[var(--color-pib-line)] bg-transparent px-1 py-0.5"
              type="number"
              step="0.05"
              value={value[index]}
              onChange={setField(index)}
            />
          </label>
        ))}
      </div>
    </div>
  )
}
