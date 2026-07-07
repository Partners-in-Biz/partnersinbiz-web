/**
 * .ass subtitle builder for the editor's caption tracks.
 * Preset VALUES mirror lib/video-editor/caption-presets.ts — the jest parity
 * test (__tests__/scripts/editor-captions.test.ts) pins the name lists together.
 */

export const ASS_STYLE_PRESETS = {
  clean:       { fontScale: 0.055, color: '#ffffff', outlineColor: '#000000', backgroundColor: null,        bold: true,  alignment: 2, marginVScale: 0.08, highlightColor: '#ffd400' },
  boxed:       { fontScale: 0.05,  color: '#ffffff', outlineColor: '#000000', backgroundColor: '#000000b3', bold: false, alignment: 2, marginVScale: 0.08, highlightColor: '#ffd400' },
  outline:     { fontScale: 0.06,  color: '#ffffff', outlineColor: '#111111', backgroundColor: null,        bold: true,  alignment: 2, marginVScale: 0.08, highlightColor: '#ffd400' },
  lower_third: { fontScale: 0.045, color: '#ffffff', outlineColor: '#000000', backgroundColor: '#101828cc', bold: false, alignment: 2, marginVScale: 0.05, highlightColor: '#ffd400' },
  karaoke_bar: { fontScale: 0.055, color: '#ffffff', outlineColor: '#000000', backgroundColor: '#000000cc', bold: true,  alignment: 2, marginVScale: 0.1,  highlightColor: '#ffd400' },
}

const DEFAULT_FONT_NAME = 'DejaVu Sans'

/** #rrggbb or #rrggbbaa → ASS &HAABBGGRR (ASS alpha: 00 opaque, FF transparent). */
export function assColor(hex) {
  const raw = String(hex || '#ffffff').replace('#', '')
  const r = raw.slice(0, 2) || 'ff'
  const g = raw.slice(2, 4) || 'ff'
  const b = raw.slice(4, 6) || 'ff'
  const cssAlpha = raw.length >= 8 ? parseInt(raw.slice(6, 8), 16) : 255
  const assAlpha = (255 - cssAlpha).toString(16).padStart(2, '0')
  return `&H${assAlpha}${b}${g}${r}`.toUpperCase().replace('&H', '&H')
}

export function assTimestamp(seconds) {
  const total = Math.max(0, Number(seconds) || 0)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = Math.floor(total % 60)
  const cs = Math.round((total - Math.floor(total)) * 100)
  const pad = (v) => String(v).padStart(2, '0')
  return `${h}:${pad(m)}:${pad(s)}.${pad(cs)}`
}

export function escapeAssText(text) {
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/\r?\n/g, '\\N')
}

function animationTags(animationPreset, style, settings) {
  if (animationPreset === 'pop') return '{\\fscx60\\fscy60\\t(0,120,\\fscx105\\fscy105)\\t(120,200,\\fscx100\\fscy100)}'
  if (animationPreset === 'fade') return '{\\fad(150,80)}'
  if (animationPreset === 'bounce') return '{\\fscx50\\fscy50\\t(0,120,\\fscx115\\fscy115)\\t(120,220,\\fscx95\\fscy95)\\t(220,300,\\fscx100\\fscy100)}'
  if (animationPreset === 'slide_up') {
    const x = Math.round(settings.width / 2)
    const y = Math.round(settings.height - settings.height * style.marginVScale)
    return `{\\move(${x},${y + 40},${x},${y},0,180)}`
  }
  return ''
}

function karaokeText(caption) {
  const parts = []
  let cursor = 0
  for (const word of caption.words) {
    const lead = Math.round((word.offsetStart - cursor) * 100)
    if (lead > 0) parts.push(`{\\kf${lead}}`)
    const duration = Math.max(1, Math.round((word.offsetEnd - word.offsetStart) * 100))
    parts.push(`{\\kf${duration}}${escapeAssText(word.text)} `)
    cursor = word.offsetEnd
  }
  return parts.join('').trimEnd()
}

export function timelineHasCaptions(timeline) {
  return (timeline?.tracks ?? []).some((track) =>
    track?.kind === 'caption' && (track.clips ?? []).some((clip) => clip?.caption?.text))
}

export function buildAssDocument({ timeline, settings }) {
  const usedStyles = new Set()
  const events = []
  for (const track of timeline?.tracks ?? []) {
    if (track?.kind !== 'caption') continue
    const clips = [...(track.clips ?? [])].sort((a, b) => (a.timelineStart ?? 0) - (b.timelineStart ?? 0))
    for (const clip of clips) {
      const caption = clip?.caption
      if (!caption?.text) continue
      const styleName = ASS_STYLE_PRESETS[caption.stylePreset] ? caption.stylePreset : 'clean'
      const style = ASS_STYLE_PRESETS[styleName]
      usedStyles.add(styleName)
      const start = assTimestamp(clip.timelineStart ?? 0)
      const end = assTimestamp((clip.timelineStart ?? 0) + (clip.duration ?? 0))
      const useKaraoke = caption.animationPreset === 'karaoke' && Array.isArray(caption.words) && caption.words.length > 0
      const text = useKaraoke
        ? karaokeText(caption)
        : `${animationTags(caption.animationPreset, style, settings)}${escapeAssText(caption.text)}`
      events.push(`Dialogue: 0,${start},${end},${styleName},,0,0,0,,${text}`)
    }
  }
  if (!usedStyles.size) usedStyles.add('clean')

  const styleLines = [...usedStyles].sort().map((name) => {
    const style = ASS_STYLE_PRESETS[name]
    const fontSize = Math.round(settings.height * style.fontScale)
    const marginV = Math.round(settings.height * style.marginVScale)
    const borderStyle = style.backgroundColor ? 4 : 1
    const backColor = assColor(style.backgroundColor || '#00000000')
    return `Style: ${name},${DEFAULT_FONT_NAME},${fontSize},${assColor(style.color)},${assColor(style.highlightColor)},${assColor(style.outlineColor)},${backColor},${style.bold ? -1 : 0},0,0,0,100,100,0,0,${borderStyle},3,0,${style.alignment},60,60,${marginV},1`
  })

  return [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${settings.width}`,
    `PlayResY: ${settings.height}`,
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    ...styleLines,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ...events,
    '',
  ].join('\n')
}

/** Escape a filesystem path for use in ffmpeg's subtitles=filename= inside -filter_complex. */
export function escapeSubtitlesPath(path) {
  const escaped = String(path).replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "'\\\\''")
  return `'${escaped}'`
}
