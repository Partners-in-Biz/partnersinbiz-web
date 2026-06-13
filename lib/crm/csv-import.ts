export interface ParsedContactImportRow {
  email: string
  name?: string
  firstName?: string
  lastName?: string
  company?: string
  phone?: string
  tags?: string[]
  notes?: string
}

export function parseCsv(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0

  while (i < src.length) {
    const ch = src[i]

    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i += 1
        continue
      }
      field += ch
      i += 1
      continue
    }

    if (ch === '"') {
      inQuotes = true
      i += 1
      continue
    }
    if (ch === ',') {
      row.push(field)
      field = ''
      i += 1
      continue
    }
    if (ch === '\r' || ch === '\n') {
      row.push(field)
      field = ''
      if (row.length > 1 || row[0] !== '') rows.push(row)
      row = []
      i += ch === '\r' && src[i + 1] === '\n' ? 2 : 1
      continue
    }

    field += ch
    i += 1
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field)
    if (row.length > 1 || row[0] !== '') rows.push(row)
  }

  return rows
}

const HEADER_ALIASES: Record<string, keyof ParsedContactImportRow> = {
  email: 'email',
  'e-mail': 'email',
  name: 'name',
  fullname: 'name',
  'full name': 'name',
  firstname: 'firstName',
  'first name': 'firstName',
  first_name: 'firstName',
  lastname: 'lastName',
  'last name': 'lastName',
  last_name: 'lastName',
  surname: 'lastName',
  company: 'company',
  organization: 'company',
  organisation: 'company',
  phone: 'phone',
  tel: 'phone',
  telephone: 'phone',
  mobile: 'phone',
  tags: 'tags',
  notes: 'notes',
  note: 'notes',
}

export function normalizeContactImportHeader(header: string): keyof ParsedContactImportRow | null {
  const key = header.trim().toLowerCase()
  return HEADER_ALIASES[key] ?? null
}

export function rowsFromCsv(grid: string[][]): ParsedContactImportRow[] {
  if (grid.length === 0) return []
  const header = grid[0]
  const colMap: Array<keyof ParsedContactImportRow | null> = header.map(normalizeContactImportHeader)

  const out: ParsedContactImportRow[] = []
  for (let r = 1; r < grid.length; r += 1) {
    const cols = grid[r]
    if (cols.every((col) => col.trim() === '')) continue
    const row: ParsedContactImportRow = { email: '' }
    for (let c = 0; c < cols.length; c += 1) {
      const key = colMap[c]
      if (!key) continue
      const value = cols[c]
      if (key === 'tags') {
        const tags = value.split(/[,;]/).map((tag) => tag.trim()).filter(Boolean)
        if (tags.length > 0) row.tags = tags
      } else {
        const cleaned = value.trim()
        if (cleaned) (row as unknown as Record<string, unknown>)[key] = cleaned
      }
    }
    out.push(row)
  }
  return out
}
