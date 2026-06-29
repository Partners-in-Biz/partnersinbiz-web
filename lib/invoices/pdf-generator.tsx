import React from 'react'
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from '@react-pdf/renderer'
import type { Currency } from './types'

type InvoiceRecord = Record<string, any>

type LineItem = {
  description?: string
  quantity?: number
  unitPrice?: number
  amount?: number
}

function formatCurrency(amount: unknown, currency: Currency): string {
  const value = typeof amount === 'number' && Number.isFinite(amount) ? amount : 0
  const locales: Record<Currency, string> = { USD: 'en-US', EUR: 'de-DE', ZAR: 'en-ZA' }
  return new Intl.NumberFormat(locales[currency] || 'en-US', {
    style: 'currency',
    currency: currency || 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

function formatDate(ts: unknown): string {
  if (!ts) return '—'
  if (typeof ts === 'object' && ts !== null && '_seconds' in ts) {
    return new Date(Number((ts as { _seconds: number })._seconds) * 1000).toLocaleDateString('en-ZA', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
  }
  return new Date(ts as string | number | Date).toLocaleDateString('en-ZA', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

function addressLines(addr: any): string[] {
  if (!addr) return []
  return [addr.line1, addr.line2, addr.city, addr.state, addr.postalCode, addr.country].filter(Boolean)
}

const styles = StyleSheet.create({
  page: { backgroundColor: '#ffffff', color: '#111827', padding: 42, fontSize: 10, fontFamily: 'Helvetica' },
  header: { flexDirection: 'row', justifyContent: 'space-between', borderBottom: '2px solid #f3f4f6', paddingBottom: 22, marginBottom: 28 },
  companyName: { fontSize: 18, fontWeight: 700, marginBottom: 5 },
  muted: { color: '#6b7280', fontSize: 10, lineHeight: 1.45 },
  invoiceMeta: { alignItems: 'flex-end' },
  invoiceNumber: { color: '#059669', fontSize: 26, fontWeight: 700, marginBottom: 10 },
  metaRow: { color: '#6b7280', fontSize: 10, marginBottom: 3 },
  addresses: { flexDirection: 'row', gap: 36, marginBottom: 30 },
  addressBlock: { flex: 1 },
  sectionLabel: { color: '#6b7280', fontSize: 8, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 7 },
  addressName: { color: '#111827', fontSize: 12, fontWeight: 700, marginBottom: 4 },
  tableHeader: { flexDirection: 'row', borderTop: '1px solid #e5e7eb', borderBottom: '1px solid #e5e7eb', paddingVertical: 9 },
  th: { color: '#6b7280', fontSize: 8, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 },
  tableRow: { flexDirection: 'row', borderBottom: '1px solid #f3f4f6', paddingVertical: 10 },
  descriptionCell: { width: '50%', paddingRight: 10 },
  qtyCell: { width: '15%', textAlign: 'center' },
  moneyCell: { width: '17.5%', textAlign: 'right' },
  totalsSection: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 16, marginBottom: 28 },
  totals: { width: 230 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 7, borderBottom: '1px solid #e5e7eb' },
  totalFinal: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderTop: '2px solid #e5e7eb', marginTop: 2 },
  totalLabel: { color: '#6b7280', fontSize: 10 },
  totalAmount: { color: '#059669', fontSize: 13, fontWeight: 700 },
  notes: { borderTop: '1px solid #e5e7eb', paddingTop: 18, marginBottom: 20 },
  banking: { backgroundColor: '#f9fafb', padding: 14, marginBottom: 24 },
  bankingRow: { color: '#374151', fontSize: 9, marginBottom: 4 },
  footer: { borderTop: '1px solid #e5e7eb', paddingTop: 16, color: '#9ca3af', textAlign: 'center', fontSize: 9 },
})

function InvoicePdf({ invoice }: { invoice: InvoiceRecord }) {
  const currency = (invoice.currency || 'USD') as Currency
  const from = invoice.fromDetails ?? { companyName: 'Partners in Biz' }
  const client = invoice.clientDetails ?? { name: invoice.orgId }
  const lineItems = Array.isArray(invoice.lineItems) ? invoice.lineItems as LineItem[] : []

  return (
    <Document title={String(invoice.invoiceNumber || invoice.id || 'Invoice')}>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.companyName}>{from.companyName || 'Partners in Biz'}</Text>
            {from.website ? <Text style={styles.muted}>{from.website}</Text> : null}
            {from.email ? <Text style={styles.muted}>{from.email}</Text> : null}
            {from.phone ? <Text style={styles.muted}>{from.phone}</Text> : null}
            {from.vatNumber ? <Text style={styles.muted}>VAT: {from.vatNumber}</Text> : null}
            {from.registrationNumber ? <Text style={styles.muted}>Reg: {from.registrationNumber}</Text> : null}
          </View>
          <View style={styles.invoiceMeta}>
            <Text style={styles.invoiceNumber}>{invoice.invoiceNumber || invoice.id}</Text>
            <Text style={styles.metaRow}>Issued: {formatDate(invoice.issueDate)}</Text>
            <Text style={styles.metaRow}>Due: {formatDate(invoice.dueDate)}</Text>
          </View>
        </View>

        <View style={styles.addresses}>
          <View style={styles.addressBlock}>
            <Text style={styles.sectionLabel}>From</Text>
            <Text style={styles.addressName}>{from.companyName || 'Partners in Biz'}</Text>
            {addressLines(from.address).map((line, index) => <Text key={`from-${index}`} style={styles.muted}>{line}</Text>)}
          </View>
          <View style={styles.addressBlock}>
            <Text style={styles.sectionLabel}>Bill To</Text>
            <Text style={styles.addressName}>{client.name || invoice.orgId || 'Client'}</Text>
            {addressLines(client.address).map((line, index) => <Text key={`client-${index}`} style={styles.muted}>{line}</Text>)}
            {client.email ? <Text style={styles.muted}>{client.email}</Text> : null}
            {client.vatNumber ? <Text style={styles.muted}>VAT: {client.vatNumber}</Text> : null}
          </View>
        </View>

        <View style={styles.tableHeader}>
          <Text style={[styles.th, styles.descriptionCell]}>Description</Text>
          <Text style={[styles.th, styles.qtyCell]}>Qty</Text>
          <Text style={[styles.th, styles.moneyCell]}>Unit Price</Text>
          <Text style={[styles.th, styles.moneyCell]}>Amount</Text>
        </View>
        {lineItems.map((item, index) => (
          <View key={index} style={styles.tableRow}>
            <Text style={styles.descriptionCell}>{item.description || 'Line item'}</Text>
            <Text style={styles.qtyCell}>{item.quantity ?? 1}</Text>
            <Text style={styles.moneyCell}>{formatCurrency(item.unitPrice, currency)}</Text>
            <Text style={styles.moneyCell}>{formatCurrency(item.amount, currency)}</Text>
          </View>
        ))}

        <View style={styles.totalsSection}>
          <View style={styles.totals}>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Subtotal</Text>
              <Text>{formatCurrency(invoice.subtotal, currency)}</Text>
            </View>
            {invoice.taxRate > 0 ? (
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Tax ({invoice.taxRate}%)</Text>
                <Text>{formatCurrency(invoice.taxAmount, currency)}</Text>
              </View>
            ) : null}
            <View style={styles.totalFinal}>
              <Text>Total</Text>
              <Text style={styles.totalAmount}>{formatCurrency(invoice.total, currency)}</Text>
            </View>
          </View>
        </View>

        {invoice.notes ? (
          <View style={styles.notes}>
            <Text style={styles.sectionLabel}>Notes / Terms</Text>
            <Text style={styles.muted}>{invoice.notes}</Text>
          </View>
        ) : null}

        {from.bankingDetails?.bankName ? (
          <View style={styles.banking}>
            <Text style={styles.sectionLabel}>Banking Details</Text>
            <Text style={styles.bankingRow}>Bank: {from.bankingDetails.bankName}</Text>
            {from.bankingDetails.accountHolder ? <Text style={styles.bankingRow}>Account Holder: {from.bankingDetails.accountHolder}</Text> : null}
            {from.bankingDetails.accountNumber ? <Text style={styles.bankingRow}>Account Number: {from.bankingDetails.accountNumber}</Text> : null}
            {from.bankingDetails.branchCode ? <Text style={styles.bankingRow}>Branch Code: {from.bankingDetails.branchCode}</Text> : null}
            {from.bankingDetails.swiftCode ? <Text style={styles.bankingRow}>SWIFT: {from.bankingDetails.swiftCode}</Text> : null}
            {from.bankingDetails.iban ? <Text style={styles.bankingRow}>IBAN: {from.bankingDetails.iban}</Text> : null}
          </View>
        ) : null}

        <Text style={styles.footer}>{from.companyName || 'Partners in Biz'}</Text>
      </Page>
    </Document>
  )
}

export async function renderInvoicePdf(invoice: InvoiceRecord): Promise<Buffer> {
  return renderToBuffer(<InvoicePdf invoice={invoice} />)
}
