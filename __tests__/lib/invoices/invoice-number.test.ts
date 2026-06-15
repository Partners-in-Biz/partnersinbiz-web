const mockCollection = jest.fn()
const mockRunTransaction = jest.fn()
const mockCounterSet = jest.fn()
const mockCounterGet = jest.fn()
const mockInvoiceGet = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: mockCollection,
    runTransaction: mockRunTransaction,
  },
}))

type CounterSnap = { exists: boolean; data: () => { count?: number } }
type InvoiceDoc = { data: () => { invoiceNumber?: string } }

function counterSnap(count?: number): CounterSnap {
  return {
    exists: typeof count === 'number',
    data: () => ({ count }),
  }
}

function invoiceDoc(invoiceNumber: string): InvoiceDoc {
  return { data: () => ({ invoiceNumber }) }
}

function installFirestoreMocks({
  globalCounterCount,
  prefixCounterCount,
  invoiceNumbers = [],
}: {
  globalCounterCount?: number
  prefixCounterCount?: number
  invoiceNumbers?: string[]
}) {
  mockCollection.mockImplementation((name: string) => {
    if (name === 'organizations') {
      return {
        doc: (orgId: string) => ({
          id: orgId,
          collection: (subcollection: string) => {
            expect(subcollection).toBe('counters')
            return {
              doc: (counterId: string) => ({ kind: 'counter', counterId, get: mockCounterGet }),
            }
          },
        }),
      }
    }

    if (name === 'invoices') {
      return {
        kind: 'invoiceCollection',
        where: (field: string, operator: string, value: string) => ({
          kind: 'invoiceQuery',
          field,
          operator,
          value,
          get: mockInvoiceGet,
        }),
      }
    }

    throw new Error(`Unexpected collection: ${name}`)
  })

  const readCounter = (counterId: string) => {
    if (counterId === 'invoices') return Promise.resolve(counterSnap(globalCounterCount))
    if (counterId === 'invoices_COU') return Promise.resolve(counterSnap(prefixCounterCount))
    return Promise.resolve(counterSnap())
  }

  mockCounterGet.mockImplementation(function getCounter(this: { counterId?: string }) {
    return readCounter(this.counterId ?? '')
  })
  mockInvoiceGet.mockResolvedValue({
    docs: invoiceNumbers.map(invoiceDoc),
  })
  mockRunTransaction.mockImplementation(async (callback) => callback({
    get: (target: { kind?: string; counterId?: string }) => {
      if (target.kind === 'counter') return readCounter(target.counterId ?? '')
      if (target.kind === 'invoiceQuery') {
        return Promise.resolve({
          docs: invoiceNumbers.map(invoiceDoc),
        })
      }
      throw new Error(`Unexpected transaction target: ${target.kind}`)
    },
    set: mockCounterSet,
  }))
}

describe('invoice number generation', () => {
  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()
  })

  it('starts a client prefix at 001 even when the old org-wide counter is higher', async () => {
    installFirestoreMocks({
      globalCounterCount: 2,
      invoiceNumbers: ['ELE-001', 'AHS-002'],
    })
    const { generateInvoiceNumber } = await import('@/lib/invoices/invoice-number')

    await expect(generateInvoiceNumber('pib-platform-owner', 'Course Digs')).resolves.toBe('COU-001')
    expect(mockCounterSet).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'counter', counterId: 'invoices_COU' }),
      { count: 1, prefix: 'COU' },
      { merge: true },
    )
  })

  it('continues from the highest existing invoice with the same prefix when the prefix counter is missing', async () => {
    installFirestoreMocks({
      invoiceNumbers: ['COU-001', 'AHS-002', 'COU-003', 'COU-DRAFT'],
    })
    const { generateInvoiceNumber } = await import('@/lib/invoices/invoice-number')

    await expect(generateInvoiceNumber('pib-platform-owner', 'Course Digs')).resolves.toBe('COU-004')
  })

  it('previews the next prefix-specific invoice number without incrementing the counter', async () => {
    installFirestoreMocks({
      invoiceNumbers: ['COU-001', 'COU-002', 'ELE-003'],
    })
    const { previewNextInvoiceNumber } = await import('@/lib/invoices/invoice-number')

    await expect(previewNextInvoiceNumber('pib-platform-owner', 'Course Digs')).resolves.toBe('COU-003')
    expect(mockCounterSet).not.toHaveBeenCalled()
  })
})
