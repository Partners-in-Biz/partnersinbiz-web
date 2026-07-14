import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('verify-partners-project-locations CLI', () => {
  it('wires dry-run-first verification to authenticated health, exact folder probes, and Firestore audit writes', () => {
    const source = readFileSync(resolve(process.cwd(), 'scripts/verify-partners-project-locations.ts'), 'utf8')
    expect(source).toContain('runPartnersLocationVerification(process.argv.slice(2)')
    expect(source).toContain("callAgentPath('pip', '/v1/health'")
    expect(source).toContain('parsePartnersVerificationSshConfig(process.env)')
    expect(source).toContain('inspectLocalWorkspaceProjectFolders')
    expect(source).toContain('createProjectLocationVerificationFirestoreRepository')
    expect(source).not.toContain('console.log(process.env')
    expect(source).not.toMatch(/PIB_VPS_HOST\s*\?\?\s*['"][0-9]/)
  })
})
