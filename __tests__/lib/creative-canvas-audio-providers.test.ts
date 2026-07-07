import { getCreativeCanvasProvider } from '@/lib/creative-canvas/providers'

describe('audio BYOK providers', () => {
  it('registers openai_audio with api_key connection support', () => {
    const provider = getCreativeCanvasProvider('openai_audio')
    expect(provider?.label).toBe('OpenAI-compatible audio (Whisper + TTS)')
    expect(provider?.connection?.authKind).toBe('api_key')
    expect(provider?.connection?.credentialFields.map((f) => f.key)).toEqual(['apiKey', 'baseUrl'])
  })
  it('registers elevenlabs with api_key connection support', () => {
    const provider = getCreativeCanvasProvider('elevenlabs')
    expect(provider?.label).toBe('ElevenLabs (TTS)')
    expect(provider?.connection?.authKind).toBe('api_key')
    expect(provider?.connection?.credentialFields.map((f) => f.key)).toEqual(['apiKey'])
  })
})
