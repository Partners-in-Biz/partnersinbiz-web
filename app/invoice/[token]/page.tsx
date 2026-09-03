import { notFound } from 'next/navigation'
import { adminDb } from '@/lib/firebase/admin'
import { buildPaymentInstructions } from '@/lib/payments/eft'
import '@/components/studio/studio-ui.css'

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
  if (!value) return 'n/a'
  const candidate = value as { _seconds?: number; seconds?: number; toDate?: () => Date }
  if (typeof candidate.toDate === 'function') return candidate.toDate().toLocaleDateString('en-ZA')
  const seconds = candidate._seconds ?? candidate.seconds
  if (typeof seconds === 'number') return new Date(seconds * 1000).toLocaleDateString('en-ZA')
  const parsed = new Date(value as string)
  return Number.isNaN(parsed.getTime()) ? 'n/a' : parsed.toLocaleDateString('en-ZA')
}

function statusTone(status?: string): 'success' | 'warning' | 'danger' | 'info' {
  const value = (status ?? 'sent').toLowerCase()
  if (value === 'paid') return 'success'
  if (value === 'overdue' || value === 'void' || value === 'cancelled') return 'danger'
  if (value === 'draft') return 'info'
  return 'warning'
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
  const currency = invoice.currency ?? 'ZAR'
  const lineItems = invoice.lineItems ?? []
  const statusLabel = invoice.status ?? 'sent'
  const tone = statusTone(statusLabel)

  return (
    <main className="mx-auto max-w-4xl px-8 py-16">
      <header className="pib-page-header">
        <p className="sc-tiny">Public invoice</p>
        <h1 className="sc-article__h2 mt-2">{invoice.invoiceNumber ?? doc.id}</h1>
        <p className="sc-body mt-2">{invoice.fromDetails?.companyName ?? 'Partners in Biz'}.</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className={`st-status sc-tiny st-status--${tone}`}>{statusLabel}</span>
          <span className="sc-tiny">Due {formatDate(invoice.dueDate)}</span>
        </div>
      </header>

      <div className="mt-8 grid gap-8 lg:grid-cols-[1.5fr_1fr]">
        <section className="st-panel">
          <p className="sc-tiny">Bill to</p>
          <p className="st-title mt-2">{invoice.clientDetails?.name ?? 'Client'}</p>
          {invoice.fromDetails?.vatNumber ? (
            <p className="sc-body mt-2">{invoice.fromDetails.vatNumber}</p>
          ) : null}

          <div className="mt-8">
            {lineItems.length ? (
              <table className="st-table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Qty</th>
                    <th>Unit</th>
                    <th className="text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {lineItems.map((item, index) => (
                    <tr key={`${item.description ?? 'item'}-${index}`}>
                      <td>{item.description ?? 'Invoice item'}</td>
                      <td className="st-num">{item.quantity ?? 1}</td>
                      <td className="st-num">{formatCurrency(item.unitPrice ?? 0, currency)}</td>
                      <td className="st-num text-right">{formatCurrency(item.amount ?? 0, currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="st-notice sc-body" role="status">No line items on this invoice.</div>
            )}
          </div>

          {invoice.notes ? (
            <div className="mt-8">
              <div className="st-notice sc-body" role="status">
                <strong>Notes</strong>
                <span>{invoice.notes}</span>
              </div>
            </div>
          ) : null}
        </section>

        <div className="flex flex-col gap-8">
          <section className="st-panel">
            <p className="sc-tiny">Total due</p>
            <dl className="st-datalist mt-4">
              <div className="st-datalist__item">
                <dt className="sc-tiny">Subtotal</dt>
                <dd className="st-num">{formatCurrency(invoice.subtotal ?? 0, currency)}</dd>
              </div>
              {(invoice.taxRate ?? 0) > 0 ? (
                <div className="st-datalist__item">
                  <dt className="sc-tiny">{taxLabel} ({invoice.taxRate}%)</dt>
                  <dd className="st-num">{formatCurrency(invoice.taxAmount ?? 0, currency)}</dd>
                </div>
              ) : null}
              <div className="st-datalist__item">
                <dt className="sc-tiny">Total</dt>
                <dd className="st-num">{formatCurrency(invoice.total ?? 0, currency)}</dd>
              </div>
            </dl>
          </section>

          <section className="st-panel">
            <p className="sc-tiny">EFT details</p>
            <dl className="st-datalist mt-4">
              <div className="st-datalist__item">
                <dt className="sc-tiny">Bank</dt>
                <dd>{instructions.eft.bankingDetails.bankName ?? 'n/a'}</dd>
              </div>
              <div className="st-datalist__item">
                <dt className="sc-tiny">Account name</dt>
                <dd>{instructions.eft.bankingDetails.accountName ?? 'n/a'}</dd>
              </div>
              <div className="st-datalist__item">
                <dt className="sc-tiny">Account number</dt>
                <dd>{instructions.eft.bankingDetails.accountNumber ?? 'n/a'}</dd>
              </div>
              <div className="st-datalist__item">
                <dt className="sc-tiny">Branch code</dt>
                <dd>{instructions.eft.bankingDetails.branchCode ?? 'n/a'}</dd>
              </div>
              <div className="st-datalist__item">
                <dt className="sc-tiny">Reference</dt>
                <dd>{instructions.eft.reference}</dd>
              </div>
            </dl>
            <p className="sc-body mt-4">
              Send proof to {instructions.eft.proofOfPaymentEmail}.
            </p>
          </section>
        </div>
      </div>
    </main>
  )
}
