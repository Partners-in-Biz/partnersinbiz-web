import { notFound } from 'next/navigation'
import { adminDb } from '@/lib/firebase/admin'
import { buildPaymentInstructions } from '@/lib/payments/eft'

export const dynamic = 'force-dynamic'

type PageParams = { params: Promise<{ token: string }> }

type InvoiceRecord = {
  invoiceNumber?: string
  status?: string
  currency?: string
  total?: number
  subtotal?: number
  taxRate?: number
  taxAmount?: number
  dueDate?: unknown
  lineItems?: Array<{ description?: string; quantity?: number; unitPrice?: number; amount?: number }>
  notes?: string
  clientDetails?: { name?: string }
  fromDetails?: { companyName?: string; vatNumber?: string }
  publicToken?: string
}

function formatCurrency(amount = 0, currency = 'ZAR') {
  return new Intl.NumberFormat('en-ZA', { style: 'currency', currency }).format(amount)
}

function formatDate(value: unknown) {
  if (!value) return '—'
  const candidate = value as { _seconds?: number; seconds?: number; toDate?: () => Date }
  if (typeof candidate.toDate === 'function') return candidate.toDate().toLocaleDateString('en-ZA')
  const seconds = candidate._seconds ?? candidate.seconds
  if (typeof seconds === 'number') return new Date(seconds * 1000).toLocaleDateString('en-ZA')
  const parsed = new Date(value as string)
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleDateString('en-ZA')
}

export async function generateMetadata({ params }: PageParams) {
  const { token } = await params
  const snap = await adminDb.collection('invoices').where('publicToken', '==', token).limit(1).get()
  if (snap.empty) return { title: 'Invoice not found' }
  const invoice = (snap.docs[0].data() ?? {}) as InvoiceRecord
  return {
    title: invoice.invoiceNumber ? `${invoice.invoiceNumber} | Partners in Biz` : 'Invoice | Partners in Biz',
    robots: { index: false, follow: false },
  }
}

export default async function PublicInvoicePage({ params }: PageParams) {
  const { token } = await params
  const invoiceSnap = await adminDb.collection('invoices').where('publicToken', '==', token).limit(1).get()
  if (invoiceSnap.empty) notFound()

  const doc = invoiceSnap.docs[0]
  const invoice = (doc.data() ?? {}) as InvoiceRecord

  const platformSnap = await adminDb
    .collection('organizations')
    .where('type', '==', 'platform_owner')
    .limit(1)
    .get()
  const platformOrg = platformSnap.empty ? null : platformSnap.docs[0].data()

  const instructions = buildPaymentInstructions(
    {
      id: doc.id,
      invoiceNumber: invoice.invoiceNumber ?? doc.id,
      total: invoice.total ?? 0,
      currency: invoice.currency ?? 'ZAR',
      dueDate: invoice.dueDate as Date | { toDate?: () => Date; _seconds?: number } | null | undefined,
      publicToken: invoice.publicToken ?? token,
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    platformOrg as any,
  )

  const taxLabel = invoice.currency === 'ZAR' ? 'VAT' : 'Tax'

  return (
    <main className="min-h-screen bg-[#0a0a0b] px-4 py-12 text-[#ededed]">
      <div className="mx-auto max-w-4xl space-y-6">
        <section className="rounded-lg border border-white/10 bg-white/[0.03] p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-white/55">Public invoice</p>
              <h1 className="mt-3 text-3xl font-semibold">{invoice.invoiceNumber ?? doc.id}</h1>
              <p className="mt-2 text-sm text-white/70">{invoice.fromDetails?.companyName ?? 'Partners in Biz'}</p>
              {invoice.fromDetails?.vatNumber ? (
                <p className="mt-1 text-sm text-white/60">{invoice.fromDetails.vatNumber}</p>
              ) : null}
            </div>
            <div className="rounded-lg border border-white/10 bg-black/20 px-4 py-3 text-sm">
              <p>Status: {invoice.status ?? 'sent'}</p>
              <p className="mt-1">Due: {formatDate(invoice.dueDate)}</p>
            </div>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
          <div className="rounded-lg border border-white/10 bg-white/[0.03] p-6">
            <p className="text-xs uppercase tracking-[0.3em] text-white/55">Bill to</p>
            <p className="mt-3 text-lg">{invoice.clientDetails?.name ?? 'Client'}</p>

            <div className="mt-6 space-y-3">
              {(invoice.lineItems ?? []).map((item, index) => (
                <div key={`${item.description ?? 'item'}-${index}`} className="rounded-lg border border-white/10 bg-black/20 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{item.description ?? 'Invoice item'}</p>
                      <p className="mt-1 text-sm text-white/60">
                        Qty {item.quantity ?? 1} x {formatCurrency(item.unitPrice ?? 0, invoice.currency ?? 'ZAR')}
                      </p>
                    </div>
                    <p className="font-medium">{formatCurrency(item.amount ?? 0, invoice.currency ?? 'ZAR')}</p>
                  </div>
                </div>
              ))}
            </div>

            {invoice.notes ? (
              <div className="mt-6 rounded-lg border border-white/10 bg-black/20 p-4 text-sm text-white/75">
                {invoice.notes}
              </div>
            ) : null}
          </div>

          <div className="space-y-6">
            <section className="rounded-lg border border-white/10 bg-white/[0.03] p-6">
              <p className="text-xs uppercase tracking-[0.3em] text-white/55">Total due</p>
              <div className="mt-4 space-y-2 text-sm text-white/75">
                <div className="flex items-center justify-between">
                  <span>Subtotal</span>
                  <span>{formatCurrency(invoice.subtotal ?? 0, invoice.currency ?? 'ZAR')}</span>
                </div>
                {(invoice.taxRate ?? 0) > 0 ? (
                  <div className="flex items-center justify-between">
                    <span>{taxLabel} ({invoice.taxRate}%)</span>
                    <span>{formatCurrency(invoice.taxAmount ?? 0, invoice.currency ?? 'ZAR')}</span>
                  </div>
                ) : null}
                <div className="flex items-center justify-between border-t border-white/10 pt-3 text-base font-semibold text-white">
                  <span>Total</span>
                  <span>{formatCurrency(invoice.total ?? 0, invoice.currency ?? 'ZAR')}</span>
                </div>
              </div>
            </section>

            <section className="rounded-lg border border-white/10 bg-white/[0.03] p-6">
              <p className="text-xs uppercase tracking-[0.3em] text-white/55">EFT details</p>
              <dl className="mt-4 space-y-2 text-sm text-white/75">
                <div className="flex items-center justify-between gap-3">
                  <dt>Bank</dt>
                  <dd>{instructions.eft.bankingDetails.bankName ?? '—'}</dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt>Account name</dt>
                  <dd>{instructions.eft.bankingDetails.accountName ?? '—'}</dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt>Account number</dt>
                  <dd>{instructions.eft.bankingDetails.accountNumber ?? '—'}</dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt>Branch code</dt>
                  <dd>{instructions.eft.bankingDetails.branchCode ?? '—'}</dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt>Reference</dt>
                  <dd>{instructions.eft.reference}</dd>
                </div>
              </dl>
              <p className="mt-4 text-sm text-white/60">
                Send proof to {instructions.eft.proofOfPaymentEmail}.
              </p>
            </section>
          </div>
        </section>
      </div>
    </main>
  )
}
