import type { EditorEffectInstance } from './types'

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/** Approximate the server-side effect stack with CSS filter functions. */
export function effectsToCssFilter(effects?: EditorEffectInstance[]): string {
  const parts: string[] = []
  for (const effect of effects ?? []) {
    const params = effect.params ?? {}
    if (effect.kind === 'color_adjust') {
      const brightness = num(params.brightness, 0)
      const contrast = num(params.contrast, 1)
      const saturation = num(params.saturation, 1)
      const hue = num(params.hue, 0)
      if (brightness !== 0) parts.push(`brightness(${round2(1 + brightness)})`)
      if (contrast !== 1) parts.push(`contrast(${contrast})`)
      if (saturation !== 1) parts.push(`saturate(${saturation})`)
      if (hue !== 0) parts.push(`hue-rotate(${hue}deg)`)
    } else if (effect.kind === 'blur') {
      const sigma = num(params.sigma, 5)
      if (sigma > 0) parts.push(`blur(${sigma}px)`)
    }
  }
  return parts.join(' ')
}
