import {
  OPENAI_TTS_VOICES,
  synthesizeSpeechOpenAiCompat,
  synthesizeSpeechElevenLabs,
  wavDurationSeconds,
  wordsFromCharAlignment,
} from '@/lib/video-editor/tts'

function makeWav(dataBytes: number, byteRate: number): Buffer {
  // Minimal RIFF/WAVE with fmt (16 bytes) + data chunks.
  const buffer = Buffer.alloc(44 + dataBytes)
  buffer.write('RIFF', 0); buffer.writeUInt32LE(36 + dataBytes, 4); buffer.write('WAVE', 8)
  buffer.write('fmt ', 12); buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(24000, 24); buffer.writeUInt32LE(byteRate, 28)
  buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36); buffer.writeUInt32LE(dataBytes, 40)
  return buffer
}

describe('wavDurationSeconds', () => {
  it('computes duration from the data chunk and byte rate', () => {
    expect(wavDurationSeconds(makeWav(48000 * 2, 48000))).toBeCloseTo(2, 3)
  })
  it('returns 0 for non-wav buffers', () => {
    expect(wavDurationSeconds(Buffer.from('not a wav file at all'))).toBe(0)
  })
})

describe('wordsFromCharAlignment', () => {
  it('groups character timings into word timings', () => {
    const words = wordsFromCharAlignment({
      characters: ['H', 'i', ' ', 'y', 'o', 'u'],
      character_start_times_seconds: [0, 0.1, 0.2, 0.3, 0.4, 0.5],
      character_end_times_seconds: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6],
    })
    expect(words).toEqual([
      { text: 'Hi', start: 0, end: 0.2 },
      { text: 'you', start: 0.3, end: 0.6 },
    ])
  })
})

describe('synthesizeSpeechOpenAiCompat', () => {
  afterEach(() => { (global.fetch as jest.Mock | undefined)?.mockRestore?.() })

  it('POSTs to /audio/speech and returns the wav buffer + duration', async () => {
    const wav = makeWav(24000, 48000) // 0.5s
    global.fetch = jest.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength) }) as unknown as typeof fetch
    const result = await synthesizeSpeechOpenAiCompat({
      text: 'Hello', voice: 'alloy', baseUrl: 'https://ai-gateway.vercel.sh/v1', apiKey: 'gk', model: 'openai/tts-1',
    })
    expect(result.mimeType).toBe('audio/wav')
    expect(result.durationSeconds).toBeCloseTo(0.5, 3)
    expect(result.words).toBeNull() // no provider timing marks — caller estimates
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0]
    expect(url).toBe('https://ai-gateway.vercel.sh/v1/audio/speech')
    expect(JSON.parse(init.body)).toEqual({ model: 'openai/tts-1', voice: 'alloy', input: 'Hello', response_format: 'wav' })
  })

  it('throws with provider detail on failure', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 400, text: async () => 'bad voice' }) as unknown as typeof fetch
    await expect(synthesizeSpeechOpenAiCompat({ text: 'x', voice: 'v', baseUrl: 'https://b', apiKey: 'k', model: 'm' })).rejects.toThrow('400')
  })
})

describe('synthesizeSpeechElevenLabs', () => {
  afterEach(() => { (global.fetch as jest.Mock | undefined)?.mockRestore?.() })

  it('returns mp3 buffer, alignment words and duration from the alignment', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        audio_base64: Buffer.from('mp3data').toString('base64'),
        alignment: {
          characters: ['H', 'i'],
          character_start_times_seconds: [0, 0.2],
          character_end_times_seconds: [0.2, 0.4],
        },
      }),
    }) as unknown as typeof fetch
    const result = await synthesizeSpeechElevenLabs({ text: 'Hi', voiceId: 'v-1', apiKey: 'ek' })
    expect(result.mimeType).toBe('audio/mpeg')
    expect(result.durationSeconds).toBeCloseTo(0.4, 3)
    expect(result.words).toEqual([{ text: 'Hi', start: 0, end: 0.4 }])
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0]
    expect(url).toBe('https://api.elevenlabs.io/v1/text-to-speech/v-1/with-timestamps')
    expect(init.headers['xi-api-key']).toBe('ek')
  })
})

describe('voice registry', () => {
  it('exposes the OpenAI voices', () => {
    expect(OPENAI_TTS_VOICES.map((v) => v.id)).toEqual(
      expect.arrayContaining(['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer']),
    )
    expect(OPENAI_TTS_VOICES.every((v) => v.provider === 'gateway')).toBe(true)
  })
})
