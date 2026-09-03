import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import YAML from 'yaml'

function hermesHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.PIB_HERMES_HOME || env.HERMES_HOME || path.join(os.homedir(), '.hermes')
}

function profileConfigPath(agentId: string, env: NodeJS.ProcessEnv = process.env): string {
  return path.join(hermesHome(env), 'profiles', agentId, 'config.yaml')
}

function writeSecure(filePath: string, contents: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 })
  fs.writeFileSync(filePath, contents, { encoding: 'utf8', mode: 0o600 })
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function deepMergeYaml(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    const current = next[key]
    if (isPlainObject(current) && isPlainObject(value)) {
      next[key] = deepMergeYaml(current, value)
      continue
    }
    next[key] = value
  }
  return next
}

export function readProfileConfig(
  agentId: string,
  env: NodeJS.ProcessEnv = process.env,
): Record<string, unknown> {
  const filePath = profileConfigPath(agentId, env)
  if (!fs.existsSync(filePath)) return {}
  const parsed = YAML.parse(fs.readFileSync(filePath, 'utf8')) as unknown
  return isPlainObject(parsed) ? parsed : {}
}

export function writeProfileConfigKeys(
  agentId: string,
  patch: Record<string, unknown>,
  env: NodeJS.ProcessEnv = process.env,
): Record<string, unknown> {
  const merged = deepMergeYaml(readProfileConfig(agentId, env), patch)
  writeSecure(profileConfigPath(agentId, env), YAML.stringify(merged))
  return merged
}
