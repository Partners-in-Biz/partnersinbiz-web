const WINDOW_SECONDS = 0.064
const REFRACTORY_SECONDS = 0.25
const HISTORY_SECONDS = 1
const THRESHOLD_RATIO = 1.5
const MIN_ENERGY = 500

export function analyzeBeatsFromPcm(buffer, sampleRate) {
  const pcm = Buffer.isBuffer(buffer)
    ? buffer
    : Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  const sampleCount = Math.floor(pcm.byteLength / 2)
  const windowSize = Math.max(64, Math.round(sampleRate * WINDOW_SECONDS))
  const energies = []
  for (let start = 0; start + windowSize <= sampleCount; start += windowSize) {
    let sum = 0
    for (let i = start; i < start + windowSize; i += 1) {
      const sample = pcm.readInt16LE(i * 2)
      sum += sample * sample
    }
    energies.push(Math.sqrt(sum / windowSize))
  }

  const historyWindows = Math.max(1, Math.round(HISTORY_SECONDS / WINDOW_SECONDS))
  const beats = []
  let lastBeatAt = -Infinity
  for (let i = 0; i < energies.length - 1; i += 1) {
    const from = Math.max(0, i - historyWindows)
    let avg = 0
    for (let j = from; j < i; j += 1) avg += energies[j]
    avg /= Math.max(1, i - from)
    const at = i * WINDOW_SECONDS
    const previousEnergy = i === 0 ? 0 : energies[i - 1]
    const isPeak = energies[i] >= previousEnergy && energies[i] >= energies[i + 1]
    if (energies[i] > MIN_ENERGY && energies[i] > avg * THRESHOLD_RATIO && isPeak && at - lastBeatAt >= REFRACTORY_SECONDS) {
      beats.push(Math.round(at * 1000) / 1000)
      lastBeatAt = at
    }
  }

  let bpm = 0
  if (beats.length >= 3) {
    const intervals = beats.slice(1).map((time, index) => time - beats[index]).sort((a, b) => a - b)
    const median = intervals[Math.floor(intervals.length / 2)]
    if (median > 0) {
      bpm = 60 / median
      while (bpm >= 180) bpm /= 2
      while (bpm > 0 && bpm < 60) bpm *= 2
      bpm = Math.round(bpm * 10) / 10
    }
  }

  return { beats, bpm }
}

export function buildPcmDecodeArgs(inputPath, outputPath) {
  return ['-y', '-i', inputPath, '-vn', '-ac', '1', '-ar', '8000', '-f', 's16le', outputPath]
}
