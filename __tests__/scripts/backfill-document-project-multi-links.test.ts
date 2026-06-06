import {
  buildDocumentArrayMirrorPatch,
  buildProjectArrayMirrorPatch,
  parseFlags,
  runWithDb,
} from '@/scripts/backfill-document-project-multi-links'

describe('backfill-document-project-multi-links helpers', () => {
  it('defaults to dry-run and requires approval details for commit flags', () => {
    expect(parseFlags([])).toEqual({ dryRun: true, batchSize: 300 })
    expect(parseFlags(['--dry-run', '--commit'])).toEqual({ dryRun: false, batchSize: 300 })
    expect(parseFlags([
      '--commit',
      '--approval-task-id', 'approval-task-1',
      '--approval-evidence', 'Peet approved live backfill in task approval-task-1',
      '--org-id', 'client-org',
      '--batch-size', '50',
    ])).toEqual({
      dryRun: false,
      orgId: 'client-org',
      batchSize: 50,
      approvalTaskId: 'approval-task-1',
      approvalEvidence: 'Peet approved live backfill in task approval-task-1',
    })
  })

  it('mirrors document linked scalar fields into matching arrays without dropping existing ids', () => {
    expect(buildDocumentArrayMirrorPatch({
      linked: {
        companyId: 'company-1',
        companyIds: ['company-2'],
        contactId: 'contact-1',
        clientOrgId: 'client-org',
        projectId: 'project-1',
        dealIds: ['deal-1'],
      },
    })).toEqual({
      linked: {
        companyIds: ['company-2', 'company-1'],
        contactIds: ['contact-1'],
        clientOrgIds: ['client-org'],
        projectIds: ['project-1'],
      },
    })
  })

  it('mirrors project scalar fields into matching arrays without dropping existing ids', () => {
    expect(buildProjectArrayMirrorPatch({
      companyId: 'company-1',
      companyIds: ['company-2'],
      contactId: 'contact-1',
      sourceCompanyId: 'source-company-1',
      sourceContactId: 'source-contact-1',
      recipientOrgId: 'recipient-org',
      clientOrgId: 'client-org',
    })).toEqual({
      companyIds: ['company-2', 'company-1'],
      contactIds: ['contact-1'],
      sourceCompanyIds: ['source-company-1'],
      sourceContactIds: ['source-contact-1'],
      recipientOrgIds: ['recipient-org'],
      clientOrgIds: ['client-org'],
    })
  })

  it('returns null when array mirrors already contain all scalar values', () => {
    expect(buildDocumentArrayMirrorPatch({
      linked: { companyId: 'company-1', companyIds: ['company-1'] },
    })).toBeNull()
    expect(buildProjectArrayMirrorPatch({
      contactId: 'contact-1', contactIds: ['contact-1'],
    })).toBeNull()
  })
})

describe('backfill-document-project-multi-links runWithDb', () => {
  function makeDb() {
    const writes: Array<{ ref: unknown; patch: unknown; options: unknown }> = []
    const doc = (collectionName: string, id: string, data: Record<string, unknown>) => ({
      id,
      ref: { collectionName, id },
      data: () => data,
    })
    const collections: Record<string, Array<ReturnType<typeof doc>>> = {
      client_documents: [
        doc('client_documents', 'doc-1', {
          orgId: 'org-1',
          title: 'Proposal',
          linked: { companyId: 'company-1', companyIds: [] },
        }),
      ],
      projects: [
        doc('projects', 'project-1', {
          orgId: 'org-1',
          name: 'Website',
          companyId: 'company-1',
        }),
      ],
    }
    const db = {
      collection: (name: string) => ({
        get: async () => ({ docs: collections[name] ?? [] }),
      }),
      batch: () => ({
        set: (ref: unknown, patch: unknown, options: unknown) => writes.push({ ref, patch, options }),
        commit: jest.fn(async () => undefined),
      }),
    }
    return { db, writes }
  }

  it('dry-run reports candidate documents and projects without writing', async () => {
    const { db, writes } = makeDb()

    const rows = await runWithDb(db as never, { dryRun: true, batchSize: 300 })

    expect(rows).toEqual([
      expect.objectContaining({ collection: 'client_documents', id: 'doc-1', action: 'mirror', fieldPairs: ['companyId->companyIds'] }),
      expect.objectContaining({ collection: 'projects', id: 'project-1', action: 'mirror', fieldPairs: ['companyId->companyIds'] }),
    ])
    expect(writes).toHaveLength(0)
  })

  it('refuses commit mode without explicit approval task id and evidence', async () => {
    const { db, writes } = makeDb()

    await expect(runWithDb(db as never, { dryRun: false, batchSize: 300 }))
      .rejects.toThrow('Commit mode requires --approval-task-id and --approval-evidence')
    expect(writes).toHaveLength(0)
  })
})
