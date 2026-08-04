/**
 * Credential vault stub for bank-feed live providers.
 *
 * Production-shaped boundary only:
 * - Secrets are never committed, never returned as plaintext, never logged.
 * - Callers store secretRefId on connections; adapters resolve metadata via this vault.
 * - Missing/revoked/wrong-org refs fail closed.
 * - This module does not call Secret Manager / KMS / vendor APIs.
 *
 * Live material injection requires a separate Peet-approved ops path (see
 * docs/architecture/finance-bank-feed-za-aggregator-boundary.md).
 */

export type BankFeedSecretRefStatus = 'missing' | 'present_metadata_only' | 'revoked'

export interface BankFeedSecretRefMetadata {
  secretRefId: string
  orgId: string
  /** Intended provider family (e.g. za_aggregator_stub). Not a vendor brand bind. */
  providerId: string
  status: Exclude<BankFeedSecretRefStatus, 'missing'>
  /** Human label only — never credentials. */
  label?: string
  createdAt: string
  updatedAt: string
}

export class BankFeedCredentialVaultError extends Error {
  readonly statusCode = 400
  constructor(message: string) {
    super(message)
    this.name = 'BankFeedCredentialVaultError'
  }
}

/**
 * In-process vault stub used by unit tests and fail-closed adapter skeletons.
 * Never accepts or stores secret bytes / API keys / client secrets.
 */
export class BankFeedCredentialVaultStub {
  private readonly refs = new Map<string, BankFeedSecretRefMetadata>()

  /**
   * Register metadata-only presence for a secretRefId (tests / future ops wiring).
   * Deliberately has no `secretValue` / `apiKey` parameter.
   */
  registerMetadataOnly(input: {
    secretRefId: string
    orgId: string
    providerId: string
    label?: string
    status?: 'present_metadata_only' | 'revoked'
    nowIso: string
  }): BankFeedSecretRefMetadata {
    const secretRefId = input.secretRefId.trim()
    const orgId = input.orgId.trim()
    const providerId = input.providerId.trim()
    if (!secretRefId) throw new BankFeedCredentialVaultError('secretRefId is required')
    if (!orgId) throw new BankFeedCredentialVaultError('orgId is required')
    if (!providerId) throw new BankFeedCredentialVaultError('providerId is required')
    if (looksLikeInlineSecret(secretRefId)) {
      throw new BankFeedCredentialVaultError(
        'secretRefId must be an opaque reference id, not inline credential material',
      )
    }

    const meta: BankFeedSecretRefMetadata = {
      secretRefId,
      orgId,
      providerId,
      status: input.status ?? 'present_metadata_only',
      createdAt: input.nowIso,
      updatedAt: input.nowIso,
      ...(input.label?.trim() ? { label: input.label.trim() } : {}),
    }
    this.refs.set(key(orgId, secretRefId), meta)
    return { ...meta }
  }

  revoke(orgId: string, secretRefId: string, nowIso: string): void {
    const k = key(orgId, secretRefId)
    const existing = this.refs.get(k)
    if (!existing) {
      throw new BankFeedCredentialVaultError('Secret ref not found')
    }
    this.refs.set(k, { ...existing, status: 'revoked', updatedAt: nowIso })
  }

  /**
   * Resolve metadata only. Never returns secret material.
   * Fail closed on missing / wrong org / revoked.
   */
  resolveMetadata(orgId: string, secretRefId: string | undefined): BankFeedSecretRefMetadata {
    if (!secretRefId?.trim()) {
      throw new BankFeedCredentialVaultError('secretRefId is required to resolve credentials')
    }
    if (looksLikeInlineSecret(secretRefId)) {
      throw new BankFeedCredentialVaultError(
        'secretRefId must be an opaque reference id, not inline credential material',
      )
    }
    const meta = this.refs.get(key(orgId, secretRefId.trim()))
    if (!meta || meta.orgId !== orgId) {
      throw new BankFeedCredentialVaultError('Secret ref not found for org (fail closed)')
    }
    if (meta.status === 'revoked') {
      throw new BankFeedCredentialVaultError('Secret ref is revoked (fail closed)')
    }
    return { ...meta }
  }

  /**
   * Adapter preflight: usable metadata for the intended provider, no secret bytes.
   */
  assertUsableForProvider(input: {
    orgId: string
    secretRefId: string | undefined
    providerId: string
  }): BankFeedSecretRefMetadata {
    const meta = this.resolveMetadata(input.orgId, input.secretRefId)
    if (meta.providerId !== input.providerId) {
      throw new BankFeedCredentialVaultError(
        `Secret ref provider mismatch: expected ${input.providerId}, got ${meta.providerId}`,
      )
    }
    return meta
  }

  /** Test helper — never expose secret values. */
  listMetadataForOrg(orgId: string): BankFeedSecretRefMetadata[] {
    return [...this.refs.values()].filter((m) => m.orgId === orgId).map((m) => ({ ...m }))
  }
}

function key(orgId: string, secretRefId: string): string {
  return `${orgId}::${secretRefId}`
}

/**
 * Heuristic guard: reject values that look like pasted API keys / PEMs / long secrets.
 * Real refs should be short opaque ids (e.g. sec_bf_org_abc123).
 */
export function looksLikeInlineSecret(value: string): boolean {
  const v = value.trim()
  if (v.length > 128) return true
  if (/BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY/.test(v)) return true
  if (/^(sk_live_|sk_test_|rk_live_|xox[baprs]-)/i.test(v)) return true
  if (v.includes('\n') || v.includes(' ')) return true
  if (/^[A-Za-z0-9+/=]{80,}$/.test(v) && !v.startsWith('sec_')) return true
  return false
}

/** Shared empty vault factory for services/tests. */
export function createEmptyBankFeedCredentialVault(): BankFeedCredentialVaultStub {
  return new BankFeedCredentialVaultStub()
}
