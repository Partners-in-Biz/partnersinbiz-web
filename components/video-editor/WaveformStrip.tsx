'use client'

import { useEffect, useRef, useState } from 'react'

/** Fetches a waveform peaks JSON ({ peaks: number[] }) and paints it into a canvas. */
export function WaveformStrip({ waveformUrl, className }: { waveformUrl: string; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [peaks, setPeaks] = useState<number[] | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(waveformUrl)
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (!cancelled && body && Array.isArray(body.peaks)) setPeaks(body.peaks as number[])
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [waveformUrl])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !peaks?.length) return
    const context = canvas.getContext('2d')
    if (!context) return
    const { width, height } = canvas
    context.clearRect(0, 0, width, height)
    context.fillStyle = 'rgba(255,255,255,0.55)'
    const step = width / peaks.length
    peaks.forEach((peak, index) => {
      const barHeight = Math.max(1, Math.min(1, Math.abs(peak)) * height)
      context.fillRect(index * step, (height - barHeight) / 2, Math.max(1, step - 0.5), barHeight)
    })
  }, [peaks])

  return <canvas ref={canvasRef} data-testid="waveform-canvas" width={480} height={40} className={className} />
}
