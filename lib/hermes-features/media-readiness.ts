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
  /** When true, browser contract may attempt live navigate only if backend + tooling ready */
  liveBrowser?: boolean
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

/** Read readiness from env / explicit config — never claim ready without a real signal. */
export function mediaConfigFromEnv(overrides: MediaBackendConfig = {}): MediaBackendConfig {
  return {
    sttConfigured:
      overrides.sttConfigured ??
      Boolean(process.env.HERMES_STT_ENABLED === '1' || process.env.OPENAI_API_KEY),
    ttsProvider:
      overrides.ttsProvider ??
      process.env.HERMES_TTS_PROVIDER ??
      process.env.TTS_PROVIDER ??
      null,
    browserBackend:
      overrides.browserBackend ??
      (process.env.BROWSER_CDP_URL
        ? 'cdp'
        : process.env.BROWSERBASE_API_KEY
          ? 'browserbase'
          : process.env.BROWSER_USE_API_KEY
            ? 'browser_use'
            : null),
    visionModel:
      overrides.visionModel ??
      process.env.HERMES_VISION_MODEL ??
      process.env.VISION_MODEL ??
      null,
    imageGenProvider:
      overrides.imageGenProvider ??
      process.env.HERMES_IMAGE_GEN_PROVIDER ??
      (process.env.FAL_KEY ? 'fal' : null),
    discordVoice: overrides.discordVoice ?? false,
    liveBrowser: overrides.liveBrowser,
  }
}

export function assessMediaReadiness(config: MediaBackendConfig = {}): MediaReadiness[] {
  const resolved = mediaConfigFromEnv(config)
  const tts = normalizeTtsProvider(resolved.ttsProvider)
  return [
    {
      capability: 'voice_stt',
      status: resolved.sttConfigured ? 'ready' : 'not_ready',
      provider: resolved.sttConfigured ? 'hermes-stt' : undefined,
      detail: resolved.sttConfigured
        ? 'STT credentials/config present'
        : 'Hermes STT not configured; browser speech recognition is fallback-only',
    },
    {
      capability: 'voice_tts',
      status: tts ? 'ready' : 'not_ready',
      provider: tts || undefined,
      detail: tts
        ? `Hermes TTS provider configured: ${tts}`
        : 'No Hermes TTS provider env (HERMES_TTS_PROVIDER); browser speechSynthesis is not multi-provider Hermes TTS',
    },
    {
      capability: 'browser',
      status: resolved.browserBackend ? 'ready' : 'not_ready',
      provider: resolved.browserBackend || undefined,
      detail: resolved.browserBackend
        ? `Browser backend configured: ${resolved.browserBackend}`
        : 'No Browserbase / Browser Use / CDP backend env configured',
    },
    {
      capability: 'vision',
      status: resolved.visionModel ? 'ready' : 'not_ready',
      provider: resolved.visionModel || undefined,
      detail: resolved.visionModel
        ? `Vision model bound: ${resolved.visionModel}`
        : 'No vision-capable model env (HERMES_VISION_MODEL)',
    },
    {
      capability: 'image_generation',
      status: resolved.imageGenProvider ? 'ready' : 'not_ready',
      provider: resolved.imageGenProvider || undefined,
      detail: resolved.imageGenProvider
        ? `Image gen provider: ${resolved.imageGenProvider}`
        : 'No FAL_KEY / HERMES_IMAGE_GEN_PROVIDER',
    },
  ]
}

export function readinessFor(
  list: MediaReadiness[],
  capability: MediaCapability,
): FeatureReadiness {
  return list.find((r) => r.capability === capability)?.status || 'not_ready'
}

export function browserNavigateExtractContract(input: {
  url: string
  backend: string | null
}): { ok: boolean; action: string; detail: string; status: FeatureReadiness } {
  if (!input.backend) {
    return {
      ok: false,
      action: 'navigate',
      detail: 'browser backend not ready',
      status: 'not_ready',
    }
  }
  if (!/^https?:\/\//i.test(input.url)) {
    return {
      ok: false,
      action: 'navigate',
      detail: 'url must be http(s)',
      status: 'not_ready',
    }
  }
  return {
    ok: true,
    action: 'navigate_extract',
    detail: `Backend ${input.backend} ready for navigate+extract of ${input.url} via Hermes browser tool path`,
    status: 'ready',
  }
}

export interface HermesSpeakResult {
  ok: boolean
  provider?: string
  /** Operator-usable instruction for Hermes TTS tool — not a fake audio URL. */
  hermesToolHint?: string
  status: FeatureReadiness
  detail: string
}

export function hermesSpeakPath(provider: string | null, text: string): HermesSpeakResult {
  const tts = normalizeTtsProvider(provider)
  if (!tts) {
    return {
      ok: false,
      status: 'not_ready',
      detail: 'tts not ready — set HERMES_TTS_PROVIDER',
    }
  }
  if (!text.trim()) {
    return {
      ok: false,
      provider: tts,
      status: 'not_ready',
      detail: 'empty text',
    }
  }
  return {
    ok: true,
    provider: tts,
    status: 'ready',
    detail: `Use Hermes TTS tool with provider=${tts} for ${text.trim().length} chars`,
    hermesToolHint: `tts.speak provider=${tts} text=${JSON.stringify(text.trim().slice(0, 500))}`,
  }
}
