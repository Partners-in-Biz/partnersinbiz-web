import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { applyRuntimeCredential } from '@/runtime-installers/runtime/llm-credentials'

function tempHermesHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pib-llm-cred-test-'))
}

function envFor(home: string): NodeJS.ProcessEnv {
  return { PIB_HERMES_HOME: home } as NodeJS.ProcessEnv
}

function readEnvFile(home: string, agentId: string): string {
  return fs.readFileSync(path.join(home, 'profiles', agentId, '.env'), 'utf8')
}

describe('applyRuntimeCredential — Anthropic OAuth env path', () => {
  it('writes the OAuth access token as CLAUDE_CODE_OAUTH_TOKEN', () => {
    const home = tempHermesHome()
    const env = envFor(home)
    const result = applyRuntimeCredential({
      agentId: 'theo',
      env,
      delivery: {
        bindingId: 'binding-1',
        connectionId: 'conn-1',
        credentialVersion: 2,
        provider: 'anthropic',
        hermesProvider: 'anthropic',
        envVar: 'CLAUDE_CODE_OAUTH_TOKEN',
        canaryModel: 'claude-sonnet-4-6',
        applyMode: 'env',
        credentials: {
          access_token: 'at-oauth-secret',
          refresh_token: '',
          expires_at: '2026-08-08T00:00:00.000Z',
        },
      },
    })
    expect(result).toEqual({ stored: true, credentialVersion: 2 })
    const envFile = readEnvFile(home, 'theo')
    expect(envFile).toContain('CLAUDE_CODE_OAUTH_TOKEN=at-oauth-secret')
    expect(envFile).not.toContain('refresh_token')
  })

  it('activates OAuth over a previously applied Anthropic API key without deleting the saved API connection', () => {
    const home = tempHermesHome()
    const env = envFor(home)
    const apiDelivery = {
      bindingId: 'binding-api', connectionId: 'conn-api', credentialVersion: 1,
      provider: 'anthropic', hermesProvider: 'anthropic', envVar: 'ANTHROPIC_API_KEY',
      canaryModel: 'claude-sonnet-4-6', applyMode: 'env' as const,
      credentials: { apiKey: 'sk-ant-api-secret' },
    }
    applyRuntimeCredential({ agentId: 'theo', env, delivery: apiDelivery })
    applyRuntimeCredential({
      agentId: 'theo', env,
      delivery: {
        bindingId: 'binding-oauth', connectionId: 'conn-oauth', credentialVersion: 2,
        provider: 'anthropic', hermesProvider: 'anthropic', envVar: 'CLAUDE_CODE_OAUTH_TOKEN',
        canaryModel: 'claude-sonnet-4-6', applyMode: 'env',
        credentials: { access_token: 'at-oauth-secret' },
      },
    })
    const envFile = readEnvFile(home, 'theo')
    expect(envFile).toContain('CLAUDE_CODE_OAUTH_TOKEN=at-oauth-secret')
    expect(envFile).not.toContain('ANTHROPIC_API_KEY=')
  })

  it('switches back to API-key auth when the Anthropic API credential is applied later', () => {
    const home = tempHermesHome()
    const env = envFor(home)
    applyRuntimeCredential({
      agentId: 'theo', env,
      delivery: {
        bindingId: 'binding-oauth', connectionId: 'conn-oauth', credentialVersion: 1,
        provider: 'anthropic', hermesProvider: 'anthropic', envVar: 'CLAUDE_CODE_OAUTH_TOKEN',
        canaryModel: 'claude-sonnet-4-6', applyMode: 'env',
        credentials: { access_token: 'at-oauth-secret' },
      },
    })
    applyRuntimeCredential({
      agentId: 'theo', env,
      delivery: {
        bindingId: 'binding-api', connectionId: 'conn-api', credentialVersion: 2,
        provider: 'anthropic', hermesProvider: 'anthropic', envVar: 'ANTHROPIC_API_KEY',
        canaryModel: 'claude-sonnet-4-6', applyMode: 'env',
        credentials: { apiKey: 'sk-ant-api-secret' },
      },
    })
    const envFile = readEnvFile(home, 'theo')
    expect(envFile).toContain('ANTHROPIC_API_KEY=sk-ant-api-secret')
    expect(envFile).not.toContain('CLAUDE_CODE_OAUTH_TOKEN=')
  })

  it('rejects the env path when the access token is missing', () => {
    const home = tempHermesHome()
    const env = envFor(home)
    expect(() =>
      applyRuntimeCredential({
        agentId: 'theo',
        env,
        delivery: {
          bindingId: 'binding-1',
          connectionId: 'conn-1',
          credentialVersion: 1,
          provider: 'anthropic',
          hermesProvider: 'anthropic',
          envVar: 'CLAUDE_CODE_OAUTH_TOKEN',
          canaryModel: 'claude-sonnet-4-6',
          applyMode: 'env',
          credentials: { refresh_token: 'rt' },
        },
      }),
    ).toThrow('OAuth access token is missing or invalid')
  })

  it('still writes api-key providers through the apiKey field', () => {
    const home = tempHermesHome()
    const env = envFor(home)
    applyRuntimeCredential({
      agentId: 'theo',
      env,
      delivery: {
        bindingId: 'binding-2',
        connectionId: 'conn-2',
        credentialVersion: 1,
        provider: 'deepseek',
        hermesProvider: 'deepseek',
        envVar: 'DEEPSEEK_API_KEY',
        canaryModel: 'deepseek-chat',
        applyMode: 'env',
        credentials: { apiKey: 'sk-api-key' },
      },
    })
    expect(readEnvFile(home, 'theo')).toContain('DEEPSEEK_API_KEY=sk-api-key')
  })

  it('removes the env var on revoke', () => {
    const home = tempHermesHome()
    const env = envFor(home)
    applyRuntimeCredential({
      agentId: 'theo',
      env,
      delivery: {
        bindingId: 'binding-3',
        connectionId: 'conn-3',
        credentialVersion: 1,
        provider: 'anthropic',
        hermesProvider: 'anthropic',
        envVar: 'CLAUDE_CODE_OAUTH_TOKEN',
        canaryModel: 'claude-sonnet-4-6',
        applyMode: 'env',
        credentials: { access_token: 'at-oauth-secret' },
      },
    })
    applyRuntimeCredential({
      agentId: 'theo',
      env,
      revoke: true,
      delivery: {
        bindingId: 'binding-3',
        connectionId: 'conn-3',
        credentialVersion: 1,
        provider: 'anthropic',
        hermesProvider: 'anthropic',
        envVar: 'CLAUDE_CODE_OAUTH_TOKEN',
        canaryModel: 'claude-sonnet-4-6',
        applyMode: 'env',
        credentials: { access_token: 'at-oauth-secret' },
      },
    })
    expect(readEnvFile(home, 'theo')).not.toContain('CLAUDE_CODE_OAUTH_TOKEN=')
  })
})
