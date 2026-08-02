import { createHash } from 'crypto'
import type { ParsedStatementLine, StatementFileFormat } from './types'

export class StatementParseError extends Error {
  readonly statusCode = 400
  constructor(message: string) {
    super(message)
    this.name = 'StatementParseError'
  }
}

function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex')
}

function normalizeDate(raw: string): string {
  const s = raw.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  // DD/MM/YYYY or DD-MM-YYYY (ZA common)
  const m1 = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/)
  if (m1) {
    const dd = m1[1].padStart(2, '0')
    const mm = m1[2].padStart(2, '0')
    return `${m1[3]}-${mm}-${dd}`
  }
  // YYYYMMDD
  const m2 = s.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (m2) return `${m2[1]}-${m2[2]}-${m2[3]}`
  // OFX style YYYYMMDDHHMMSS
  const m3 = s.match(/^(\d{4})(\d{2})(\d{2})\d*$/)
  if (m3) return `${m3[1]}-${m3[2]}-${m3[3]}`
  throw new StatementParseError(`Unrecognized date: ${raw}`)
}

/** Parse decimal/amount strings into signed minor units. */
export function parseAmountToMinor(raw: string): number {
  const cleaned = raw.replace(/[, ]/g, '').replace(/R/gi, '').trim()
  if (!cleaned) throw new StatementParseError('Empty amount')
  const neg = cleaned.startsWith('(') && cleaned.endsWith(')')
  const body = neg ? cleaned.slice(1, -1) : cleaned
  if (!/^[+-]?\d+(\.\d{1,4})?$/.test(body)) {
    throw new StatementParseError(`Invalid amount: ${raw}`)
  }
  const sign = body.startsWith('-') || neg ? -1 : 1
  const abs = body.replace(/^[+-]/, '')
  const [whole, frac = ''] = abs.split('.')
  const frac2 = (frac + '00').slice(0, 2)
  const minor = Number(whole) * 100 + Number(frac2)
  if (!Number.isSafeInteger(minor) || minor === 0) {
    throw new StatementParseError(`Amount out of range or zero: ${raw}`)
  }
  return sign * minor
}

function fingerprint(parts: Array<string | number>): string {
  return sha256(parts.map(String).join('|'))
}

function detectFormat(text: string): Exclude<StatementFileFormat, 'auto'> {
  const head = text.slice(0, 400).toUpperCase()
  if (head.includes('<OFX') || head.includes('OFXHEADER') || head.includes('<STMTTRN>')) return 'ofx'
  if (head.includes(':20:') || head.includes(':61:') || head.includes(':25:')) return 'mt940'
  return 'csv'
}

function parseCsv(text: string): ParsedStatementLine[] {
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  if (lines.length === 0) throw new StatementParseError('CSV statement is empty')

  const split = (row: string): string[] => {
    const out: string[] = []
    let cur = ''
    let inQ = false
    for (let i = 0; i < row.length; i++) {
      const ch = row[i]
      if (ch === '"') {
        if (inQ && row[i + 1] === '"') {
          cur += '"'
          i++
        } else {
          inQ = !inQ
        }
        continue
      }
      if (ch === ',' && !inQ) {
        out.push(cur.trim())
        cur = ''
        continue
      }
      cur += ch
    }
    out.push(cur.trim())
    return out
  }

  const headerCells = split(lines[0]).map((c) => c.toLowerCase())
  const looksHeader =
    headerCells.some((h) => h.includes('date')) &&
    headerCells.some((h) => h.includes('amount') || h.includes('debit') || h.includes('credit'))

  let dateIdx = 0
  let amountIdx = 1
  let descIdx = 2
  let refIdx = -1
  let counterpartyIdx = -1
  let debitIdx = -1
  let creditIdx = -1
  let start = 0

  if (looksHeader) {
    start = 1
    dateIdx = headerCells.findIndex((h) => h.includes('date'))
    amountIdx = headerCells.findIndex((h) => h === 'amount' || h.includes('amount'))
    debitIdx = headerCells.findIndex((h) => h.includes('debit'))
    creditIdx = headerCells.findIndex((h) => h.includes('credit'))
    descIdx = headerCells.findIndex((h) => h.includes('desc') || h.includes('narration') || h.includes('details'))
    refIdx = headerCells.findIndex((h) => h.includes('ref'))
    counterpartyIdx = headerCells.findIndex((h) => h.includes('counter') || h.includes('payee') || h.includes('name'))
    if (dateIdx < 0) throw new StatementParseError('CSV header missing date column')
    if (amountIdx < 0 && (debitIdx < 0 || creditIdx < 0)) {
      throw new StatementParseError('CSV header missing amount or debit/credit columns')
    }
    if (descIdx < 0) descIdx = Math.max(dateIdx, amountIdx, debitIdx, creditIdx) + 1
  }

  const parsed: ParsedStatementLine[] = []
  for (let i = start; i < lines.length; i++) {
    const cells = split(lines[i])
    if (cells.every((c) => !c)) continue
    const dateRaw = cells[dateIdx]
    if (!dateRaw) continue
    let amountMinor: number
    if (amountIdx >= 0 && cells[amountIdx]) {
      amountMinor = parseAmountToMinor(cells[amountIdx])
    } else {
      const debit = cells[debitIdx] ? parseAmountToMinor(cells[debitIdx]) : 0
      const credit = cells[creditIdx] ? parseAmountToMinor(cells[creditIdx]) : 0
      if (debit && credit) throw new StatementParseError(`Row ${i + 1}: both debit and credit set`)
      if (!debit && !credit) throw new StatementParseError(`Row ${i + 1}: missing amount`)
      amountMinor = credit ? Math.abs(credit) : -Math.abs(debit)
    }
    const description = (cells[descIdx] || 'Statement line').trim() || 'Statement line'
    const reference = refIdx >= 0 ? cells[refIdx] || undefined : undefined
    const counterpartyName = counterpartyIdx >= 0 ? cells[counterpartyIdx] || undefined : undefined
    const statementDate = normalizeDate(dateRaw)
    const fp = fingerprint([
      'csv',
      statementDate,
      amountMinor,
      description,
      reference || '',
      counterpartyName || '',
      i,
    ])
    parsed.push({
      lineIndex: parsed.length,
      statementDate,
      effectiveDate: statementDate,
      amountMinor,
      description,
      ...(reference ? { reference } : {}),
      ...(counterpartyName ? { counterpartyName } : {}),
      sourceFingerprint: fp,
      raw: lines[i],
    })
  }
  if (parsed.length === 0) throw new StatementParseError('CSV produced no transaction lines')
  return parsed
}

function parseOfx(text: string): ParsedStatementLine[] {
  const blocks = text.split(/<STMTTRN>/i).slice(1)
  if (blocks.length === 0) throw new StatementParseError('OFX contains no STMTTRN blocks')
  const tag = (block: string, name: string): string | undefined => {
    const re = new RegExp(`<${name}>([^\\n\\r<]+)`, 'i')
    const m = block.match(re)
    return m ? m[1].trim() : undefined
  }
  const parsed: ParsedStatementLine[] = []
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]
    const dt = tag(block, 'DTPOSTED') || tag(block, 'DTUSER')
    const amt = tag(block, 'TRNAMT')
    const name = tag(block, 'NAME') || tag(block, 'PAYEE') || 'OFX transaction'
    const memo = tag(block, 'MEMO')
    const fitid = tag(block, 'FITID')
    const checknum = tag(block, 'CHECKNUM')
    if (!dt || !amt) throw new StatementParseError(`OFX STMTTRN ${i + 1} missing DTPOSTED/TRNAMT`)
    const statementDate = normalizeDate(dt)
    const amountMinor = parseAmountToMinor(amt)
    const description = [name, memo].filter(Boolean).join(' — ')
    const reference = fitid || checknum
    const fp = fingerprint(['ofx', fitid || '', statementDate, amountMinor, description])
    parsed.push({
      lineIndex: parsed.length,
      statementDate,
      effectiveDate: statementDate,
      amountMinor,
      description,
      ...(reference ? { reference } : {}),
      ...(name ? { counterpartyName: name } : {}),
      sourceFingerprint: fp,
      raw: block.slice(0, 500),
    })
  }
  return parsed
}

/** Minimal MT940 :61: / :86: parser. */
function parseMt940(text: string): ParsedStatementLine[] {
  const normalized = text.replace(/\r\n/g, '\n')
  const chunks = normalized.split(/(?=^:61:)/m).filter((c) => c.startsWith(':61:'))
  if (chunks.length === 0) throw new StatementParseError('MT940 contains no :61: value lines')
  const parsed: ParsedStatementLine[] = []
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]
    const m = chunk.match(/^:61:(\d{6})(\d{4})?([CD])([A-Z]?)(\d+,\d{0,2})(.*)$/m)
    if (!m) throw new StatementParseError(`MT940 :61: line ${i + 1} not recognized`)
    const yy = m[1].slice(0, 2)
    const mm = m[1].slice(2, 4)
    const dd = m[1].slice(4, 6)
    const year = Number(yy) >= 70 ? `19${yy}` : `20${yy}`
    const statementDate = `${year}-${mm}-${dd}`
    const sign = m[3] === 'D' ? -1 : 1
    const amountMinor = sign * parseAmountToMinor(m[5].replace(',', '.'))
    const refTail = (m[6] || '').trim()
    const memoMatch = chunk.match(/:86:([^\n]+)/)
    const description = (memoMatch?.[1] || refTail || 'MT940 entry').trim()
    const reference = refTail || undefined
    const fp = fingerprint(['mt940', statementDate, amountMinor, description, reference || '', i])
    parsed.push({
      lineIndex: parsed.length,
      statementDate,
      effectiveDate: statementDate,
      amountMinor,
      description,
      ...(reference ? { reference } : {}),
      sourceFingerprint: fp,
      raw: chunk.slice(0, 500),
    })
  }
  return parsed
}

export function parseStatementFile(
  text: string,
  format: StatementFileFormat = 'auto',
): { format: Exclude<StatementFileFormat, 'auto'>; lines: ParsedStatementLine[]; contentDigest: string } {
  if (typeof text !== 'string' || !text.trim()) {
    throw new StatementParseError('Statement file content is required')
  }
  const resolved = format === 'auto' ? detectFormat(text) : format
  let lines: ParsedStatementLine[]
  switch (resolved) {
    case 'csv':
      lines = parseCsv(text)
      break
    case 'ofx':
      lines = parseOfx(text)
      break
    case 'mt940':
      lines = parseMt940(text)
      break
    default:
      throw new StatementParseError(`Unsupported format: ${format}`)
  }
  return {
    format: resolved,
    lines,
    contentDigest: sha256(text),
  }
}
