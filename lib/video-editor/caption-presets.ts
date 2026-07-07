import type { EditorCaptionAnimationPreset, EditorCaptionStylePreset } from './types'

export interface CaptionStylePresetSpec {
  label: string
  /** Font size as a fraction of output height — the .ass builder on the executor uses the same scales. */
  fontScale: number
  color: string
  outlineColor: string
  backgroundColor: string | null
  bold: boolean
  /** ASS alignment (numpad): 2 = bottom-center, 8 = top-center. */
  alignment: 2 | 8
  /** Vertical margin as a fraction of output height. */
  marginVScale: number
  /** Karaoke word-highlight (SecondaryColour in ASS). */
  highlightColor: string
}

export const CAPTION_STYLE_PRESETS: Record<EditorCaptionStylePreset, CaptionStylePresetSpec> = {
  clean: {
    label: 'Clean', fontScale: 0.055, color: '#ffffff', outlineColor: '#000000',
    backgroundColor: null, bold: true, alignment: 2, marginVScale: 0.08, highlightColor: '#ffd400',
  },
  boxed: {
    label: 'Boxed', fontScale: 0.05, color: '#ffffff', outlineColor: '#000000',
    backgroundColor: '#000000b3', bold: false, alignment: 2, marginVScale: 0.08, highlightColor: '#ffd400',
  },
  outline: {
    label: 'Outline', fontScale: 0.06, color: '#ffffff', outlineColor: '#111111',
    backgroundColor: null, bold: true, alignment: 2, marginVScale: 0.08, highlightColor: '#ffd400',
  },
  lower_third: {
    label: 'Lower third', fontScale: 0.045, color: '#ffffff', outlineColor: '#000000',
    backgroundColor: '#101828cc', bold: false, alignment: 2, marginVScale: 0.05, highlightColor: '#ffd400',
  },
  karaoke_bar: {
    label: 'Karaoke bar', fontScale: 0.055, color: '#ffffff', outlineColor: '#000000',
    backgroundColor: '#000000cc', bold: true, alignment: 2, marginVScale: 0.1, highlightColor: '#ffd400',
  },
}

export const CAPTION_ANIMATION_LABELS: Record<EditorCaptionAnimationPreset, string> = {
  none: 'None',
  pop: 'Pop',
  fade: 'Fade',
  slide_up: 'Slide up',
  bounce: 'Bounce',
  karaoke: 'Karaoke (word highlight)',
}
