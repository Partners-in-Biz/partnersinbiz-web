/**
 * @jest-environment node
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readProfileConfig, writeProfileConfigKeys } from '@/runtime-installers/runtime/config-yaml'

describe('profile config.yaml merge', () => {
  it('deep-merges keys while preserving unknown map entries', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pib-config-yaml-'))
    const profile = path.join(home, 'profiles', 'partners--pip')
    fs.mkdirSync(profile, { recursive: true })
    fs.writeFileSync(path.join(profile, 'config.yaml'), [
      'model:',
      '  default: old-model',
      '  temperature: 0.2',
      'platforms:',
      '  telegram:',
      '    enabled: true',
      '',
    ].join('\n'))

    const merged = writeProfileConfigKeys('partners--pip', {
      model: { default: 'claude-sonnet-4-6', provider: 'anthropic' },
      platforms: { api_server: { enable: true } },
    }, { PIB_HERMES_HOME: home, HERMES_HOME: home })

    expect(merged).toMatchObject({
      model: { default: 'claude-sonnet-4-6', provider: 'anthropic', temperature: 0.2 },
      platforms: { telegram: { enabled: true }, api_server: { enable: true } },
    })
    expect(readProfileConfig('partners--pip', { PIB_HERMES_HOME: home, HERMES_HOME: home })).toEqual(merged)
    fs.rmSync(home, { recursive: true, force: true })
  })
})
