import { canEditInvoiceDraft, decorateInvoiceEditCapability } from '@/lib/invoices/permissions'

describe('invoice edit permissions', () => {
  it('allows the creator of a draft invoice to edit it', () => {
    expect(canEditInvoiceDraft({ uid: 'user-1', role: 'client' }, { status: 'draft', createdBy: 'user-1' })).toBe(true)
    expect(canEditInvoiceDraft({ uid: 'user-1', role: 'client' }, { status: 'draft', createdByRef: { uid: 'user-1' } })).toBe(true)
  })

  it('does not allow clients to edit another creator or a non-draft invoice', () => {
    expect(canEditInvoiceDraft({ uid: 'user-1', role: 'client' }, { status: 'draft', createdBy: 'user-2' })).toBe(false)
    expect(canEditInvoiceDraft({ uid: 'user-1', role: 'client' }, { status: 'sent', createdBy: 'user-1' })).toBe(false)
  })

  it('decorates invoices with edit capability for UI rows', () => {
    expect(decorateInvoiceEditCapability({ id: 'invoice-1', status: 'draft', createdBy: 'user-1' }, { uid: 'user-1', role: 'client' })).toMatchObject({
      id: 'invoice-1',
      canEdit: true,
    })
  })
})
