import type { EditorEffectInstance } from './types'

export const EDITOR_EFFECT_KINDS = [
  'color_adjust', 'blur', 'sharpen', 'vignette', 'grain', 'glow',
  'lut', 'mask', 'chroma_key', 'stabilize',
  'noise_reduction', 'voice_isolation',
] as const
export type EditorEffectKind = (typeof EDITOR_EFFECT_KINDS)[number]

export type EffectParamDef =
  | { key: string; label: string; type: 'number'; min: number; max: number; step: number; default: number }
  | { key: string; label: string; type: 'color'; default: string }
  | { key: string; label: string; type: 'select'; options: string[]; default: string }
  | { key: string; label: string; type: 'boolean'; default: boolean }
  | { key: string; label: string; type: 'asset'; default: string }

export interface EditorEffectDef {
  label: string
  target: 'video' | 'audio'
  params: EffectParamDef[]
}

export const EDITOR_EFFECT_DEFS: Record<EditorEffectKind, EditorEffectDef> = {
  color_adjust: {
    label: 'Color adjust', target: 'video',
    params: [
      { key: 'brightness', label: 'Brightness', type: 'number', min: -1, max: 1, step: 0.01, default: 0 },
      { key: 'contrast', label: 'Contrast', type: 'number', min: 0, max: 3, step: 0.01, default: 1 },
      { key: 'saturation', label: 'Saturation', type: 'number', min: 0, max: 3, step: 0.01, default: 1 },
      { key: 'temperature', label: 'Temperature (K)', type: 'number', min: 2000, max: 12000, step: 50, default: 6500 },
      { key: 'hue', label: 'Hue (deg)', type: 'number', min: -180, max: 180, step: 1, default: 0 },
    ],
  },
  blur: {
    label: 'Blur', target: 'video',
    params: [{ key: 'sigma', label: 'Amount', type: 'number', min: 0, max: 50, step: 0.5, default: 5 }],
  },
  sharpen: {
    label: 'Sharpen', target: 'video',
    params: [{ key: 'amount', label: 'Amount', type: 'number', min: 0, max: 3, step: 0.05, default: 1 }],
  },
  vignette: {
    label: 'Vignette', target: 'video',
    params: [{ key: 'intensity', label: 'Intensity', type: 'number', min: 0, max: 1, step: 0.01, default: 0.4 }],
  },
  grain: {
    label: 'Film grain', target: 'video',
    params: [{ key: 'strength', label: 'Strength', type: 'number', min: 0, max: 100, step: 1, default: 12 }],
  },
  glow: {
    label: 'Glow', target: 'video',
    params: [
      { key: 'sigma', label: 'Radius', type: 'number', min: 2, max: 50, step: 0.5, default: 12 },
      { key: 'opacity', label: 'Opacity', type: 'number', min: 0, max: 1, step: 0.01, default: 0.5 },
    ],
  },
  lut: {
    label: 'LUT (.cube)', target: 'video',
    params: [
      { key: 'lutUrl', label: 'LUT file', type: 'asset', default: '' },
      { key: 'intensity', label: 'Intensity', type: 'number', min: 0, max: 1, step: 0.01, default: 1 },
    ],
  },
  mask: {
    label: 'Opacity mask', target: 'video',
    params: [
      { key: 'shape', label: 'Shape', type: 'select', options: ['rectangle', 'ellipse', 'linear'], default: 'rectangle' },
      { key: 'x', label: 'X', type: 'number', min: 0, max: 1, step: 0.01, default: 0.1 },
      { key: 'y', label: 'Y', type: 'number', min: 0, max: 1, step: 0.01, default: 0.1 },
      { key: 'width', label: 'Width', type: 'number', min: 0.01, max: 1, step: 0.01, default: 0.8 },
      { key: 'height', label: 'Height', type: 'number', min: 0.01, max: 1, step: 0.01, default: 0.8 },
      { key: 'feather', label: 'Feather (px)', type: 'number', min: 1, max: 500, step: 1, default: 40 },
      { key: 'invert', label: 'Invert', type: 'boolean', default: false },
    ],
  },
  chroma_key: {
    label: 'Chroma key', target: 'video',
    params: [
      { key: 'color', label: 'Key color', type: 'color', default: '#00ff00' },
      { key: 'similarity', label: 'Similarity', type: 'number', min: 0.01, max: 1, step: 0.01, default: 0.25 },
      { key: 'blend', label: 'Blend', type: 'number', min: 0, max: 1, step: 0.01, default: 0.1 },
    ],
  },
  stabilize: {
    label: 'Stabilize (vidstab)', target: 'video',
    params: [
      { key: 'shakiness', label: 'Shakiness', type: 'number', min: 1, max: 10, step: 1, default: 5 },
      { key: 'smoothing', label: 'Smoothing', type: 'number', min: 1, max: 100, step: 1, default: 10 },
    ],
  },
  noise_reduction: {
    label: 'Noise reduction', target: 'audio',
    params: [{ key: 'amountDb', label: 'Reduction (dB)', type: 'number', min: 0.01, max: 60, step: 0.5, default: 12 }],
  },
  voice_isolation: {
    label: 'Voice isolation', target: 'audio',
    params: [],
  },
}

const HEX_COLOR = /^#[0-9a-fA-F]{3,8}$/

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export function defaultEffectInstance(kind: EditorEffectKind): EditorEffectInstance {
  const params: EditorEffectInstance['params'] = {}
  for (const def of EDITOR_EFFECT_DEFS[kind].params) params[def.key] = def.default
  return { kind, params }
}

/** Clamp/validate one effect against its def. Unknown kinds → null. Unknown params dropped. */
export function sanitizeEffectInstance(value: unknown): EditorEffectInstance | null {
  const source = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const kind = source.kind
  if (!EDITOR_EFFECT_KINDS.includes(kind as EditorEffectKind)) return null
  const def = EDITOR_EFFECT_DEFS[kind as EditorEffectKind]
  const rawParams = source.params && typeof source.params === 'object' && !Array.isArray(source.params)
    ? (source.params as Record<string, unknown>)
    : {}
  const params: EditorEffectInstance['params'] = {}
  for (const paramDef of def.params) {
    const raw = rawParams[paramDef.key]
    if (paramDef.type === 'number') {
      params[paramDef.key] = typeof raw === 'number' && Number.isFinite(raw)
        ? clamp(raw, paramDef.min, paramDef.max)
        : paramDef.default
    } else if (paramDef.type === 'color') {
      params[paramDef.key] = typeof raw === 'string' && HEX_COLOR.test(raw.trim()) ? raw.trim().toLowerCase() : paramDef.default
    } else if (paramDef.type === 'select') {
      params[paramDef.key] = typeof raw === 'string' && paramDef.options.includes(raw) ? raw : paramDef.default
    } else if (paramDef.type === 'boolean') {
      params[paramDef.key] = typeof raw === 'boolean' ? raw : paramDef.default
    } else {
      // asset: https URLs only
      params[paramDef.key] = typeof raw === 'string' && /^https:\/\//.test(raw.trim()) ? raw.trim() : paramDef.default
    }
  }
  return { kind: kind as string, params }
}
