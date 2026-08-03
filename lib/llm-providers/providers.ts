/**
 * Hermes-compatible chat LLM providers for org/user OAuth + BYOK.
 * Catalogue mirrors https://hermes-agent.nousresearch.com/docs/integrations/providers
 * Cursor IDE subscriptions are NOT an inference provider — see unsupported note.
 */

export type LlmProviderAuthKind = 'api_key' | 'oauth' | 'api_key_or_oauth'

export type LlmProviderKey =
  | 'xai'
  | 'xai-oauth'
  | 'openai-codex'
  | 'openai-api'
  | 'anthropic'
  | 'gemini'
  | 'deepseek'
  | 'openrouter'
  | 'nous'
  | 'copilot'

export interface LlmCredentialField {
  key: string
  label: string
  secret: boolean
  placeholder?: string
  optional?: boolean
}

export interface LlmProviderDefinition {
  key: LlmProviderKey
  label: string
  description: string
  hermesProvider: string
  authKind: LlmProviderAuthKind
  /** Env var Hermes reads for API-key auth (when applicable). */
  envVar?: string
  credentialFields: LlmCredentialField[]
  consoleUrl?: string
  docsUrl?: string
  /** Static fallback model ids when Hermes /v1/models is incomplete. */
  curatedModels: string[]
  oauthCapable: boolean
}

/** Explicitly unsupported — Cursor has no third-party inference API for Hermes. */
export const UNSUPPORTED_CURSOR_NOTE =
  'Cursor IDE subscriptions cannot power Hermes agents. There is no Cursor model API. Use xAI Grok (SuperGrok OAuth or API key), OpenAI Codex (ChatGPT OAuth), GitHub Copilot, Anthropic, Gemini, or OpenRouter instead.'

/**
 * App-side catalogue used when a selected linked computer cannot expose its
 * loopback Hermes `/v1/models` endpoint to the web runtime. Keep this aligned
 * with `infra/hermes/patch_llm_model_allowlist.py`.
 */
const XAI_CURATED_MODELS = [
  'grok-build-0.1',
  'grok-4.5',
  'grok-4.3',
  'grok-composer-2.5-fast',
  'grok-4.20-0309-reasoning',
  'grok-4.20-0309-non-reasoning',
  'grok-4.20-multi-agent-0309',
]

const OPENAI_CODEX_CURATED_MODELS = [
  'gpt-5.6-luna',
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-5.5',
  'gpt-5.4',
  'gpt-5.4-mini',
  'gpt-5.3-codex',
  'gpt-5.3-codex-spark',
  'gpt-5.2-codex',
]

/** DeepSeek API model ids — Flash first (latest cheap default), then Pro + legacy aliases. */
const DEEPSEEK_CURATED_MODELS = [
  'deepseek-v4-flash',
  'deepseek-v4-pro',
  // Server-side aliases of Flash non-thinking / thinking modes
  'deepseek-chat',
  'deepseek-reasoner',
]

export const LLM_PROVIDERS: LlmProviderDefinition[] = [
  {
    key: 'xai-oauth',
    label: 'xAI Grok (SuperGrok OAuth)',
    description: 'Sign in with SuperGrok or X Premium+ — no API key required.',
    hermesProvider: 'xai-oauth',
    authKind: 'oauth',
    credentialFields: [],
    consoleUrl: 'https://accounts.x.ai',
    docsUrl: 'https://hermes-agent.nousresearch.com/docs/integrations/providers',
    curatedModels: XAI_CURATED_MODELS,
    oauthCapable: true,
  },
  {
    key: 'xai',
    label: 'xAI Grok (API key)',
    description: 'Pay-per-token Grok models via XAI_API_KEY.',
    hermesProvider: 'xai',
    authKind: 'api_key',
    envVar: 'XAI_API_KEY',
    credentialFields: [{ key: 'apiKey', label: 'xAI API key', secret: true, placeholder: 'xai-…' }],
    consoleUrl: 'https://console.x.ai/team/default/api-keys',
    docsUrl: 'https://docs.x.ai/docs',
    curatedModels: XAI_CURATED_MODELS,
    oauthCapable: false,
  },
  {
    key: 'openai-codex',
    label: 'OpenAI Codex (ChatGPT)',
    description: 'ChatGPT Plus/Pro subscription via device-code OAuth.',
    hermesProvider: 'openai-codex',
    authKind: 'oauth',
    credentialFields: [],
    consoleUrl: 'https://chatgpt.com',
    docsUrl: 'https://hermes-agent.nousresearch.com/docs/integrations/providers',
    curatedModels: OPENAI_CODEX_CURATED_MODELS,
    oauthCapable: true,
  },
  {
    key: 'openai-api',
    label: 'OpenAI API',
    description: 'Direct OpenAI API key (pay-per-token, not ChatGPT subscription).',
    hermesProvider: 'openai-api',
    authKind: 'api_key',
    envVar: 'OPENAI_API_KEY',
    credentialFields: [{ key: 'apiKey', label: 'OpenAI API key', secret: true, placeholder: 'sk-…' }],
    consoleUrl: 'https://platform.openai.com/api-keys',
    curatedModels: ['gpt-5.4', 'gpt-5.4-mini', 'gpt-4.1', 'gpt-4o'],
    oauthCapable: false,
  },
  {
    key: 'anthropic',
    label: 'Anthropic Claude',
    description: 'Claude via API key. OAuth requires Claude Max + extra usage credits.',
    hermesProvider: 'anthropic',
    authKind: 'api_key_or_oauth',
    envVar: 'ANTHROPIC_API_KEY',
    credentialFields: [{ key: 'apiKey', label: 'Anthropic API key', secret: true, placeholder: 'sk-ant-…' }],
    consoleUrl: 'https://console.anthropic.com/settings/keys',
    curatedModels: ['claude-sonnet-4-6', 'claude-opus-4-6', 'claude-haiku-4-5'],
    oauthCapable: true,
  },
  {
    key: 'gemini',
    label: 'Google Gemini',
    description: 'Gemini models via Google AI Studio API key.',
    hermesProvider: 'gemini',
    authKind: 'api_key',
    envVar: 'GEMINI_API_KEY',
    credentialFields: [{ key: 'apiKey', label: 'Gemini API key', secret: true, placeholder: 'AIza…' }],
    consoleUrl: 'https://aistudio.google.com/apikey',
    curatedModels: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-3-flash-preview'],
    oauthCapable: false,
  },
  {
    key: 'deepseek',
    label: 'DeepSeek',
    description:
      'DeepSeek V4 Flash + Pro via DEEPSEEK_API_KEY. Base URL https://api.deepseek.com (OpenAI-compatible). Peak-hour pricing (2×) may apply — see Messages usage chip when connected.',
    hermesProvider: 'deepseek',
    authKind: 'api_key',
    envVar: 'DEEPSEEK_API_KEY',
    credentialFields: [{ key: 'apiKey', label: 'DeepSeek API key', secret: true, placeholder: 'sk-…' }],
    consoleUrl: 'https://platform.deepseek.com/api_keys',
    docsUrl: 'https://api-docs.deepseek.com/quick_start/pricing/',
    curatedModels: DEEPSEEK_CURATED_MODELS,
    oauthCapable: false,
  },
  {
    key: 'openrouter',
    label: 'OpenRouter',
    description: 'One key for many frontier models.',
    hermesProvider: 'openrouter',
    authKind: 'api_key',
    envVar: 'OPENROUTER_API_KEY',
    credentialFields: [{ key: 'apiKey', label: 'OpenRouter API key', secret: true, placeholder: 'sk-or-…' }],
    consoleUrl: 'https://openrouter.ai/keys',
    curatedModels: [
      'anthropic/claude-sonnet-4-6',
      'google/gemini-2.5-flash',
      'x-ai/grok-4.5',
      'openai/gpt-5.4',
    ],
    oauthCapable: false,
  },
  {
    key: 'nous',
    label: 'Nous Portal',
    description: 'Nous Research subscription — OAuth covers 300+ models.',
    hermesProvider: 'nous',
    authKind: 'oauth',
    credentialFields: [],
    consoleUrl: 'https://portal.nousresearch.com/manage-subscription',
    curatedModels: [],
    oauthCapable: true,
  },
  {
    key: 'copilot',
    label: 'GitHub Copilot',
    description: 'GitHub Copilot subscription via OAuth device code.',
    hermesProvider: 'copilot',
    authKind: 'oauth',
    envVar: 'COPILOT_GITHUB_TOKEN',
    credentialFields: [
      {
        key: 'apiKey',
        label: 'GitHub token (gho_ / github_pat_ / ghu_)',
        secret: true,
        placeholder: 'gho_…',
        optional: true,
      },
    ],
    consoleUrl: 'https://github.com/settings/copilot',
    curatedModels: ['gpt-5.4', 'gpt-5.4-mini', 'claude-sonnet-4'],
    oauthCapable: true,
  },
]

const BY_KEY = new Map(LLM_PROVIDERS.map((p) => [p.key, p]))

export function listLlmProviders(): LlmProviderDefinition[] {
  return LLM_PROVIDERS
}

export function getLlmProvider(key: string): LlmProviderDefinition | null {
  return BY_KEY.get(key as LlmProviderKey) ?? null
}

export function hermesProviderForConnection(key: LlmProviderKey): string {
  return getLlmProvider(key)?.hermesProvider ?? key
}
