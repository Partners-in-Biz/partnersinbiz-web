export type PortalModuleKey = 'mobileApps' | 'youtubeStudio' | 'bookStudio'

export type PortalModules = Record<PortalModuleKey, boolean>

export const DEFAULT_PORTAL_MODULES: PortalModules = {
  mobileApps: true,
  youtubeStudio: true,
  bookStudio: false,
}

type OrgSettingsLike = {
  portalModules?: Partial<Record<PortalModuleKey, boolean>> | null
} | null | undefined

export function resolvePortalModules(settings: OrgSettingsLike): PortalModules {
  const stored = settings?.portalModules ?? {}
  return {
    mobileApps: stored.mobileApps !== false,
    youtubeStudio: stored.youtubeStudio !== false,
    bookStudio: stored.bookStudio === true,
  }
}

export function isPortalModuleEnabled(settings: OrgSettingsLike, key: PortalModuleKey): boolean {
  return resolvePortalModules(settings)[key]
}
