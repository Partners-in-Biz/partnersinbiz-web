import { createHash } from 'crypto'
import { FinanceAuthorizationError } from '@/lib/finance/policy'
import type { FinanceActorContext } from '@/lib/finance/types'
import type {
  FinanceExportPack,
  PackagingFamily,
  PackagingFileArtifact,
  PackagingFinanceAction,
  PackagingKind,
} from './types'

export class PackagingFinanceValidationError extends Error {
  readonly statusCode = 400
  constructor(message: string) {
    super(message)
    this.name = 'PackagingFinanceValidationError'
  }
}

export class PackagingFinanceNotFoundError extends Error {
  readonly statusCode = 404
  constructor(message: string) {
    super(message)
    this.name = 'PackagingFinanceNotFoundError'
  }
}

const SARS_KINDS: PackagingKind[] = ['sars.emp201', 'sars.emp501', 'sars.irp5_it3a', 'sars.vat_return']
const PAYMENT_KINDS: PackagingKind[] = ['payment.eft_instructions', 'payment.payroll_net']
const ACCOUNTANT_KINDS: PackagingKind[] = [
  'accountant.trial_balance',
  'accountant.general_ledger',
  'accountant.open_items',
  'accountant.audit_extract',
  'accountant.cutover_evidence',
]

export const ALL_PACKAGING_KINDS: PackagingKind[] = [
  ...SARS_KINDS,
  ...PAYMENT_KINDS,
  ...ACCOUNTANT_KINDS,
]

export function familyForKind(kind: PackagingKind): PackagingFamily {
  if (kind.startsWith('sars.')) return 'sars'
  if (kind.startsWith('payment.')) return 'payment'
  return 'accountant'
}

export interface CreatePackagingPackCommand {
  id: string
  orgId: string
  legalEntityId: string
  bookId: string
  kind: PackagingKind
  title?: string
  description?: string
  currency?: string
  periodFrom?: string
  periodTo?: string
  sourceRefs?: string[]
  /** Structured payload rows/objects serialized into download files. */
  payload: Record<string, unknown>
  requestId: string
  idempotencyKey: string
}

export interface MarkDownloadedPackCommand {
  id: string
  orgId: string
  requestId: string
  idempotencyKey: string
}

export interface ArchivePackCommand {
  id: string
  orgId: string
  requestId: string
  idempotencyKey: string
}

export interface PackagingFinanceStore {
  packs: Map<string, FinanceExportPack>
  claims: Set<string>
}

export function createEmptyPackagingStore(): PackagingFinanceStore {
  return { packs: new Map(), claims: new Set() }
}

export function clonePackagingStore(store: PackagingFinanceStore): PackagingFinanceStore {
  return {
    packs: new Map(store.packs),
    claims: new Set(store.claims),
  }
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new PackagingFinanceValidationError(`${field} is required`)
  }
  return value.trim()
}

function parseOptionalDate(value: unknown, field: string): string | undefined {
  if (value == null || value === '') return undefined
  const v = requiredText(value, field)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    throw new PackagingFinanceValidationError(`${field} must be YYYY-MM-DD`)
  }
  return v
}

function claim(store: PackagingFinanceStore, key: string, message: string) {
  if (store.claims.has(key)) throw new PackagingFinanceValidationError(message)
  store.claims.add(key)
}

function hasFinanceRole(actor: FinanceActorContext, orgId: string, write: boolean): boolean {
  const isOrgAdmin = actor.membershipRole === 'owner' || actor.membershipRole === 'admin'
  if (isOrgAdmin) return true
  const roles = write
    ? ['finance_admin', 'accountant', 'finance_approver', 'payroll_clerk', 'payroll_approver']
    : ['finance_admin', 'accountant', 'bookkeeper', 'finance_approver', 'auditor', 'payroll_clerk', 'payroll_approver']
  return actor.assignments.some(
    (a) =>
      a.orgId === orgId &&
      a.userId === actor.uid &&
      a.status === 'active' &&
      roles.includes(a.role),
  )
}

export function authorizePackagingAction(
  actor: FinanceActorContext,
  orgId: string,
  action: PackagingFinanceAction,
): void {
  if (!actor.membershipActive) throw new FinanceAuthorizationError('Active organization membership is required')
  if (actor.orgId !== orgId) throw new FinanceAuthorizationError('Actor organization does not match finance scope')
  if (!actor.financeModuleEnabled) throw new FinanceAuthorizationError('Persisted Finance module capability is required')
  const write = action !== 'packaging.read'
  if (!hasFinanceRole(actor, orgId, write)) {
    throw new FinanceAuthorizationError(`Finance role or org admin required for ${action}`)
  }
  if (actor.delegationId) {
    if (actor.delegationOrgId !== orgId) {
      throw new FinanceAuthorizationError('Delegation organization does not match finance scope')
    }
    const scopes = actor.delegationScopes ?? []
    const ok =
      scopes.includes('finance:*') ||
      scopes.some((s) => s.startsWith('finance:')) ||
      scopes.includes(`finance:${action}`) ||
      scopes.includes('finance:packaging:*')
    if (!ok) throw new FinanceAuthorizationError('Delegation does not grant finance packaging access')
  }
}

export function sha256Hex(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

export function buildJsonFile(name: string, data: unknown): PackagingFileArtifact {
  const content = `${JSON.stringify(data, null, 2)}\n`
  return {
    name,
    contentType: 'application/json; charset=utf-8',
    encoding: 'utf8',
    content,
    sha256: sha256Hex(content),
    byteLength: Buffer.byteLength(content, 'utf8'),
  }
}

export function buildCsvFile(name: string, headers: string[], rows: Array<Record<string, unknown>>): PackagingFileArtifact {
  const escape = (value: unknown) => {
    if (value == null) return ''
    const s = String(value)
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
    return s
  }
  const lines = [headers.join(',')]
  for (const row of rows) {
    lines.push(headers.map((h) => escape(row[h])).join(','))
  }
  const content = `${lines.join('\n')}\n`
  return {
    name,
    contentType: 'text/csv; charset=utf-8',
    encoding: 'utf8',
    content,
    sha256: sha256Hex(content),
    byteLength: Buffer.byteLength(content, 'utf8'),
  }
}

function asRowArray(payload: Record<string, unknown>, key = 'rows'): Array<Record<string, unknown>> {
  const rows = payload[key]
  if (!Array.isArray(rows)) return []
  return rows.filter((r) => r && typeof r === 'object') as Array<Record<string, unknown>>
}

export function buildPackFiles(kind: PackagingKind, payload: Record<string, unknown>): {
  files: PackagingFileArtifact[]
  rowCount: number
} {
  const rows = asRowArray(payload)
  const meta = {
    kind,
    generatedForDownloadOnly: true,
    sarsSubmissionInitiated: false as const,
    externalPaymentInitiated: false as const,
    externalEgressAllowed: false as const,
    payloadMeta: payload.meta ?? null,
  }

  switch (kind) {
    case 'sars.emp201': {
      const files = [
        buildJsonFile('emp201-payload.json', { ...meta, rows }),
        buildCsvFile(
          'emp201-lines.csv',
          ['taxPeriod', 'payeMinor', 'uifMinor', 'sdlMinor', 'totalMinor', 'employeeCount', 'reference'],
          rows,
        ),
        buildJsonFile('README.json', {
          notice: 'SARS-ready EMP201 download pack. Internal evidence only — no eFiling submission initiated.',
          sarsSubmissionInitiated: false,
        }),
      ]
      return { files, rowCount: rows.length }
    }
    case 'sars.emp501': {
      const files = [
        buildJsonFile('emp501-payload.json', { ...meta, rows }),
        buildCsvFile(
          'emp501-reconciliation.csv',
          ['taxYear', 'emp201TotalMinor', 'certificateTotalMinor', 'differenceMinor', 'status', 'reference'],
          rows,
        ),
        buildJsonFile('README.json', {
          notice: 'SARS-ready EMP501 download pack. No eFiling submission.',
          sarsSubmissionInitiated: false,
        }),
      ]
      return { files, rowCount: rows.length }
    }
    case 'sars.irp5_it3a': {
      const files = [
        buildJsonFile('irp5-it3a-batch.json', { ...meta, certificates: rows }),
        buildCsvFile(
          'certificates.csv',
          ['certificateKind', 'employeeId', 'taxYear', 'taxableIncomeMinor', 'payeMinor', 'uifMinor', 'certificateNumber'],
          rows,
        ),
        buildJsonFile('README.json', {
          notice: 'IRP5/IT3(a) batch download pack. Not submitted to SARS.',
          sarsSubmissionInitiated: false,
        }),
      ]
      return { files, rowCount: rows.length }
    }
    case 'sars.vat_return': {
      const files = [
        buildJsonFile('vat-return-payload.json', { ...meta, rows, boxes: payload.boxes ?? null }),
        buildCsvFile(
          'vat-boxes.csv',
          ['boxCode', 'label', 'amountMinor', 'currency'],
          asRowArray(payload, 'boxRows').length ? asRowArray(payload, 'boxRows') : rows,
        ),
        buildJsonFile('README.json', {
          notice: 'VAT return download pack for accountant/SARS preparation. No eFiling submit.',
          sarsSubmissionInitiated: false,
        }),
      ]
      return { files, rowCount: rows.length || asRowArray(payload, 'boxRows').length }
    }
    case 'payment.eft_instructions': {
      const files = [
        buildJsonFile('eft-instructions.json', { ...meta, instructions: rows }),
        buildCsvFile(
          'eft-batch.csv',
          ['beneficiaryName', 'bankName', 'accountNumber', 'branchCode', 'amountMinor', 'currency', 'reference', 'sourceDocumentId'],
          rows,
        ),
        buildJsonFile('README.json', {
          notice: 'Payment instruction export only. Bank/payment initiation is disabled.',
          externalPaymentInitiated: false,
        }),
      ]
      return { files, rowCount: rows.length }
    }
    case 'payment.payroll_net': {
      const files = [
        buildJsonFile('payroll-net-pay.json', { ...meta, pays: rows }),
        buildCsvFile(
          'payroll-net-pay.csv',
          ['employeeId', 'employeeName', 'bankName', 'accountNumber', 'branchCode', 'netPayMinor', 'currency', 'payRunId', 'reference'],
          rows,
        ),
        buildJsonFile('README.json', {
          notice: 'Payroll net-pay observation export. Does not initiate salary payments.',
          externalPaymentInitiated: false,
        }),
      ]
      return { files, rowCount: rows.length }
    }
    case 'accountant.trial_balance': {
      const files = [
        buildJsonFile('trial-balance.json', { ...meta, lines: rows }),
        buildCsvFile(
          'trial-balance.csv',
          ['accountId', 'accountCode', 'accountName', 'debitMinor', 'creditMinor', 'currency'],
          rows,
        ),
      ]
      return { files, rowCount: rows.length }
    }
    case 'accountant.general_ledger': {
      const files = [
        buildJsonFile('general-ledger.json', { ...meta, lines: rows }),
        buildCsvFile(
          'general-ledger.csv',
          ['journalEntryId', 'postingDate', 'accountId', 'accountCode', 'debitMinor', 'creditMinor', 'description', 'currency'],
          rows,
        ),
      ]
      return { files, rowCount: rows.length }
    }
    case 'accountant.open_items': {
      const files = [
        buildJsonFile('open-items.json', { ...meta, items: rows }),
        buildCsvFile(
          'open-items.csv',
          ['openItemId', 'counterpartyRole', 'counterpartyCompanyId', 'originalMinor', 'openMinor', 'dueDate', 'currency', 'sourceType'],
          rows,
        ),
      ]
      return { files, rowCount: rows.length }
    }
    case 'accountant.audit_extract': {
      const files = [
        buildJsonFile('audit-events.json', { ...meta, events: rows }),
        buildCsvFile(
          'audit-events.csv',
          ['eventId', 'occurredAt', 'action', 'actorId', 'resourceType', 'resourceId', 'summary'],
          rows,
        ),
      ]
      return { files, rowCount: rows.length }
    }
    case 'accountant.cutover_evidence': {
      const files = [
        buildJsonFile('cutover-package.json', { ...meta, package: payload.package ?? payload }),
        buildJsonFile('cutover-evidence-manifest.json', {
          notice: 'Cutover package evidence extract for accountant handover.',
          sarsSubmissionInitiated: false,
          externalPaymentInitiated: false,
        }),
      ]
      return { files, rowCount: 1 }
    }
    default: {
      const _exhaustive: never = kind
      throw new PackagingFinanceValidationError(`Unsupported packaging kind: ${String(_exhaustive)}`)
    }
  }
}

function defaultTitle(kind: PackagingKind): string {
  switch (kind) {
    case 'sars.emp201':
      return 'SARS EMP201 pack'
    case 'sars.emp501':
      return 'SARS EMP501 pack'
    case 'sars.irp5_it3a':
      return 'SARS IRP5/IT3(a) pack'
    case 'sars.vat_return':
      return 'SARS VAT return pack'
    case 'payment.eft_instructions':
      return 'EFT payment instruction pack'
    case 'payment.payroll_net':
      return 'Payroll net-pay instruction pack'
    case 'accountant.trial_balance':
      return 'Accountant trial balance pack'
    case 'accountant.general_ledger':
      return 'Accountant general ledger pack'
    case 'accountant.open_items':
      return 'Accountant open items pack'
    case 'accountant.audit_extract':
      return 'Accountant audit extract pack'
    case 'accountant.cutover_evidence':
      return 'Accountant cutover evidence pack'
    default:
      return 'Finance export pack'
  }
}

export class PackagingFinanceService {
  constructor(
    private readonly loadStore: () => Promise<PackagingFinanceStore>,
    private readonly saveStore: (before: PackagingFinanceStore, after: PackagingFinanceStore) => Promise<void>,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async createPack(actor: FinanceActorContext, command: CreatePackagingPackCommand): Promise<FinanceExportPack> {
    authorizePackagingAction(actor, command.orgId, 'packaging.pack.create')
    const orgId = requiredText(command.orgId, 'orgId')
    const id = requiredText(command.id, 'id')
    const kind = command.kind
    if (!ALL_PACKAGING_KINDS.includes(kind)) {
      throw new PackagingFinanceValidationError('kind is not a supported packaging kind')
    }
    if (!command.payload || typeof command.payload !== 'object' || Array.isArray(command.payload)) {
      throw new PackagingFinanceValidationError('payload object is required')
    }

    const before = await this.loadStore()
    const store = clonePackagingStore(before)
    claim(store, `packaging_idem:${orgId}:${command.idempotencyKey}`, 'Idempotency key already used for packaging create')
    if (store.packs.has(id)) {
      throw new PackagingFinanceValidationError('Pack id already exists')
    }

    const family = familyForKind(kind)
    const { files, rowCount } = buildPackFiles(kind, command.payload)
    const contentDigest = sha256Hex(files.map((f) => `${f.name}:${f.sha256}`).join('|'))
    const now = this.now()
    const pack: FinanceExportPack = {
      id,
      orgId,
      legalEntityId: requiredText(command.legalEntityId, 'legalEntityId'),
      bookId: requiredText(command.bookId, 'bookId'),
      kind,
      family,
      status: 'ready',
      title: command.title?.trim() || defaultTitle(kind),
      currency: (command.currency || 'ZAR').trim().toUpperCase(),
      periodFrom: parseOptionalDate(command.periodFrom, 'periodFrom'),
      periodTo: parseOptionalDate(command.periodTo, 'periodTo'),
      description: command.description?.trim() || defaultTitle(kind),
      sourceRefs: Array.isArray(command.sourceRefs)
        ? command.sourceRefs.map(String).filter(Boolean)
        : [],
      files,
      manifest: {
        schemaVersion: 1,
        packId: id,
        kind,
        family,
        generatedAt: now,
        fileCount: files.length,
        contentDigest,
        externalEgressAllowed: false,
        sarsSubmissionInitiated: false,
        externalPaymentInitiated: false,
      },
      rowCount,
      createdBy: actor.uid,
      createdAt: now,
      updatedBy: actor.uid,
      updatedAt: now,
      schemaVersion: 1,
      version: 1,
      sarsSubmissionInitiated: false,
      externalPaymentInitiated: false,
      externalEgressAllowed: false,
    }

    // Hard gate assertions — never allow true on create.
    if (pack.sarsSubmissionInitiated || pack.externalPaymentInitiated || pack.externalEgressAllowed) {
      throw new PackagingFinanceValidationError('Egress/submission flags must remain false')
    }

    store.packs.set(id, pack)
    await this.saveStore(before, store)
    return structuredClone(pack)
  }

  async markDownloaded(actor: FinanceActorContext, command: MarkDownloadedPackCommand): Promise<FinanceExportPack> {
    authorizePackagingAction(actor, command.orgId, 'packaging.pack.mark_downloaded')
    const orgId = requiredText(command.orgId, 'orgId')
    const id = requiredText(command.id, 'id')
    const before = await this.loadStore()
    const store = clonePackagingStore(before)
    claim(store, `packaging_idem:${orgId}:${command.idempotencyKey}`, 'Idempotency key already used for packaging download mark')
    const existing = store.packs.get(id)
    if (!existing || existing.orgId !== orgId) {
      throw new PackagingFinanceNotFoundError('Export pack not found')
    }
    if (existing.status === 'archived') {
      throw new PackagingFinanceValidationError('Archived packs cannot be marked downloaded')
    }
    const now = this.now()
    const next: FinanceExportPack = {
      ...existing,
      status: 'downloaded',
      downloadedAt: now,
      downloadedBy: actor.uid,
      updatedAt: now,
      updatedBy: actor.uid,
      version: existing.version + 1,
      sarsSubmissionInitiated: false,
      externalPaymentInitiated: false,
      externalEgressAllowed: false,
      manifest: {
        ...existing.manifest,
        sarsSubmissionInitiated: false,
        externalPaymentInitiated: false,
        externalEgressAllowed: false,
      },
    }
    store.packs.set(id, next)
    await this.saveStore(before, store)
    return structuredClone(next)
  }

  async archivePack(actor: FinanceActorContext, command: ArchivePackCommand): Promise<FinanceExportPack> {
    authorizePackagingAction(actor, command.orgId, 'packaging.pack.archive')
    const orgId = requiredText(command.orgId, 'orgId')
    const id = requiredText(command.id, 'id')
    const before = await this.loadStore()
    const store = clonePackagingStore(before)
    claim(store, `packaging_idem:${orgId}:${command.idempotencyKey}`, 'Idempotency key already used for packaging archive')
    const existing = store.packs.get(id)
    if (!existing || existing.orgId !== orgId) {
      throw new PackagingFinanceNotFoundError('Export pack not found')
    }
    const now = this.now()
    const next: FinanceExportPack = {
      ...existing,
      status: 'archived',
      updatedAt: now,
      updatedBy: actor.uid,
      version: existing.version + 1,
      sarsSubmissionInitiated: false,
      externalPaymentInitiated: false,
      externalEgressAllowed: false,
    }
    store.packs.set(id, next)
    await this.saveStore(before, store)
    return structuredClone(next)
  }

  async listForOrg(
    actor: FinanceActorContext,
    orgId: string,
    filters?: { bookId?: string; family?: PackagingFamily; packId?: string },
  ): Promise<{ packs: FinanceExportPack[] }> {
    authorizePackagingAction(actor, orgId, 'packaging.read')
    const store = await this.loadStore()
    let packs = [...store.packs.values()].filter((p) => p.orgId === orgId)
    if (filters?.bookId) packs = packs.filter((p) => p.bookId === filters.bookId)
    if (filters?.family) packs = packs.filter((p) => p.family === filters.family)
    if (filters?.packId) packs = packs.filter((p) => p.id === filters.packId)
    packs.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    return { packs: packs.map((p) => structuredClone(p)) }
  }
}
