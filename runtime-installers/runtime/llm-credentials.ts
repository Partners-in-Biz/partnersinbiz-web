import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export type RuntimeCredentialApplyMode = 'env' | 'restart'

export type RuntimeCredentialDelivery = {
  bindingId: string
  connectionId: string
  credentialVersion: number
  provider: string
  hermesProvider: string
  envVar: string | null
  canaryModel: string
  /**
   * 'env' — API-key/env-var provider applied to the running gateway without a
   * restart (DeepSeek etc.). 'restart' — OAuth provider that needs the profile
   * idle so its gateway can reload the refreshed token (xai-oauth etc.).
   */
  applyMode?: RuntimeCredentialApplyMode
  credentials?: Record<string, string>
}

const SAFE_AGENT = /^[a-z][a-z0-9._-]{0,39}$/
const SAFE_PROVIDER = /^[A-Za-z][A-Za-z0-9._:-]{0,63}$/
const SAFE_ENV = /^[A-Z][A-Z0-9_]{1,63}$/

function hermesHome(env: NodeJS.ProcessEnv): string {
  return env.PIB_HERMES_HOME || env.HERMES_HOME || path.join(os.homedir(), '.hermes')
}

function profileDir(agentId: string, env: NodeJS.ProcessEnv): string {
  if (!SAFE_AGENT.test(agentId)) throw new Error('invalid credential profile agent')
  return path.join(hermesHome(env), 'profiles', agentId)
}

function readJson(file: string): Record<string, unknown> {
  if (!fs.existsSync(file)) return {}
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Hermes auth.json must contain an object')
  }
  return parsed as Record<string, unknown>
}

function atomicWrite(file: string, contents: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const owner = fs.statSync(fs.existsSync(file) ? file : path.dirname(file))
  const temporary = `${file}.pib-${process.pid}-${Date.now()}.tmp`
  fs.writeFileSync(temporary, contents, { encoding: 'utf8', mode: 0o600 })
  if (typeof process.getuid === 'function' && process.getuid() === 0) {
    fs.chownSync(temporary, owner.uid, owner.gid)
  }
  fs.renameSync(temporary, file)
}

function cleanSecret(value: unknown, label: string): string {
  const secret = typeof value === 'string' ? value.trim() : ''
  if (!secret || secret.length > 16_384 || /[\r\n\0]/.test(secret)) {
    throw new Error(`${label} is missing or invalid`)
  }
  return secret
}

function cleanOptionalSecret(value: unknown, label: string): string {
  if (value == null || value === '') return ''
  return cleanSecret(value, label)
}

function updateEnv(file: string, envVar: string, value?: string) {
  if (!SAFE_ENV.test(envVar)) throw new Error('invalid Hermes credential env var')
  const lines = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split(/\r?\n/) : []
  const next = lines.filter((line) => !line.startsWith(`${envVar}=`))
  if (value) next.push(`${envVar}=${value}`)
  atomicWrite(file, `${next.filter(Boolean).join('\n')}\n`)
}

function syncCredentialPool(
  store: Record<string, unknown>,
  provider: string,
  accessToken: string,
  refreshToken: string,
  now: string,
) {
  const pool = store.credential_pool && typeof store.credential_pool === 'object' && !Array.isArray(store.credential_pool)
    ? store.credential_pool as Record<string, unknown>
    : {}
  const existing = Array.isArray(pool[provider]) ? pool[provider] as Array<Record<string, unknown>> : []
  const entry = {
    id: `pib-${provider.slice(0, 12)}`,
    label: provider,
    source: 'device_code',
    auth_type: 'oauth',
    priority: 0,
    access_token: accessToken,
    ...(refreshToken ? { refresh_token: refreshToken } : {}),
    last_refresh: now,
    last_status: null,
    last_status_at: null,
    last_error_code: null,
    last_error_reason: null,
    last_error_message: null,
    last_error_reset_at: null,
    ...(provider === 'openai-codex'
      ? { base_url: 'https://chatgpt.com/backend-api/codex' }
      : provider === 'xai-oauth'
        ? { base_url: 'https://api.x.ai/v1' }
        : {}),
  }
  const withoutDeviceCode = existing.filter((candidate) => candidate?.source !== 'device_code')
  pool[provider] = [entry, ...withoutDeviceCode]
  store.credential_pool = pool
}

export function applyRuntimeCredential(input: {
  agentId: string
  delivery: RuntimeCredentialDelivery
  revoke?: boolean
  env?: NodeJS.ProcessEnv
}): { stored: boolean; credentialVersion: number } {
  const env = input.env ?? process.env
  const delivery = input.delivery
  if (!SAFE_PROVIDER.test(delivery.hermesProvider)) throw new Error('invalid Hermes provider id')
  const dir = profileDir(input.agentId, env)
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })

  if (delivery.envVar) {
    // Anthropic OAuth (Claude Code client) is consumed by Hermes through the
    // CLAUDE_CODE_OAUTH_TOKEN env var, whose value is the OAuth access token.
    const envValue = delivery.envVar === 'CLAUDE_CODE_OAUTH_TOKEN'
      ? cleanSecret(delivery.credentials?.access_token, 'OAuth access token')
      : cleanSecret(delivery.credentials?.apiKey, 'API key')
    updateEnv(
      path.join(dir, '.env'),
      delivery.envVar,
      input.revoke ? undefined : envValue,
    )
  } else {
    const authPath = path.join(dir, 'auth.json')
    const store = readJson(authPath)
    const providers = store.providers && typeof store.providers === 'object' && !Array.isArray(store.providers)
      ? store.providers as Record<string, unknown>
      : {}
    if (input.revoke) {
      delete providers[delivery.hermesProvider]
      const pool = store.credential_pool && typeof store.credential_pool === 'object' && !Array.isArray(store.credential_pool)
        ? store.credential_pool as Record<string, unknown>
        : null
      if (pool) delete pool[delivery.hermesProvider]
    } else {
      const accessToken = cleanSecret(delivery.credentials?.access_token, 'OAuth access token')
      const refreshToken = delivery.hermesProvider === 'xai-oauth'
        ? cleanOptionalSecret(delivery.credentials?.refresh_token, 'OAuth refresh token')
        : cleanSecret(delivery.credentials?.refresh_token, 'OAuth refresh token')
      const now = new Date().toISOString()
      providers[delivery.hermesProvider] = {
        tokens: {
          access_token: accessToken,
          ...(refreshToken ? { refresh_token: refreshToken } : {}),
          token_type: delivery.credentials?.token_type || 'Bearer',
          ...(delivery.credentials?.id_token ? { id_token: delivery.credentials.id_token } : {}),
          ...(delivery.credentials?.scope ? { scope: delivery.credentials.scope } : {}),
        },
        last_refresh: now,
        updated_at: now,
        auth_mode: delivery.hermesProvider === 'openai-codex' ? 'chatgpt' : 'oauth_device_code',
        source: 'pib-web-account',
        pib_connection_id: delivery.connectionId,
        pib_credential_version: delivery.credentialVersion,
      }
      syncCredentialPool(store, delivery.hermesProvider, accessToken, refreshToken, now)
    }
    store.providers = providers
    atomicWrite(authPath, `${JSON.stringify(store, null, 2)}\n`)
  }

  atomicWrite(path.join(dir, 'pib-llm-binding.json'), `${JSON.stringify({
    bindingId: delivery.bindingId,
    connectionId: delivery.connectionId,
    credentialVersion: delivery.credentialVersion,
    provider: delivery.provider,
    hermesProvider: delivery.hermesProvider,
    updatedAt: new Date().toISOString(),
    revoked: input.revoke === true,
  }, null, 2)}\n`)

  return { stored: true, credentialVersion: delivery.credentialVersion }
}
