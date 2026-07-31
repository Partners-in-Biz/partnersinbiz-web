import type { FeatureReadiness, MediaCapability, MediaReadiness } from './types'

export const HERMES_TTS_PROVIDERS = [
  'edge',
  'elevenlabs',
  'openai',
  'minimax',
  'mistral',
  'gemini',
  'xai',
  'neutts',
  'kitten',
  'piper',
  'custom',
] as const

export type HermesTtsProvider = (typeof HERMES_TTS_PROVIDERS)[number]

export interface MediaBackendConfig {
  sttConfigured?: boolean
  ttsProvider?: string | null
  browserBackend?: 'browserbase' | 'browser_use' | 'cdp' | 'local' | null
  visionModel?: string | null
  imageGenProvider?: string | null
  discordVoice?: boolean
}

export function normalizeTtsProvider(value: string | null | undefined): HermesTtsProvider | null {
  if (!value) return null
  const cleaned = value.trim().toLowerCase().replace(/[^a-z0-9]/g, '')
  const map: Record<string, HermesTtsProvider> = {
    edge: 'edge',
    edgetts: 'edge',
    elevenlabs: 'elevenlabs',
    openai: 'openai',
    openaitts: 'openai',
    minimax: 'minimax',
    mistral: 'mistral',
    voxtral: 'mistral',
    gemini: 'gemini',
    google: 'gemini',
    xai: 'xai',
    grok: 'xai',
    neutts: 'neutts',
    kitten: 'kitten',
    kittentts: 'kitten',
    piper: 'piper',
    custom: 'custom',
  }
  return map[cleaned] ?? null
}

export function assessMediaReadiness(config: MediaBackendConfig = {}): MediaReadiness[] {
  const tts = normalizeTtsProvider(config.ttsProvider)
  const results: MediaReadiness[] = [
    {
      capability: 'voice_stt',
      status: config.sttConfigured ? 'ready' : 'not_ready',
      provider: config.sttConfigured ? 'hermes-stt' : undefined,
      detail: config.sttConfigured
        ? 'Hermes STT path configured'
        : 'Hermes STT not configured; browser speech recognition is fallback-only',
    },
    {
      capability: 'voice_tts',
      status: tts ? 'ready' : 'not_ready',
      provider: tts || undefined,
      detail: tts
        ? `Hermes TTS provider: ${tts}`
        : 'No Hermes TTS provider; browser speechSynthesis is not Hermes multi-provider TTS',
    },
    {
      capability: 'browser',
      status: config.browserBackend ? 'ready' : 'not_ready',
      provider: config.browserBackend || undefined,
      detail: config.browserBackend
        ? `Browser backend: ${config.browserBackend}`
        : 'No Browserbase / Browser Use / CDP / local backend configured',
    },
    {
      capability: 'vision',
      status: config.visionModel ? 'ready' : 'not_ready',
      provider: config.visionModel || undefined,
      detail: config.visionModel
        ? `Vision model: ${config.visionModel}`
        : 'No vision-capable model bound for attachment analysis',
    },
    {
      capability: 'image_generation',
      status: config.imageGenProvider ? 'ready' : 'not_ready',
      provider: config.imageGenProvider || undefined,
      detail: config.imageGenProvider
        ? `Image gen: ${config.imageGenProvider}`
        : 'Hermes FAL/image-gen tool path not configured',
    },
  ]
  return results
}

export function readinessFor(
  list: MediaReadiness[],
  capability: MediaCapability,
): FeatureReadiness {
  return list.find((r) => r.capability === capability)?.status || 'not_ready'
}

/** Product-safe browser navigate/extract contract (no live browser required for unit gate). */
export function browserNavigateExtractContract(input: {
  url: string
  backend: string | null
}): { ok: boolean; action: string; detail: string } {
  if (!input.backend) {
    return { ok: false, action: 'navigate', detail: 'browser backend not ready' }
  }
  if (!/^https?:\/\//i.test(input.url)) {
    return { ok: false, action: 'navigate', detail: 'url must be http(s)' }
  }
  return {
    ok: true,
    action: 'navigate_extract',
    detail: `Would navigate ${input.url} via ${input.backend} and extract page text`,
  }
}

export function hermesSpeakPath(provider: string | null, text: string): {
  ok: boolean
  provider?: string
  audioHint: string
} {
  const tts = normalizeTtsProvider(provider)
  if (!tts) {
    return { ok: false, audioHint: 'tts not ready' }
  }
  if (!text.trim()) {
    return { ok: false, provider: tts, audioHint: 'empty text' }
  }
  return {
    ok: true,
    provider: tts,
    audioHint: `hermes-tts://${tts}?chars=${text.trim().length}`,
  }
}
