import { createHash } from 'node:crypto'

function clampInt(value, min, max, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.round(Math.min(Math.max(n, min), max))
}

export function stableClipToken(clipId) {
  return createHash('sha256').update(String(clipId || '')).digest('hex').slice(0, 16)
}

export function buildVidstabDetectArgs(inputPath, trfPath, params = {}) {
  const shakiness = clampInt(params.shakiness, 1, 10, 5)
  return ['-y', '-i', inputPath, '-vf', `vidstabdetect=shakiness=${shakiness}:result=${trfPath}`, '-f', 'null', '-']
}

export function buildVidstabTransformArgs(inputPath, trfPath, outputPath, params = {}) {
  const smoothing = clampInt(params.smoothing, 1, 100, 10)
  return [
    '-y', '-i', inputPath,
    '-vf', `vidstabtransform=input=${trfPath}:smoothing=${smoothing},unsharp=5:5:0.8:3:3:0.4`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-c:a', 'copy', outputPath,
  ]
}

export function collectStabilizeClips(timeline) {
  const found = []
  for (const track of timeline?.tracks ?? []) {
    for (const clip of track?.clips ?? []) {
      if (!clip?.media || clip.media.mediaKind !== 'video') continue
      const effect = (Array.isArray(clip.effects) ? clip.effects : []).find((entry) => entry?.kind === 'stabilize')
      if (!effect) continue
      found.push({
        clipId: clip.id,
        params: {
          shakiness: clampInt(effect.params?.shakiness, 1, 10, 5),
          smoothing: clampInt(effect.params?.smoothing, 1, 100, 10),
        },
      })
    }
  }
  return found
}
