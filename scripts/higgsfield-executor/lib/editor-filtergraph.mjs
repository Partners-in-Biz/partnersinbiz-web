import { hasSpeedRamp, keyframeExpr, keyframesForProperty, rampSegments, sendcmdOpacityCommands } from './editor-keyframes.mjs'
import { escapeSubtitlesPath } from './editor-captions.mjs'

export const DEFAULT_EDITOR_FONT_FILE = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'

const XFADE_TRANSITIONS = {
  crossfade: 'fade',
  fade_black: 'fadeblack',
  slide_left: 'slideleft',
  slide_right: 'slideright',
  wipe: 'wipeleft',
}

const BLEND_MODES = {
  multiply: 'multiply',
  screen: 'screen',
  overlay: 'overlay',
  lighten: 'lighten',
  darken: 'darken',
  addition: 'addition',
  difference: 'difference',
}

const COMPILED_EFFECT_KINDS = new Set([
  'color_adjust', 'blur', 'sharpen', 'vignette', 'grain', 'glow',
  'lut', 'chroma_key', 'mask', 'stabilize',
])

export function fmt(value) {
  return String(Math.round(Number(value) * 1000) / 1000)
}

export function escapeDrawtext(text) {
  return String(text)
    .replace(/'/g, '’')
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
    .replace(/%/g, '\\%')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
}

export function timelineDurationSeconds(timeline) {
  let max = 0
  for (const track of timeline?.tracks ?? []) {
    for (const clip of track?.clips ?? []) {
      const end = (clip.timelineStart ?? 0) + (clip.duration ?? 0)
      if (Number.isFinite(end) && end > max) max = end
    }
  }
  return Math.round(max * 1000) / 1000
}

function atempoFactors(speed) {
  const factors = []
  let remaining = speed
  if (!Number.isFinite(remaining) || remaining === 1) return factors
  while (remaining > 2) {
    factors.push(2)
    remaining /= 2
  }
  while (remaining < 0.5) {
    factors.push(0.5)
    remaining /= 0.5
  }
  if (remaining !== 1) factors.push(Math.round(remaining * 1000) / 1000)
  return factors
}

function clipSpeed(clip) {
  return typeof clip.speed === 'number' && clip.speed > 0 ? clip.speed : 1
}

function num(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function clamp(value, min, max, fallback) {
  return Math.min(Math.max(num(value, fallback), min), max)
}

function hexFilterColor(value, fallback = '0x00ff00') {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  if (!/^#[0-9a-fA-F]{6}$/.test(trimmed)) return fallback
  return `0x${trimmed.slice(1).toLowerCase()}`
}

function safeFilterFilePath(value) {
  const path = String(value || '')
  if (!path || /['\n\r]/.test(path)) throw new Error('unsafe local effect asset path')
  return path.replace(/\\/g, '\\\\')
}

function sortedClips(track) {
  return [...(track.clips ?? [])].sort((a, b) => (a.timelineStart ?? 0) - (b.timelineStart ?? 0))
}

function assertSupportedEffects(timeline) {
  for (const track of timeline?.tracks ?? []) {
    for (const clip of track?.clips ?? []) {
      if (!Array.isArray(clip.effects)) continue
      for (const effect of clip.effects) {
        if (!COMPILED_EFFECT_KINDS.has(effect?.kind)) {
          throw new Error(`unsupported video editor effect: ${effect?.kind || 'unknown'}`)
        }
      }
    }
  }
}

function propertyFrames(clip, property) {
  const frames = keyframesForProperty(clip.keyframes, property)
  return frames.length ? frames : null
}

function buildVisualClipChain(clip, inputIndex, label, chains, clipOrdinal, ctx) {
  const transform = clip.transform ?? {}
  const transformParts = buildTransformParts(clip, transform, clipOrdinal)
  const hasEffects = Array.isArray(clip.effects) && clip.effects.length > 0

  if (clip.media.mediaKind !== 'image' && hasSpeedRamp(clip)) {
    const segments = rampSegments(clip, 4)
    const trimStart = clip.trimStart ?? 0
    const inputLabels = segments.map((_, i) => `vr${clipOrdinal}i${i}`)
    chains.push(`[${inputIndex}:v]split=${segments.length}${inputLabels.map((l) => `[${l}]`).join('')}`)
    const segmentLabels = segments.map((segment, i) => {
      const segLabel = `vr${clipOrdinal}s${i}`
      chains.push(`[${inputLabels[i]}]trim=start=${fmt(trimStart + segment.sourceStart)}:duration=${fmt(segment.sourceDuration)},setpts=(PTS-STARTPTS)/${fmt(segment.speed)}[${segLabel}]`)
      return segLabel
    })
    // concat the constant-speed slices straight into the final label when there
    // is no transform work; otherwise concat to an intermediate and transform.
    const concatLabel = transformParts.length || hasEffects ? `vr${clipOrdinal}c` : label
    chains.push(`${segmentLabels.map((l) => `[${l}]`).join('')}concat=n=${segments.length}:v=1:a=0[${concatLabel}]`)
    if (hasEffects) {
      const parts = []
      let currentIn = applyVideoEffects({ clip, parts, chains, inLabel: concatLabel, ctx })
      const finalParts = [...parts, ...transformParts]
      chains.push(`[${currentIn}]${finalParts.length ? finalParts.join(',') : 'null'}[${label}]`)
    } else if (transformParts.length) chains.push(`[${concatLabel}]${transformParts.join(',')}[${label}]`)
    return label
  }

  const leading = []
  if (clip.media.mediaKind === 'image') {
    leading.push('setpts=PTS-STARTPTS')
  } else {
    const speed = clipSpeed(clip)
    const trimStart = clip.trimStart ?? 0
    leading.push(`trim=start=${fmt(trimStart)}:duration=${fmt(clip.duration * speed)}`)
    leading.push(speed === 1 ? 'setpts=PTS-STARTPTS' : `setpts=(PTS-STARTPTS)/${fmt(speed)}`)
  }
  if (!hasEffects) {
    chains.push(`[${inputIndex}:v]${[...leading, ...transformParts].join(',')}[${label}]`)
    return label
  }

  const parts = [...leading]
  const currentIn = applyVideoEffects({ clip, parts, chains, inLabel: `${inputIndex}:v`, ctx })
  const finalParts = [...parts, ...transformParts]
  chains.push(`[${currentIn}]${finalParts.length ? finalParts.join(',') : 'null'}[${label}]`)
  return label
}

function applyVideoEffects({ clip, parts, chains, inLabel, ctx }) {
  let currentIn = inLabel
  const effects = Array.isArray(clip.effects) ? clip.effects : []
  for (let index = 0; index < effects.length; index += 1) {
    const effect = effects[index]
    const p = effect?.params || {}
    if (effect.kind === 'color_adjust') {
      const brightness = num(p.brightness, 0)
      const contrast = num(p.contrast, 1)
      const saturation = num(p.saturation, 1)
      if (brightness !== 0 || contrast !== 1 || saturation !== 1) {
        parts.push(`eq=brightness=${fmt(brightness)}:contrast=${fmt(contrast)}:saturation=${fmt(saturation)}`)
      }
      const temperature = num(p.temperature, 6500)
      if (temperature !== 6500) parts.push(`colortemperature=temperature=${Math.round(temperature)}`)
      const hue = num(p.hue, 0)
      if (hue !== 0) parts.push(`hue=h=${fmt(hue)}`)
    } else if (effect.kind === 'blur') {
      const sigma = num(p.sigma, 5)
      if (sigma > 0) parts.push(`gblur=sigma=${fmt(sigma)}`)
    } else if (effect.kind === 'sharpen') {
      const amount = num(p.amount, 1)
      if (amount > 0) parts.push(`unsharp=5:5:${fmt(amount)}`)
    } else if (effect.kind === 'vignette') {
      const intensity = num(p.intensity, 0.4)
      if (intensity > 0) parts.push(`vignette=angle=${fmt((intensity * Math.PI) / 2)}`)
    } else if (effect.kind === 'grain') {
      const strength = Math.round(num(p.strength, 12))
      if (strength > 0) parts.push(`noise=alls=${strength}:allf=t+u`)
    } else if (effect.kind === 'glow') {
      const fxIndex = ctx.fxCounter
      ctx.fxCounter += 1
      const fx = `fx${fxIndex}`
      chains.push(`[${currentIn}]${[...parts, `split=2[${fx}a][${fx}b]`].join(',')}`)
      chains.push(`[${fx}b]gblur=sigma=${fmt(num(p.sigma, 12))}[${fx}c]`)
      chains.push(`[${fx}a][${fx}c]blend=all_mode=screen:all_opacity=${fmt(num(p.opacity, 0.5))}[${fx}d]`)
      parts.length = 0
      currentIn = `${fx}d`
    } else if (effect.kind === 'lut') {
      const lutUrl = typeof p.lutUrl === 'string' ? p.lutUrl.trim() : ''
      const intensity = clamp(p.intensity, 0, 1, 1)
      if (!/^https:\/\//.test(lutUrl) || intensity <= 0) continue
      const assetPath = ctx.localEffectAssetPaths[`${clip.id}:${index}`]
      if (!assetPath) throw new Error(`no local effect asset for clip ${clip.id} effect ${index} (lut)`)
      const escaped = safeFilterFilePath(assetPath)
      if (intensity >= 1) {
        parts.push(`lut3d=file='${escaped}'`)
      } else {
        const fxIndex = ctx.fxCounter
        ctx.fxCounter += 1
        const fx = `fx${fxIndex}`
        chains.push(`[${currentIn}]${[...parts, `split=2[${fx}a][${fx}b]`].join(',')}`)
        chains.push(`[${fx}b]lut3d=file='${escaped}'[${fx}c]`)
        chains.push(`[${fx}a][${fx}c]blend=all_mode=normal:all_opacity=${fmt(intensity)}[${fx}d]`)
        parts.length = 0
        currentIn = `${fx}d`
      }
    } else if (effect.kind === 'chroma_key') {
      const color = hexFilterColor(p.color)
      parts.push(`chromakey=color=${color}:similarity=${fmt(clamp(p.similarity, 0.01, 1, 0.25))}:blend=${fmt(clamp(p.blend, 0, 1, 0.1))}`)
    } else if (effect.kind === 'mask') {
      const x = fmt(clamp(p.x, 0, 1, 0.1))
      const y = fmt(clamp(p.y, 0, 1, 0.1))
      const w = fmt(clamp(p.width, 0.01, 1, 0.8))
      const h = fmt(clamp(p.height, 0.01, 1, 0.8))
      const feather = fmt(clamp(p.feather, 1, 500, 40))
      let expr
      if (p.shape === 'ellipse') {
        expr = `clip((1-hypot((X-(W*${x})-(W*${w})/2)/((W*${w})/2),(Y-(H*${y})-(H*${h})/2)/((H*${h})/2)))*((W*${w})/2)/${feather},0,1)`
      } else if (p.shape === 'linear') {
        expr = `clip((X-(W*${x}))/${feather},0,1)`
      } else {
        expr = `clip(min(min(X-(W*${x}),(W*${x})+(W*${w})-X),min(Y-(H*${y}),(H*${y})+(H*${h})-Y))/${feather},0,1)`
      }
      if (p.invert === true) expr = `(1-${expr})`
      parts.push('format=yuva444p', `geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='alpha(X,Y)*${expr}'`)
    }
  }
  return currentIn
}

/** Ordered transform filter parts (scale → rotate → opacity), keyframe-aware. */
function buildTransformParts(clip, transform, clipOrdinal) {
  const parts = []

  const scaleFrames = propertyFrames(clip, 'transform.scale')
  const staticScale = typeof transform.scale === 'number' ? transform.scale : 1
  if (scaleFrames) {
    const expr = keyframeExpr(scaleFrames, staticScale, 't')
    parts.push(`scale=w='iw*(${expr})':h='ih*(${expr})':eval=frame`)
  } else if (staticScale !== 1) {
    parts.push(`scale=w=iw*${fmt(staticScale)}:h=ih*${fmt(staticScale)}`)
  }

  const rotationFrames = propertyFrames(clip, 'transform.rotation')
  const staticRotation = typeof transform.rotation === 'number' ? transform.rotation : 0
  if (rotationFrames) {
    parts.push(`rotate=a='(${keyframeExpr(rotationFrames, staticRotation, 't')})*PI/180':c=black@0`)
  } else if (staticRotation !== 0) {
    parts.push(`rotate=${fmt((staticRotation * Math.PI) / 180)}:c=black@0`)
  }

  const opacityFrames = propertyFrames(clip, 'transform.opacity')
  const staticOpacity = typeof transform.opacity === 'number' ? transform.opacity : 1
  if (opacityFrames) {
    const commands = sendcmdOpacityCommands(opacityFrames, staticOpacity, `op${clipOrdinal}`, clip.duration, 0.1)
    const initial = Math.min(Math.max(opacityFrames[0].atSeconds <= 0 ? opacityFrames[0].value : staticOpacity, 0), 1)
    parts.push('format=yuva420p', `sendcmd=c='${commands}'`, `colorchannelmixer@op${clipOrdinal}=aa=${fmt(initial)}`)
  } else if (staticOpacity < 1) {
    parts.push('format=yuva420p', `colorchannelmixer=aa=${fmt(staticOpacity)}`)
  }

  return parts
}

function overlayPosition(clip, startSeconds) {
  const transform = clip.transform ?? {}
  const timeExpr = startSeconds > 0 ? `(t-${fmt(startSeconds)})` : 't'
  const xFrames = propertyFrames(clip, 'transform.x')
  const yFrames = propertyFrames(clip, 'transform.y')
  const staticX = typeof transform.x === 'number' ? transform.x : 0
  const staticY = typeof transform.y === 'number' ? transform.y : 0
  const x = xFrames
    ? `'(W-w)/2+(${keyframeExpr(xFrames, staticX, timeExpr)})'`
    : staticX !== 0 ? `(W-w)/2+${fmt(staticX)}` : '(W-w)/2'
  const y = yFrames
    ? `'(H-h)/2+(${keyframeExpr(yFrames, staticY, timeExpr)})'`
    : staticY !== 0 ? `(H-h)/2+${fmt(staticY)}` : '(H-h)/2'
  return { x, y }
}

function textXExpr(text, transform) {
  const offset = typeof transform?.x === 'number' && transform.x !== 0 ? `+${fmt(transform.x)}` : ''
  if (text.align === 'left') return `24${offset}`
  if (text.align === 'right') return `w-text_w-24${offset}`
  return `(w-text_w)/2${offset}`
}

function textYExpr(transform) {
  const offset = typeof transform?.y === 'number' && transform.y !== 0 ? `+${fmt(transform.y)}` : ''
  return `(h-text_h)/2${offset}`
}

export function compileEditorFiltergraph({ timeline, settings, localMediaPaths, localEffectAssetPaths = {}, fontFile, captionAssPath }) {
  assertSupportedEffects(timeline)
  const font = fontFile || DEFAULT_EDITOR_FONT_FILE
  const durationSeconds = Math.max(timelineDurationSeconds(timeline), 0.04)
  const inputs = ['-f', 'lavfi', '-i', `color=c=${settings.background || '#000000'}:s=${settings.width}x${settings.height}:r=${settings.fps}:d=${fmt(durationSeconds)}`]
  const clipInputIndex = new Map()
  let nextInput = 1
  const tracks = timeline.tracks ?? []
  for (const track of tracks) {
    for (const clip of sortedClips(track)) {
      if (!clip.media) continue
      const path = localMediaPaths[clip.id]
      if (!path) throw new Error(`no local media for clip ${clip.id}`)
      if (clip.media.mediaKind === 'image') inputs.push('-loop', '1', '-t', fmt(clip.duration), '-i', path)
      else inputs.push('-i', path)
      clipInputIndex.set(clip.id, nextInput)
      nextInput += 1
    }
  }

  const chains = ['[0:v]format=yuv420p[base]']
  let current = 'base'
  let vcCounter = 0
  let vxCounter = 0
  let vsCounter = 0
  let ovCounter = 0
  let txCounter = 0
  const ctx = { fxCounter: 0, localEffectAssetPaths }

  const visualTracks = tracks.filter((track) => track.kind === 'video' || track.kind === 'overlay')
  for (let trackIdx = visualTracks.length - 1; trackIdx >= 0; trackIdx -= 1) {
    const track = visualTracks[trackIdx]
    const clips = sortedClips(track).filter((clip) => clip.media && clip.media.mediaKind !== 'audio')
    const groups = []
    let index = 0
    while (index < clips.length) {
      const group = [clips[index]]
      for (;;) {
        const last = group[group.length - 1]
        const next = clips[index + group.length]
        const transition = last.transitionAfter
        const adjacent = next && Math.abs((last.timelineStart + last.duration) - next.timelineStart) < 0.001
        if (transition && transition.kind !== 'cut' && XFADE_TRANSITIONS[transition.kind] && adjacent) group.push(next)
        else break
      }
      groups.push(group)
      index += group.length
    }

    for (const group of groups) {
      const labels = group.map((clip) => {
        const label = `vc${vcCounter}`
        buildVisualClipChain(clip, clipInputIndex.get(clip.id), label, chains, vcCounter, ctx)
        vcCounter += 1
        return { clip, label }
      })
      let segmentLabel = labels[0].label
      let segmentDuration = labels[0].clip.duration
      for (let li = 1; li < labels.length; li += 1) {
        const transition = labels[li - 1].clip.transitionAfter
        const merged = `vx${vxCounter}`
        vxCounter += 1
        chains.push(`[${segmentLabel}][${labels[li].label}]xfade=transition=${XFADE_TRANSITIONS[transition.kind]}:duration=${fmt(transition.duration)}:offset=${fmt(segmentDuration - transition.duration)}[${merged}]`)
        segmentDuration = segmentDuration + labels[li].clip.duration - transition.duration
        segmentLabel = merged
      }
      const start = group[0].timelineStart
      const end = start + segmentDuration
      const next = `ov${ovCounter}`
      ovCounter += 1
      const blendMode = group.length === 1 ? BLEND_MODES[group[0].blendMode] : undefined
      if (blendMode) {
        const tx = typeof group[0].transform?.x === 'number' ? group[0].transform.x : 0
        const ty = typeof group[0].transform?.y === 'number' ? group[0].transform.y : 0
        const blendLabel = `bl${ovCounter}`
        chains.push(`[${segmentLabel}]format=yuva420p,pad=w=${settings.width}:h=${settings.height}:x=(ow-iw)/2+${fmt(tx)}:y=(oh-ih)/2+${fmt(ty)}:color=black@0${start > 0 ? `,tpad=start_duration=${fmt(start)}:color=black@0` : ''},tpad=stop=-1,split=2[${blendLabel}rgba][${blendLabel}masksrc]`)
        chains.push(`[${blendLabel}masksrc]alphaextract[${blendLabel}mask]`)
        chains.push(`[${blendLabel}rgba]format=yuv420p[${blendLabel}fg]`)
        chains.push(`[${current}][${blendLabel}fg]blend=all_mode=${blendMode}:enable='between(t,${fmt(start)},${fmt(end)})'[${blendLabel}blend]`)
        chains.push(`[${blendLabel}blend][${blendLabel}mask]alphamerge[${blendLabel}masked]`)
        chains.push(`[${current}][${blendLabel}masked]overlay=eof_action=pass[${next}]`)
      } else {
        if (start > 0) {
          const shifted = `vs${vsCounter}`
          vsCounter += 1
          chains.push(`[${segmentLabel}]setpts=PTS+${fmt(start)}/TB[${shifted}]`)
          segmentLabel = shifted
        }
        const { x, y } = overlayPosition(group[0], group[0].timelineStart)
        chains.push(`[${current}][${segmentLabel}]overlay=x=${x}:y=${y}:enable='between(t,${fmt(start)},${fmt(end)})':eof_action=pass[${next}]`)
      }
      current = next
    }
  }

  for (const track of tracks) {
    if (track.kind !== 'text' && track.kind !== 'overlay') continue
    for (const clip of sortedClips(track)) {
      if (!clip.text) continue
      const start = clip.timelineStart
      const end = start + clip.duration
      const options = [
        `fontfile=${font}`,
        `text='${escapeDrawtext(clip.text.content)}'`,
        `fontsize=${Math.round(clip.text.fontSizePx || 48)}`,
        `fontcolor=${clip.text.color || '#ffffff'}`,
        `x=${textXExpr(clip.text, clip.transform)}`,
        `y=${textYExpr(clip.transform)}`,
      ]
      if (clip.text.backgroundColor) options.push('box=1', `boxcolor=${clip.text.backgroundColor}`, 'boxborderw=12')
      if (clip.text.animationPreset === 'fade_in' || clip.text.animationPreset === 'slide_up') {
        options.push(`alpha='min(1\\,(t-${fmt(start)})/0.5)'`)
      }
      options.push(`enable='between(t,${fmt(start)},${fmt(end)})'`)
      const label = `tx${txCounter}`
      txCounter += 1
      chains.push(`[${current}]drawtext=${options.join(':')}[${label}]`)
      current = label
    }
  }
  if (captionAssPath) {
    const label = 'cap0'
    chains.push(`[${current}]subtitles=filename=${escapeSubtitlesPath(captionAssPath)}[${label}]`)
    current = label
  }
  chains.push(`[${current}]format=yuv420p[vout]`)

  const audioSources = []
  for (const track of tracks) {
    if (track.muted) continue
    for (const clip of sortedClips(track)) {
      if (!clip.media) continue
      if (track.kind === 'audio' && (clip.media.mediaKind === 'audio' || clip.media.mediaKind === 'video')) {
        const volume = typeof clip.volume === 'number' ? clip.volume : 1
        if (volume > 0) audioSources.push({ clip, volume })
      } else if (track.kind === 'video' && clip.media.mediaKind === 'video' && typeof clip.volume === 'number' && clip.volume > 0) {
        audioSources.push({ clip, volume: clip.volume })
      }
    }
  }

  if (audioSources.length === 0) {
    const anullIndex = nextInput
    inputs.push('-f', 'lavfi', '-t', fmt(durationSeconds), '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100')
    chains.push(`[${anullIndex}:a]atrim=duration=${fmt(durationSeconds)}[aout]`)
  } else {
    const labels = []
    audioSources.forEach(({ clip, volume }, index) => {
      const volumeFrames = keyframesForProperty(clip.keyframes, 'volume')
      const label = audioSources.length === 1 ? 'aout' : `ac${index}`
      const trimStart = clip.trimStart ?? 0
      const tailParts = []
      if (volumeFrames.length) {
        tailParts.push(`volume=volume='(${keyframeExpr(volumeFrames, volume, 't')})':eval=frame`)
      } else if (volume !== 1) {
        tailParts.push(`volume=${fmt(volume)}`)
      }
      if (clip.timelineStart > 0) tailParts.push(`adelay=${Math.round(clip.timelineStart * 1000)}:all=1`)

      if (hasSpeedRamp(clip)) {
        const segments = rampSegments(clip, 4)
        const inputLabels = segments.map((_, i) => `ar${index}i${i}`)
        chains.push(`[${clipInputIndex.get(clip.id)}:a]asplit=${segments.length}${inputLabels.map((l) => `[${l}]`).join('')}`)
        const segmentLabels = segments.map((segment, i) => {
          const segLabel = `ar${index}s${i}`
          const atempo = atempoFactors(segment.speed).map((factor) => `atempo=${fmt(factor)}`)
          const chain = [
            `atrim=start=${fmt(trimStart + segment.sourceStart)}:duration=${fmt(segment.sourceDuration)}`,
            'asetpts=PTS-STARTPTS',
            ...(atempo.length ? atempo : []),
          ]
          chains.push(`[${inputLabels[i]}]${chain.join(',')}[${segLabel}]`)
          return segLabel
        })
        const concatTarget = tailParts.length ? `ar${index}c` : label
        chains.push(`${segmentLabels.map((l) => `[${l}]`).join('')}concat=n=${segments.length}:v=0:a=1[${concatTarget}]`)
        if (tailParts.length) chains.push(`[${concatTarget}]${tailParts.join(',')}[${label}]`)
      } else {
        const speed = clipSpeed(clip)
        const parts = [
          `atrim=start=${fmt(trimStart)}:duration=${fmt(clip.duration * speed)}`,
          'asetpts=PTS-STARTPTS',
          ...atempoFactors(speed).map((factor) => `atempo=${fmt(factor)}`),
          ...tailParts,
        ]
        chains.push(`[${clipInputIndex.get(clip.id)}:a]${parts.join(',')}[${label}]`)
      }
      labels.push(label)
    })
    if (audioSources.length > 1) {
      chains.push(`${labels.map((label) => `[${label}]`).join('')}amix=inputs=${labels.length}:duration=longest:normalize=0[aout]`)
    }
  }

  const outputArgs = [
    '-map', '[vout]', '-map', '[aout]',
    '-c:v', 'libx264', '-crf', '20', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-r', String(settings.fps),
    '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-t', fmt(durationSeconds),
  ]
  return { inputs, filterComplex: chains.join(';'), outputArgs, durationSeconds }
}
