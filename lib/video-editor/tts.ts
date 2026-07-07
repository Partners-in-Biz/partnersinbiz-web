import type { TranscriptWord } from './types'

export const DEFAULT_TTS_GATEWAY_BASE_URL = 'https://ai-gateway.vercel.sh/v1'
export const DEFAULT_TTS_MODEL = 'openai/tts-1'
export const DEFAULT_TTS_BYOK_MODEL = 'tts-1'

export interface TtsVoice {
  id: string
  label: string
  provider: 'gateway' | 'elevenlabs'
}

export const OPENAI_TTS_VOICES: TtsVoice[] = [
  { id: 'alloy', label: 'Alloy (neutral)', provider: 'gateway' },
  { id: 'ash', label: 'Ash (warm male)', provider: 'gateway' },
  { id: 'coral', label: 'Coral (warm female)', provider: 'gateway' },
  { id: 'echo', label: 'Echo (male)', provider: 'gateway' },
  { id: 'fable', label: 'Fable (British)', provider: 'gateway' },
  { id: 'onyx', label: 'Onyx (deep male)', provider: 'gateway' },
  { id: 'nova', label: 'Nova (female)', provider: 'gateway' },
  { id: 'sage', label: 'Sage (calm female)', provider: 'gateway' },
  { id: 'shimmer', label: 'Shimmer (bright female)', provider: 'gateway' },
]

export interface SynthesizedSpeech {
  audio: Buffer
  mimeType: 'audio/wav' | 'audio/mpeg'
  durationSeconds: number
  /** Exact word timings when the provider returns them; null → caller estimates. */
  words: TranscriptWord[] | null
}

/**
 * Parse a RIFF/WAVE header: duration = data-chunk bytes / fmt byteRate.
 * Returns 0 when the buffer is not a WAV file.
 */
export function wavDurationSeconds(buffer: Buffer): number {
  if (buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') return 0
  let offset = 12
  let byteRate = 0
  let dataBytes = 0
  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString('ascii', offset, offset + 4)
    const chunkSize = buffer.readUInt32LE(offset + 4)
    if (chunkId === 'fmt ' && offset + 16 + 8 <= buffer.length) byteRate = buffer.readUInt32LE(offset + 8 + 8)
    if (chunkId === 'data') dataBytes = chunkSize
    offset += 8 + chunkSize + (chunkSize % 2)
  }
  if (!byteRate || !dataBytes) return 0
  return Math.round((dataBytes / byteRate) * 1000) / 1000
}

export interface ElevenLabsAlignment {
  characters: string[]
  character_start_times_seconds: number[]
  character_end_times_seconds: number[]
}

/** Group ElevenLabs character alignment into whitespace-delimited word timings. */
export function wordsFromCharAlignment(alignment: ElevenLabsAlignment): TranscriptWord[] {
  const words: TranscriptWord[] = []
  let text = ''
  let start = 0
  let end = 0
  alignment.characters.forEach((char, index) => {
    if (/\s/.test(char)) {
      if (text) words.push({ text, start, end })
      text = ''
      return
    }
    if (!text) start = alignment.character_start_times_seconds[index] ?? 0
    text += char
    end = alignment.character_end_times_seconds[index] ?? end
  })
  if (text) words.push({ text, start, end })
  return words
}

export async function synthesizeSpeechOpenAiCompat(input: {
  text: string
  voice: string
  baseUrl: string
  apiKey: string
  model: string
}): Promise<SynthesizedSpeech> {
  const response = await fetch(`${input.baseUrl.replace(/\/$/, '')}/audio/speech`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${input.apiKey}` },
    body: JSON.stringify({ model: input.model, voice: input.voice, input: input.text, response_format: 'wav' }),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`TTS provider rejected the request (${response.status}): ${detail.slice(0, 300)}`)
  }
  const audio = Buffer.from(await response.arrayBuffer())
  return { audio, mimeType: 'audio/wav', durationSeconds: wavDurationSeconds(audio), words: null }
}

export async function synthesizeSpeechElevenLabs(input: {
  text: string
  voiceId: string
  apiKey: string
  modelId?: string
}): Promise<SynthesizedSpeech> {
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(input.voiceId)}/with-timestamps`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'xi-api-key': input.apiKey },
    body: JSON.stringify({ text: input.text, model_id: input.modelId ?? 'eleven_multilingual_v2' }),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`ElevenLabs rejected the request (${response.status}): ${detail.slice(0, 300)}`)
  }
  const body = await response.json() as { audio_base64?: string; alignment?: ElevenLabsAlignment }
  if (!body.audio_base64) throw new Error('ElevenLabs returned no audio')
  const words = body.alignment ? wordsFromCharAlignment(body.alignment) : null
  const durationSeconds = words?.length ? words[words.length - 1].end : 0
  return { audio: Buffer.from(body.audio_base64, 'base64'), mimeType: 'audio/mpeg', durationSeconds, words }
}

/** Fetch the org's ElevenLabs voices (BYOK only). */
export async function listElevenLabsVoices(apiKey: string): Promise<TtsVoice[]> {
  const response = await fetch('https://api.elevenlabs.io/v1/voices', { headers: { 'xi-api-key': apiKey } })
  if (!response.ok) return []
  const body = await response.json().catch(() => ({})) as { voices?: Array<{ voice_id?: string; name?: string }> }
  return (body.voices ?? [])
    .filter((voice) => typeof voice.voice_id === 'string' && voice.voice_id)
    .map((voice) => ({ id: voice.voice_id!, label: voice.name || voice.voice_id!, provider: 'elevenlabs' as const }))
}
