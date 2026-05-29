export type BillingDetailsPatchOptions = {
  allowBankingDetails?: boolean
}

type PlainRecord = Record<string, unknown>

const STRING_FIELDS = [
  'legalName',
  'tradingName',
  'vatNumber',
  'registrationNumber',
  'taxNumber',
  'phone',
  'purchaseOrderNumber',
  'invoiceInstructions',
] as const

const ADDRESS_FIELDS = ['line1', 'line2', 'city', 'state', 'postalCode', 'country'] as const
const CONTACT_FIELDS = ['name', 'title', 'email', 'phone'] as const
const BANKING_FIELDS = [
  'bankName',
  'accountHolder',
  'accountNumber',
  'branchCode',
  'routingNumber',
  'swiftCode',
  'iban',
] as const

function isRecord(value: unknown): value is PlainRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function cleanString(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim() : undefined
}

function cleanEmail(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim().toLowerCase() : undefined
}

function mergeStringFields<T extends readonly string[]>(
  input: PlainRecord,
  existing: PlainRecord,
  fields: T,
  emailFields: Set<string> = new Set(),
): PlainRecord {
  const out: PlainRecord = { ...existing }
  for (const field of fields) {
    if (!(field in input)) continue
    const cleaned = emailFields.has(field) ? cleanEmail(input[field]) : cleanString(input[field])
    if (cleaned !== undefined) out[field] = cleaned
  }
  return out
}

function mergeAddress(input: unknown, existing: unknown): PlainRecord | undefined {
  if (!isRecord(input)) return isRecord(existing) ? { ...existing } : undefined
  return mergeStringFields(input, isRecord(existing) ? existing : {}, ADDRESS_FIELDS)
}

function mergeContact(input: unknown, existing: unknown): PlainRecord | undefined {
  if (!isRecord(input)) return isRecord(existing) ? { ...existing } : undefined
  return mergeStringFields(input, isRecord(existing) ? existing : {}, CONTACT_FIELDS, new Set(['email']))
}

function mergeBanking(input: unknown, existing: unknown): PlainRecord | undefined {
  if (!isRecord(input)) return isRecord(existing) ? { ...existing } : undefined
  return mergeStringFields(input, isRecord(existing) ? existing : {}, BANKING_FIELDS)
}

export function mergeBillingDetailsForWrite(
  input: unknown,
  existing: unknown = {},
  options: BillingDetailsPatchOptions = {},
): PlainRecord {
  const existingRecord = isRecord(existing) ? existing : {}
  if (!isRecord(input)) return { ...existingRecord }

  const out = mergeStringFields(input, existingRecord, STRING_FIELDS)

  if ('purchaseOrderRequired' in input) {
    out.purchaseOrderRequired = input.purchaseOrderRequired === true
  }

  if ('address' in input) {
    const address = mergeAddress(input.address, existingRecord.address)
    if (address) out.address = address
  }

  if ('accountsContact' in input) {
    const accountsContact = mergeContact(input.accountsContact, existingRecord.accountsContact)
    if (accountsContact) out.accountsContact = accountsContact
  }

  if ('authorizedSignatory' in input) {
    const authorizedSignatory = mergeContact(input.authorizedSignatory, existingRecord.authorizedSignatory)
    if (authorizedSignatory) out.authorizedSignatory = authorizedSignatory
  }

  if (options.allowBankingDetails) {
    if ('bankingDetails' in input) {
      const bankingDetails = mergeBanking(input.bankingDetails, existingRecord.bankingDetails)
      if (bankingDetails) out.bankingDetails = bankingDetails
    }
  } else if (isRecord(existingRecord.bankingDetails)) {
    out.bankingDetails = { ...existingRecord.bankingDetails }
  }

  return out
}

export function publicBillingDetails(value: unknown): PlainRecord {
  if (!isRecord(value)) return {}
  const out = mergeBillingDetailsForWrite({}, value, { allowBankingDetails: false })
  delete out.bankingDetails
  return out
}
