export const KNOWN_ORG_PERSON_TWIN_IDS = new Set([
  'I478D32VOu4rm7a2utoS', // Peet X
  'z6jekgWOpRJs229kbd4I', // Peet LinkedIn
  'Kod7W9yQ6h6QStYtKcKc', // Petrus Facebook
  'DoSNwHvOI6Q3CmBREAPe', // Stean LinkedIn
  'Wf2bCTtxplgaM7SkRzG8', // Stean X
])

const PERSON_PROFILE_PLATFORMS = new Set(['linkedin', 'twitter', 'x', 'facebook'])

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function isOrgPersonProfileTwin(
  id: string,
  data: { accountScope?: unknown; platform?: unknown; accountType?: unknown; subAccountType?: unknown },
): boolean {
  if (data.accountScope === 'personal') return false
  if (KNOWN_ORG_PERSON_TWIN_IDS.has(id)) return true
  const platform = clean(data.platform).toLowerCase()
  if (!PERSON_PROFILE_PLATFORMS.has(platform)) return false
  const kind = clean(data.accountType || data.subAccountType).toLowerCase()
  return kind === 'personal'
}

export function personalOwnerKey(platform: unknown, platformAccountId: unknown): string {
  return `${clean(platform).toLowerCase()}:${clean(platformAccountId)}`
}

export function ownerUidForRehome(
  data: { connectedBy?: unknown; platform?: unknown; platformAccountId?: unknown },
  personalOwners: Map<string, string>,
): string {
  const connectedBy = clean(data.connectedBy)
  if (connectedBy && connectedBy !== 'oauth') return connectedBy
  return personalOwners.get(personalOwnerKey(data.platform, data.platformAccountId)) ?? ''
}

export function rehomePersonProfilePatch(ownerUid: string): Record<string, unknown> {
  return {
    accountScope: 'personal',
    ownerUid: ownerUid || null,
    isDefault: false,
    marketingOwner: 'personal',
  }
}
