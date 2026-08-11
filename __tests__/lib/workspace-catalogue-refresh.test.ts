import {
  WORKSPACE_CATALOGUE_HEALTHY_REFRESH_MS,
  WORKSPACE_CATALOGUE_RECOVERY_REFRESH_MS,
  shouldPollWorkspaceCatalogue,
} from '@/lib/workspaces/catalogue-refresh'

describe('workspace catalogue refresh policy', () => {
  it('keeps healthy catalogue scans out of the hot polling path', () => {
    expect(WORKSPACE_CATALOGUE_HEALTHY_REFRESH_MS).toBeGreaterThanOrEqual(5 * 60_000)
  })

  it('bounds offline-runtime recovery scans after the immediate retry', () => {
    expect(WORKSPACE_CATALOGUE_RECOVERY_REFRESH_MS).toBeGreaterThanOrEqual(60_000)
  })

  it('does not poll Firestore-backed catalogues from hidden tabs', () => {
    expect(shouldPollWorkspaceCatalogue('visible')).toBe(true)
    expect(shouldPollWorkspaceCatalogue('hidden')).toBe(false)
  })
})
