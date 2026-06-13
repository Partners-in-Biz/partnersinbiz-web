import {
  invoicePortalCapabilities,
  sanitizeInvoicePortalPatch,
  quotePortalCapabilities,
  sanitizeQuotePortalPatch,
} from '@/lib/billing/portal-permissions'

describe('portal billing permissions', () => {
  const actor = { uid: 'member-1', role: 'client' as const }

  it('allows the creator of a draft invoice to edit draft fields and send it, but blocks generic paid patches', () => {
    const invoice = { status: 'draft', createdByRef: { uid: 'member-1' } }

    expect(invoicePortalCapabilities(actor, invoice)).toMatchObject({
      canEdit: true,
      canSend: true,
      canCancel: true,
      canMarkPaid: false,
    })

    expect(sanitizeInvoicePortalPatch(actor, invoice, {
      dueDate: '2026-07-01',
      notes: 'Updated note',
      lineItems: [{ description: 'Build', quantity: 2, unitPrice: 500 }],
      status: 'paid',
      paidAt: 'malicious',
    })).toEqual({
      ok: true,
      patch: {
        dueDate: '2026-07-01',
        notes: 'Updated note',
        lineItems: [{ description: 'Build', quantity: 2, unitPrice: 500 }],
      },
    })

    expect(sanitizeInvoicePortalPatch(actor, invoice, { status: 'paid' })).toMatchObject({
      ok: false,
      status: 403,
    })
  })

  it('locks non-draft invoice commercial edits for draft creators', () => {
    const invoice = { status: 'sent', createdByRef: { uid: 'member-1' } }

    expect(invoicePortalCapabilities(actor, invoice)).toMatchObject({
      canEdit: false,
      canSend: false,
      canMarkPaid: false,
    })
    expect(sanitizeInvoicePortalPatch(actor, invoice, { notes: 'late edit' })).toMatchObject({
      ok: false,
      status: 403,
    })
  })

  it('allows sender-side draft quote editing and sending, while recipient users may only accept or decline sent quotes', () => {
    const senderQuote = { status: 'draft' }
    expect(quotePortalCapabilities('sender', senderQuote)).toMatchObject({
      canEdit: true,
      canSend: true,
      canAccept: false,
      canDecline: false,
    })
    expect(sanitizeQuotePortalPatch('sender', senderQuote, {
      validUntil: '2026-07-15',
      notes: 'updated',
      lineItems: [{ description: 'Audit', quantity: 1, unitPrice: 750 }],
      status: 'accepted',
    })).toEqual({
      ok: true,
      patch: {
        validUntil: '2026-07-15',
        notes: 'updated',
        lineItems: [{ description: 'Audit', quantity: 1, unitPrice: 750 }],
      },
    })

    const receivedQuote = { status: 'sent' }
    expect(quotePortalCapabilities('recipient', receivedQuote)).toMatchObject({
      canEdit: false,
      canAccept: true,
      canDecline: true,
    })
    expect(sanitizeQuotePortalPatch('recipient', receivedQuote, { status: 'accepted' })).toEqual({
      ok: true,
      patch: { status: 'accepted' },
    })
    expect(sanitizeQuotePortalPatch('recipient', receivedQuote, { notes: 'change terms' })).toMatchObject({
      ok: false,
      status: 403,
    })
  })
})
