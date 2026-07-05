export type TrimPresetId = '5x8' | '6x9' | '7x10' | '8x10' | '8.5x8.5' | '8.5x11'

export interface TrimSpec {
  id: TrimPresetId
  widthIn: number
  heightIn: number
  bleedIn: number
  dpi: number
}

const KDP_BLEED_IN = 0.125
const KDP_DPI = 300

const TRIM_PRESETS: Record<TrimPresetId, TrimSpec> = {
  '5x8': { id: '5x8', widthIn: 5, heightIn: 8, bleedIn: KDP_BLEED_IN, dpi: KDP_DPI },
  '6x9': { id: '6x9', widthIn: 6, heightIn: 9, bleedIn: KDP_BLEED_IN, dpi: KDP_DPI },
  '7x10': { id: '7x10', widthIn: 7, heightIn: 10, bleedIn: KDP_BLEED_IN, dpi: KDP_DPI },
  '8x10': { id: '8x10', widthIn: 8, heightIn: 10, bleedIn: KDP_BLEED_IN, dpi: KDP_DPI },
  '8.5x8.5': { id: '8.5x8.5', widthIn: 8.5, heightIn: 8.5, bleedIn: KDP_BLEED_IN, dpi: KDP_DPI },
  '8.5x11': { id: '8.5x11', widthIn: 8.5, heightIn: 11, bleedIn: KDP_BLEED_IN, dpi: KDP_DPI },
}

export function getTrimSpec(id: TrimPresetId): TrimSpec {
  return TRIM_PRESETS[id]
}

export function resolveTrimSpec(id: string): TrimSpec | null {
  return TRIM_PRESETS[id as TrimPresetId] ?? null
}

// KDP margin rules: 0.5" outer margins (safe above the 0.25" minimum);
// gutter widens with page count per KDP's print spec bands.
export function marginsFor(pageCount: number): {
  outsideIn: number
  topIn: number
  bottomIn: number
  gutterIn: number
} {
  let gutterIn: number
  if (pageCount <= 150) gutterIn = 0.375
  else if (pageCount <= 300) gutterIn = 0.5
  else if (pageCount <= 500) gutterIn = 0.625
  else if (pageCount <= 700) gutterIn = 0.75
  else gutterIn = 0.875
  return { outsideIn: 0.5, topIn: 0.5, bottomIn: 0.5, gutterIn }
}

// KDP spine-width formula for standard paperback paper stocks.
export function spineWidthIn(pageCount: number, paper: 'white' | 'cream' = 'white'): number {
  return pageCount * (paper === 'cream' ? 0.0025 : 0.002252)
}

export function pt(inches: number): number {
  return inches * 72
}
