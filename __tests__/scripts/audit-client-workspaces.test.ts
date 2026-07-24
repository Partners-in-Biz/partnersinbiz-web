import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  listCoworkInventoryRelativePaths,
  nameFromVpsPath,
  parseAuditOptions,
  relativeFromVpsCoworkPath,
} from '@/scripts/audit-client-workspaces'

describe('audit-client-workspaces path helpers', () => {
  it('parses --org-slug with partners default', () => {
    expect(parseAuditOptions([])).toMatchObject({ orgSlug: 'partners', checkVps: false })
    expect(parseAuditOptions(['--org-slug', 'acme', '--check-vps'])).toMatchObject({
      orgSlug: 'acme',
      checkVps: true,
    })
  })

  it('returns display basename from nested or flat VPS paths', () => {
    expect(nameFromVpsPath('/var/lib/hermes/Cowork/partners/Hunt and Gun')).toBe('Hunt and Gun')
    expect(nameFromVpsPath('/var/lib/hermes/Cowork/Hunt and Gun')).toBe('Hunt and Gun')
    expect(relativeFromVpsCoworkPath('/var/lib/hermes/Cowork/partners/Hunt and Gun')).toBe('partners/Hunt and Gun')
    expect(relativeFromVpsCoworkPath('/var/lib/hermes/Cowork/Hunt and Gun')).toBe('Hunt and Gun')
    expect(() => nameFromVpsPath('/tmp/elsewhere')).toThrow(/Unsafe/)
  })

  it('lists top-level and org-nested inventory keys relative to Cowork root', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'pib-audit-'))
    try {
      mkdirSync(path.join(root, 'Cowork'))
      mkdirSync(path.join(root, 'partners', 'Hunt and Gun'), { recursive: true })
      mkdirSync(path.join(root, 'partners', 'Vikings Wrestling'), { recursive: true })
      mkdirSync(path.join(root, 'Legacy Flat Client'))
      mkdirSync(path.join(root, 'Side Projects'))
      writeFileSync(path.join(root, 'partners', 'ignore-me.txt'), 'x')

      expect(listCoworkInventoryRelativePaths(root, ['partners'])).toEqual([
        'Legacy Flat Client',
        'partners/Hunt and Gun',
        'partners/Vikings Wrestling',
      ])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
