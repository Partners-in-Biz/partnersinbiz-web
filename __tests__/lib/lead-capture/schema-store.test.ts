import { loadCaptureSchemaVersion, publishCaptureSchemaVersion } from '@/lib/lead-capture/schema-store'

function harness(existing?: Record<string, unknown>) {
  const versionRef = { path: 'lead_capture_schema_versions/source_schema' }
  const sourceRef = { path: 'lead_capture_sources/source' }
  const transaction = {
    get: jest.fn().mockResolvedValue({ exists: !!existing, data: () => existing }),
    create: jest.fn(),
    update: jest.fn(),
  }
  const db = {
    collection: jest.fn(() => ({ doc: jest.fn(() => versionRef) })),
    runTransaction: jest.fn(async (fn: (tx: typeof transaction) => unknown) => fn(transaction)),
  }
  return { db, transaction, sourceRef }
}

const input = {
  orgId: 'org-1', sourceId: 'source-1',
  fields: [{ key: 'name', label: 'Name', type: 'text' as const, required: false }],
  display: { mode: 'multi-step' as const, steps: [{ headingText: '', subheadingText: '', fields: ['name'], buttonText: 'Done' }] },
}

describe('capture schema publisher', () => {
  it('creates an immutable version and switches the active pointer in one transaction', async () => {
    const { db, transaction, sourceRef } = harness()
    const result = await publishCaptureSchemaVersion(db as never, sourceRef as never, input)
    expect(db.runTransaction).toHaveBeenCalledTimes(1)
    expect(transaction.create).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      id: result.id, orgId: 'org-1', captureSourceId: 'source-1', fields: input.fields,
      display: input.display,
    }))
    expect(transaction.update).toHaveBeenCalledWith(sourceRef, { activeSchemaVersionId: result.id })
  })

  it('accepts an identical existing version without overwriting it', async () => {
    const { db, transaction, sourceRef } = harness({
      id: 'placeholder', orgId: 'org-1', captureSourceId: 'source-1', fields: input.fields,
      display: input.display,
    })
    await publishCaptureSchemaVersion(db as never, sourceRef as never, input)
    expect(transaction.create).not.toHaveBeenCalled()
    expect(transaction.update).toHaveBeenCalledWith(sourceRef, expect.anything())
  })

  it('rejects a fingerprint collision instead of mutating immutable history', async () => {
    const { db, transaction, sourceRef } = harness({
      orgId: 'other-org', captureSourceId: 'source-1', fields: input.fields,
    })
    await expect(publishCaptureSchemaVersion(db as never, sourceRef as never, input))
      .rejects.toThrow('immutable schema version collision')
    expect(transaction.create).not.toHaveBeenCalled()
    expect(transaction.update).not.toHaveBeenCalled()
  })

  it('loads only an exact source-scoped immutable version', async () => {
    const version = { orgId: 'org-1', captureSourceId: 'source-1', fields: input.fields, display: input.display }
    const published = await publishCaptureSchemaVersion(harness().db as never, harness().sourceRef as never, input)
    const get = jest.fn().mockResolvedValue({ exists: true, data: () => version })
    const db = { collection: jest.fn(() => ({ doc: jest.fn(() => ({ get })) })) }
    await expect(loadCaptureSchemaVersion(db as never, 'source-1', published.id))
      .resolves.toMatchObject(version)
    await expect(loadCaptureSchemaVersion(db as never, 'other-source', published.id))
      .rejects.toThrow('does not belong')
  })
})
