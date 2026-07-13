import { buildBookStudioProjectModel } from '@/lib/chat-context/adapters/bookStudio'
import type { BookStudioRecord } from '@/lib/book-studio/types'

const project: BookStudioRecord & { id: string } = {
  id: 'book-1', orgId: 'org-1', title: 'A Better Book', lifecycleState: 'assembled',
  status: 'internal_review', nextAction: 'Approve the production files', deleted: false,
  reviewStatus: 'client_review',
  gates: [{ id: 'release', label: 'Release approval', status: 'block' }],
  rightsLedger: { status: 'cleared' },
  reviewPackets: [{ id: 'packet-1', title: 'KDP packet', status: 'ready_for_human_review' }],
  packageManifest: { status: 'generated', qaStatus: 'pending_review', version: 3, files: [
    { role: 'interior_pdf', label: 'Interior PDF', href: 'https://files.test/interior.pdf' },
    { role: 'cover_pdf', label: 'Cover PDF', href: 'https://files.test/cover.pdf' },
    { role: 'epub', label: 'EPUB', href: 'https://files.test/book.epub' },
  ] },
}

describe('Book Studio chat context mapping', () => {
  it('surfaces lifecycle, content, assembly outputs, gates, packet, and exact links', () => {
    const model = buildBookStudioProjectModel({
      project,
      chapters: [{ id: 'ch-1', orgId: 'org-1', projectId: 'book-1', title: 'Opening', status: 'approved' }],
      pages: [{ id: 'page-1', orgId: 'org-1', projectId: 'book-1', title: 'Cover', kind: 'illustration', status: 'edited' } as any],
      rightsLedgers: [], publishingPackets: [],
      capabilities: { canView: true, canCreate: true, canEdit: true, canEvidenceRights: true, canApprovalGates: true, canPublishingPackets: true, canArchiveDelete: false, isOperator: false },
      role: 'client',
    })
    expect(model.context.href).toBe('/portal/book-studio/book-1')
    expect(model.pulse).toEqual(expect.objectContaining({ label: 'Assembled', progress: { complete: 3, total: 9 }, next: expect.objectContaining({ label: 'Approve the production files' }) }))
    expect(model.groups).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'chapters', items: [expect.objectContaining({ label: 'Opening', state: 'complete', href: '/portal/book-studio/book-1?orgId=org-1&tab=content#chapter-ch-1' })] }),
      expect.objectContaining({ id: 'pages', items: [expect.objectContaining({ label: 'Cover', href: '/portal/book-studio/book-1?orgId=org-1&tab=content#page-page-1' })] }),
      expect.objectContaining({ id: 'governance', items: expect.arrayContaining([
        expect.objectContaining({ id: 'rights', state: 'complete', href: '/portal/book-studio/book-1?orgId=org-1&tab=metadata' }),
        expect.objectContaining({ id: 'gate:release', state: 'blocked' }),
        expect.objectContaining({ id: 'review-status', state: 'review' }),
        expect.objectContaining({ id: 'qa', state: 'review' }),
      ]) }),
    ]))
    expect(model.artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ resourceType: 'interior_pdf', preview: { kind: 'document', url: 'https://files.test/interior.pdf' }, version: '3' }),
      expect.objectContaining({ resourceType: 'cover_pdf' }), expect.objectContaining({ resourceType: 'epub' }),
      expect.objectContaining({ resourceType: 'publishing_packet', resourceId: 'packet-1', href: '/portal/book-studio/book-1?orgId=org-1&tab=assembly' }),
    ]))
    expect(model.artifacts.find((item) => item.resourceType === 'project')?.actions).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'assemble', href: '/api/v1/book-studio/projects/book-1/assemble', method: 'POST' }),
    ]))
    const operator = buildBookStudioProjectModel({ ...{
      project, chapters: [], pages: [], rightsLedgers: [], publishingPackets: [], role: 'admin' as const,
      capabilities: { canView: true, canCreate: true, canEdit: true, canEvidenceRights: true, canApprovalGates: true, canPublishingPackets: true, canArchiveDelete: true, isOperator: true },
    } })
    expect(operator.artifacts.find((item) => item.resourceType === 'project')?.actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'assemble', href: '/api/v1/book-studio/projects/book-1/assemble?orgId=org-1', method: 'POST', body: { orgId: 'org-1' } }),
      expect.objectContaining({ id: 'open-in-canvas', href: '/api/v1/book-studio/projects/book-1/open-in-canvas?orgId=org-1', method: 'POST', body: { orgId: 'org-1' } }),
    ]))
    expect(operator.artifacts.find((item) => item.resourceType === 'project')?.actions.some((action) => action.id === 'transition')).toBe(false)
    expect(model.pulse.metrics).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'assembly', value: 'Generated' }),
      expect.objectContaining({ id: 'review', value: 'Client review' }),
    ]))
    expect(model.artifacts.find((item) => item.resourceType === 'interior_pdf')?.review).toEqual({ required: true, status: 'pending_review' })
  })

  it('applies portal capabilities to records and mutations', () => {
    const model = buildBookStudioProjectModel({ project, chapters: [], pages: [], rightsLedgers: [], publishingPackets: [{ id: 'private-packet', orgId: 'org-1', projectId: 'book-1', title: 'Private' }], capabilities: {
      canView: true, canCreate: false, canEdit: false, canEvidenceRights: false, canApprovalGates: false, canPublishingPackets: false, canArchiveDelete: false, isOperator: false,
    }, role: 'client' })
    expect(model.artifacts.some((item) => item.resourceType === 'publishing_packet')).toBe(false)
    expect(model.artifacts.flatMap((item) => item.actions).every((action) => !action.method)).toBe(true)
    expect(model.capabilities).toEqual(['view'])
    expect(JSON.stringify(model)).not.toContain('Release approval')
    expect(JSON.stringify(model)).not.toContain('client_review')
    expect(JSON.stringify(model)).not.toContain('cleared')

    const editor = buildBookStudioProjectModel({ project: { ...project, lifecycleState: 'draft' }, chapters: [], pages: [], rightsLedgers: [], publishingPackets: [], capabilities: {
      canView: true, canCreate: false, canEdit: true, canEvidenceRights: false, canApprovalGates: true, canPublishingPackets: false, canArchiveDelete: false, isOperator: false,
    }, role: 'client' })
    expect(editor.artifacts.find((item) => item.resourceType === 'project')?.actions.some((action) => action.id === 'transition')).toBe(false)
  })

  it('uses permitted collection rights as fallback and hides unsafe mutations until guards pass', () => {
    const caps = { canView: true, canCreate: true, canEdit: true, canEvidenceRights: true, canApprovalGates: true, canPublishingPackets: true, canArchiveDelete: true, isOperator: true }
    const fallback = buildBookStudioProjectModel({ project: { ...project, lifecycleState: 'content_complete', rightsLedger: undefined }, chapters: [], pages: [], rightsLedgers: [{ id: 'rights-2', orgId: 'org-1', projectId: 'book-1', status: 'licensed' } as any], publishingPackets: [], capabilities: caps, role: 'admin' })
    expect(fallback.groups.find((group) => group.id === 'governance')?.items).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'rights:rights-2', state: 'complete' })]))
    expect(fallback.artifacts.find((item) => item.resourceType === 'project')?.actions.some((action) => action.id === 'assemble')).toBe(false)
    expect(fallback.artifacts.find((item) => item.resourceType === 'project')?.actions.some((action) => action.id === 'transition')).toBe(false)

    const eligible = buildBookStudioProjectModel({ project: { ...project, packageManifest: { ...(project.packageManifest as object), qaStatus: 'approved' } }, chapters: [], pages: [], rightsLedgers: [], publishingPackets: [], capabilities: caps, role: 'admin' })
    expect(eligible.artifacts.find((item) => item.resourceType === 'project')?.actions).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'transition', body: { orgId: 'org-1', toState: 'qa_approved' } })]))
  })

  it('sanitises unsafe output links and persisted error text', () => {
    const model = buildBookStudioProjectModel({ project: { ...project, packageManifest: { status: 'failed', qaStatus: 'block', error: 'secret sk-live', files: [{ role: 'cover_pdf', label: 'Cover', href: 'javascript:alert(1)' }] } }, chapters: [], pages: [], rightsLedgers: [], publishingPackets: [], capabilities: { canView: true, canCreate: true, canEdit: true, canEvidenceRights: true, canApprovalGates: true, canPublishingPackets: true, canArchiveDelete: true, isOperator: true }, role: 'admin' })
    expect(JSON.stringify(model)).not.toContain('sk-live')
    expect(JSON.stringify(model)).not.toContain('javascript:')
    expect(model.attention).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'qa', state: 'blocked', detail: 'The assembled files did not pass quality review.' })]))
  })

  it('encodes dynamic record and output fragments exactly once', () => {
    const model = buildBookStudioProjectModel({ project: { ...project, packageManifest: { status: 'generated', qaStatus: 'pending_review', files: [{ role: 'cover#50%', label: 'Cover' }] } }, chapters: [{ id: 'chapter#50%', orgId: 'org-1', projectId: 'book-1', status: 'approved' }], pages: [], rightsLedgers: [], publishingPackets: [], capabilities: { canView: true, canCreate: true, canEdit: true, canEvidenceRights: true, canApprovalGates: true, canPublishingPackets: true, canArchiveDelete: true, isOperator: true }, role: 'admin' })
    expect(model.groups.find((group) => group.id === 'chapters')?.items[0].href).toContain('#chapter-chapter%2350%25')
    expect(model.artifacts.find((artifact) => artifact.resourceType === 'cover#50%')?.href).toContain('#output-cover%2350%25%3A0')
  })

  it('creates unique exact output links for duplicate and missing roles', () => {
    const model = buildBookStudioProjectModel({ project: { ...project, packageManifest: { status: 'generated', qaStatus: 'pending_review', files: [{ role: 'cover', label: 'Cover A' }, { role: 'cover', label: 'Cover B' }, { label: 'Unclassified' }] } }, chapters: [], pages: [], rightsLedgers: [], publishingPackets: [], capabilities: { canView: true, canCreate: true, canEdit: true, canEvidenceRights: true, canApprovalGates: true, canPublishingPackets: true, canArchiveDelete: true, isOperator: true }, role: 'admin' })
    const outputs = model.artifacts.filter((artifact) => ['cover', 'output'].includes(artifact.resourceType))
    expect(outputs.map((artifact) => artifact.href)).toEqual([
      expect.stringContaining('#output-cover%3A0'),
      expect.stringContaining('#output-cover%3A1'),
      expect.stringContaining('#output-output%3A2'),
    ])
    expect(new Set(outputs.map((artifact) => artifact.id)).size).toBe(3)
  })
})
