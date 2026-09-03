import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { managedProfileName, parseManagedProfileName } from '@/lib/linked-computers/managed-profile'

describe('managedProfileName', () => {
  it('builds partners--pip', () => {
    expect(managedProfileName('partners', 'pip')).toBe('partners--pip')
  })

  it('builds gundemy--qa-release', () => {
    expect(managedProfileName('gundemy', 'qa-release')).toBe('gundemy--qa-release')
  })

  it('shortens a long org slug to 40 chars ending with --pip', () => {
    const name = managedProfileName('a-very-long-organisation-slug-that-keeps-going', 'pip')
    expect(name.length).toBeLessThanOrEqual(40)
    expect(name.endsWith('--pip')).toBe(true)
    expect(name).toMatch(/-[0-9a-f]{6}--pip$/)
  })

  it('rejects uppercase slugs', () => {
    expect(() => managedProfileName('Partners', 'pip')).toThrow('invalid org slug')
  })

  it('rejects dotted agent ids', () => {
    expect(() => managedProfileName('partners', 'pip.v2')).toThrow('invalid agent id')
  })

  it('parses a managed profile name', () => {
    expect(parseManagedProfileName('partners--pip')).toEqual({ orgSlugPart: 'partners', agentId: 'pip' })
  })

  it('keeps the web and runtime copies identical', () => {
    const web = readFileSync(resolve(__dirname, '../../../lib/linked-computers/managed-profile.ts'), 'utf8')
    const runtime = readFileSync(resolve(__dirname, '../../../runtime-installers/runtime/managed-profile.ts'), 'utf8')
    const strip = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').replace(/\s+/g, '')
    expect(strip(web)).toBe(strip(runtime))
  })
})
