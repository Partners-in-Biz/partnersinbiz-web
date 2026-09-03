'use client'

import { useEffect } from 'react'

/**
 * Scroll is the contractor. For every `[data-sc-rebuild]` element this writes
 * `--sc-p` (0..1) as the element scrolls through its own span, and mirrors the
 * current act name onto `data-sc-act` so CSS can gate pointer events. Elements
 * carrying `data-sc-show="act,act"` are made inert while their act is not the
 * current one, so hidden copy is not tabbable.
 *
 * Acts are declared on the element as `data-sc-acts="name:start,name:start"`.
 * Transform and opacity live in CSS; this only publishes progress.
 */

export const STAGE_ACTS = [
  ['recognition', 0],
  ['unease', 0.09],
  ['relief', 0.26],
  ['silence', 0.44],
  ['peak', 0.55],
  ['resolve', 0.83],
] as const

export type StageAct = (typeof STAGE_ACTS)[number][0]

export const STAGE_ACTS_ATTR = STAGE_ACTS.map(([name, start]) => `${name}:${start}`).join(',')

export function progressFor(top: number, height: number, viewport: number): number {
  const span = height - viewport
  if (span <= 0) return 0
  const p = -top / span
  return p <= 0 ? 0 : p >= 1 ? 1 : p
}

export function actFor(p: number, acts: ReadonlyArray<readonly [string, number]>): string {
  let current = acts[0]?.[0] ?? ''
  for (const [name, start] of acts) {
    if (p >= start) current = name
  }
  return current
}

function parseActs(raw: string | undefined): Array<readonly [string, number]> {
  if (!raw) return STAGE_ACTS.map(([n, s]) => [n, s] as const)
  return raw
    .split(',')
    .map((pair) => pair.split(':'))
    .filter((parts) => parts.length === 2)
    .map(([name, start]) => [name.trim(), Number(start)] as const)
    .filter(([, start]) => Number.isFinite(start))
}

/**
 * Stylesheets declare `--sc-gate: 0` on the stage wherever the frame unsticks
 * (narrow viewports, reduced motion). Stacked acts are all on screen, so
 * nothing may be made inert there.
 */
export function gatesActs(gateValue: string): boolean {
  return gateValue.trim() !== '0'
}

export function ScrollCraft() {
  useEffect(() => {
    const stages = Array.from(document.querySelectorAll<HTMLElement>('[data-sc-rebuild]'))
    if (stages.length === 0) return

    const acts = new Map<HTMLElement, Array<readonly [string, number]>>()
    const gated = new Map<HTMLElement, HTMLElement[]>()
    for (const stage of stages) {
      acts.set(stage, parseActs(stage.dataset.scActs))
      gated.set(stage, Array.from(stage.querySelectorAll<HTMLElement>('[data-sc-show]')))
    }

    // The gate only moves with the viewport (media queries), so it is read on
    // resize rather than every scroll frame: a computed-style read right after
    // the --sc-p write would force a recalc per frame per stage.
    const gates = new Map<HTMLElement, boolean>()
    const measureGates = () => {
      for (const stage of stages) {
        gates.set(stage, gatesActs(getComputedStyle(stage).getPropertyValue('--sc-gate')))
      }
    }

    // Keyed by stage: the act last applied, plus whether gating was on.
    const applied = new Map<HTMLElement, string>()
    let frame = 0
    const update = () => {
      frame = 0
      const viewport = window.innerHeight
      for (const stage of stages) {
        const rect = stage.getBoundingClientRect()
        const p = progressFor(rect.top, rect.height, viewport)
        stage.style.setProperty('--sc-p', p.toFixed(4))
        const act = actFor(p, acts.get(stage) ?? [])
        const gate = gates.get(stage) ?? true
        const key = gate ? act : `open:${act}`
        if (applied.get(stage) !== key) {
          applied.set(stage, key)
          stage.dataset.scAct = act
          for (const el of gated.get(stage) ?? []) {
            const shows = (el.dataset.scShow ?? '').split(',').map((s) => s.trim())
            if (!gate || shows.includes(act)) el.removeAttribute('inert')
            else el.setAttribute('inert', '')
          }
        }
      }
    }
    const request = () => {
      if (!frame) frame = window.requestAnimationFrame(update)
    }

    const remeasure = () => {
      measureGates()
      request()
    }

    measureGates()
    update()
    window.addEventListener('scroll', request, { passive: true })
    window.addEventListener('resize', remeasure)
    const motion = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    motion?.addEventListener?.('change', remeasure)
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(remeasure) : null
    for (const stage of stages) observer?.observe(stage)

    return () => {
      if (frame) window.cancelAnimationFrame(frame)
      window.removeEventListener('scroll', request)
      window.removeEventListener('resize', remeasure)
      motion?.removeEventListener?.('change', remeasure)
      observer?.disconnect()
    }
  }, [])

  return null
}
