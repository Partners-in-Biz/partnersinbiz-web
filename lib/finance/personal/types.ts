/** Phase-2 personal finance types — owner-private books separate from org legal-entity books. */

export type PersonalAccountType = 'asset' | 'liability' | 'equity' | 'income' | 'expense'

export interface PersonalBook {
  id: string
  orgId: string
  ownerUid: string
  name: string
  currency: string
  status: 'active' | 'archived'
  schemaVersion: 1
  version: number
  createdAt: string
  createdBy: string
  updatedAt: string
  updatedBy: string
  /** Always owner — never shared to other org members by default. */
  visibility: 'owner'
}

export interface PersonalAccount {
  id: string
  orgId: string
  ownerUid: string
  bookId: string
  code: string
  name: string
  accountType: PersonalAccountType
  openingBalanceMinor: number
  balanceMinor: number
  schemaVersion: 1
  version: number
  createdAt: string
  createdBy: string
  updatedAt: string
  updatedBy: string
}

export interface PersonalEntryLine {
  accountId: string
  debitMinor: number
  creditMinor: number
  description?: string
}

export interface PersonalEntry {
  id: string
  orgId: string
  ownerUid: string
  bookId: string
  entryDate: string
  description: string
  lines: PersonalEntryLine[]
  source:
    | { kind: 'manual' }
    | { kind: 'opening_balance' }
    | { kind: 'org_member_transfer'; transferId: string }
  schemaVersion: 1
  version: number
  createdAt: string
  createdBy: string
  immutable: true
}

/** Org → member pay observation (record-only; never initiates bank payment). */
export interface PersonalTransferObservation {
  id: string
  orgId: string
  memberUid: string
  amountMinor: number
  currency: string
  description: string
  /** Optional link back to org payment/invoice observation. */
  sourcePaymentId?: string
  sourceLegalEntityId?: string
  sourceBookId?: string
  status: 'proposed' | 'accepted' | 'rejected'
  proposedBy: string
  proposedAt: string
  resolvedAt?: string
  resolvedBy?: string
  personalBookId?: string
  personalEntryId?: string
  schemaVersion: 1
  version: number
  /** Hard gate: never true — money movement is observed only. */
  externalPaymentInitiated: false
}

export type PersonalFinanceAction =
  | 'personal.book.create'
  | 'personal.book.read'
  | 'personal.account.create'
  | 'personal.entry.post'
  | 'personal.transfer.propose'
  | 'personal.transfer.accept'
  | 'personal.transfer.reject'
  | 'personal.transfer.read'
