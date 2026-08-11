export const WORKSPACE_CATALOGUE_HEALTHY_REFRESH_MS = 5 * 60_000
export const WORKSPACE_CATALOGUE_RECOVERY_REFRESH_MS = 60_000

export function shouldPollWorkspaceCatalogue(visibilityState: DocumentVisibilityState): boolean {
  return visibilityState !== 'hidden'
}
