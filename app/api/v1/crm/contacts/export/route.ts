/**
 * GET /api/v1/crm/contacts/export — download all contacts for the org as CSV
 *
 * Auth: viewer+
 * Returns: text/csv attachment
 */
import { NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withCrmAuth } from '@/lib/auth/crm-middleware'
import { apiError } from '@/lib/api/response'
import type { Contact } from '@/lib/crm/types'

export const dynamic = 'force-dynamic'

function fmtTimestampValue(value: unknown): string {
  if (!value) return ''
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'string') return value
  if (typeof value === 'object' && value !== null) {
    const candidate = value as {
      toDate?: () => Date
      toMillis?: () => number
      seconds?: number
    }
    if (typeof candidate.toDate === 'function') return candidate.toDate().toISOString()
    if (typeof candidate.toMillis === 'function')
      return new Date(candidate.toMillis()).toISOString()
    if (typeof candidate.seconds === 'number')
      return new Date(candidate.seconds * 1000).toISOString()
  }
  return String(value)
}

function escapeCsvField(value: string): string {
  // Wrap in quotes if the value contains a comma, double-quote, or newline.
  // Escape any internal double-quotes by doubling them.
  if (value.includes('"') || value.includes(',') || value.includes('\n') || value.includes('\r')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

function toStr(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value)
}

export const GET = withCrmAuth('viewer', async (_req, ctx) => {
  const { orgId } = ctx

  const snapshot = await adminDb
    .collection('contacts')
    .where('orgId', '==', orgId)
    .get()

  const contacts: Contact[] = snapshot.docs
    .map((doc): Contact => ({ ...(doc.data() as Contact), id: doc.id }))
    .filter((c: Contact) => c.orgId === orgId && c.deleted !== true)

  if (contacts.length === 0) {
    return apiError('No contacts found for this organisation', 404)
  }

  const header = ['id', 'name', 'email', 'phone', 'company', 'createdAt']
  const rows: string[] = [header.join(',')]

  for (const contact of contacts) {
    const row = [
      escapeCsvField(toStr(contact.id)),
      escapeCsvField(toStr(contact.name)),
      escapeCsvField(toStr(contact.email)),
      escapeCsvField(toStr(contact.phone)),
      escapeCsvField(toStr(contact.company ?? contact.companyName)),
      escapeCsvField(fmtTimestampValue(contact.createdAt)),
    ]
    rows.push(row.join(','))
  }

  const csvContent = rows.join('\r\n')

  return new NextResponse(csvContent, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="contacts.csv"',
    },
  })
})
