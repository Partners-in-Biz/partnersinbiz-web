import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { generateInvoicePdfShareToken } from '@/lib/invoices/share-token'

export function buildInvoicePdfShareTokenPatch(invoice: Record<string, unknown>): Record<string, unknown> | null {
  if (typeof invoice.pdfShareToken === 'string' && invoice.pdfShareToken.trim()) {
    return null
  }

  return {
    pdfShareToken: generateInvoicePdfShareToken(),
  }
}

export async function backfillInvoicePdfShareTokens(): Promise<{ scanned: number; updated: number }> {
  const snap = await adminDb.collection('invoices').get()
  let scanned = 0
  let updated = 0

  for (const doc of snap.docs) {
    scanned += 1
    const patch = buildInvoicePdfShareTokenPatch(doc.data() ?? {})
    if (!patch) continue

    await doc.ref.update({
      ...patch,
      updatedAt: FieldValue.serverTimestamp(),
    })
    updated += 1
  }

  return { scanned, updated }
}

async function main() {
  const result = await backfillInvoicePdfShareTokens()
  console.log(`Backfilled invoice PDF share tokens: ${result.updated}/${result.scanned}`)
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
