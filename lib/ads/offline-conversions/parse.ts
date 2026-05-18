// lib/ads/offline-conversions/parse.ts

export interface ParsedConversionRow {
  eventId: string
  eventTimeIso: string
  email?: string
  phone?: string
  value?: number
  currency?: string
  gclid?: string
  ttclid?: string
  liFatId?: string
}

export interface ParseResult {
  rows: ParsedConversionRow[]
  errors: Array<{ line: number; message: string }>
}

/** Parse the CSV text into typed rows. Header row required. Skips malformed rows + records errors. */
export function parseCsv(csvText: string): ParseResult {
  const lines = csvText.split(/\r?\n/).filter((l) => l.length > 0)
  if (lines.length < 2) return { rows: [], errors: [{ line: 0, message: 'CSV has no data rows' }] }

  const header = parseLine(lines[0]).map((h) => h.trim().toLowerCase())
  const requireIdx = (k: string) => {
    const i = header.indexOf(k)
    return i >= 0 ? i : -1
  }
  const idx = {
    event_id: requireIdx('event_id'),
    event_time_iso: requireIdx('event_time_iso'),
    email: requireIdx('email'),
    phone: requireIdx('phone'),
    value: requireIdx('value'),
    currency: requireIdx('currency'),
    gclid: requireIdx('gclid'),
    ttclid: requireIdx('ttclid'),
    li_fat_id: requireIdx('li_fat_id'),
  }
  if (idx.event_id < 0 || idx.event_time_iso < 0) {
    return { rows: [], errors: [{ line: 0, message: 'Missing required columns: event_id, event_time_iso' }] }
  }

  const rows: ParsedConversionRow[] = []
  const errors: Array<{ line: number; message: string }> = []
  for (let i = 1; i < lines.length; i++) {
    const cells = parseLine(lines[i])
    const eventId = cells[idx.event_id]?.trim()
    const eventTime = cells[idx.event_time_iso]?.trim()
    if (!eventId || !eventTime) {
      errors.push({ line: i + 1, message: 'Missing event_id or event_time_iso' })
      continue
    }
    const email = idx.email >= 0 ? cells[idx.email]?.trim() : undefined
    const phone = idx.phone >= 0 ? cells[idx.phone]?.trim() : undefined
    if (!email && !phone) {
      errors.push({ line: i + 1, message: 'Row needs email or phone' })
      continue
    }
    const rawValue = idx.value >= 0 ? cells[idx.value] : undefined
    const value = rawValue !== undefined ? parseFloat(rawValue) : undefined
    rows.push({
      eventId,
      eventTimeIso: eventTime,
      email: email || undefined,
      phone: phone || undefined,
      value: Number.isFinite(value) ? value : undefined,
      currency: idx.currency >= 0 ? cells[idx.currency]?.trim() || undefined : undefined,
      gclid: idx.gclid >= 0 ? cells[idx.gclid]?.trim() || undefined : undefined,
      ttclid: idx.ttclid >= 0 ? cells[idx.ttclid]?.trim() || undefined : undefined,
      liFatId: idx.li_fat_id >= 0 ? cells[idx.li_fat_id]?.trim() || undefined : undefined,
    })
  }
  return { rows, errors }
}

/** Minimal CSV line parser handling quoted commas. Sufficient for our schema. */
function parseLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"' && line[i + 1] === '"') {
      cur += '"'
      i++
    } else if (c === '"') {
      inQuotes = !inQuotes
    } else if (c === ',' && !inQuotes) {
      out.push(cur)
      cur = ''
    } else {
      cur += c
    }
  }
  out.push(cur)
  return out
}
