import { stripPrivateDocumentFields } from '@/lib/client-documents/public'

describe('client document public sanitizer', () => {
  it('strips private document fields and non-public assumptions', () => {
    const result = stripPrivateDocumentFields({
      id: 'doc-1',
      title: 'Proposal',
      shareToken: 'secret-token',
      shareEnabled: true,
      createdBy: 'ai-agent',
      createdByType: 'agent',
      updatedBy: 'admin-1',
      updatedByType: 'user',
      deleted: false,
      pdfSnapshotUrl: 'https://firebasestorage.googleapis.com/v0/b/x/o/y?alt=media&token=abc',
      signToken: 'sign-secret',
      assumptions: [
        { text: 'Public note', severity: 'info', status: 'open', createdBy: 'ai-agent' },
        { text: 'Internal pricing concern', severity: 'blocks_publish', status: 'open' },
      ],
    })

    expect(result).toEqual({
      id: 'doc-1',
      title: 'Proposal',
      assumptions: [{ text: 'Public note', severity: 'info', status: 'open' }],
    })
  })

  it('recursively strips private fields inside versions and blocks', () => {
    const result = stripPrivateDocumentFields({
      id: 'version-1',
      createdBy: 'admin-1',
      blocks: [
        {
          id: 'summary',
          content: { body: 'Hello', updatedBy: 'admin-1' },
          display: { motion: 'reveal' },
        },
      ],
    })

    expect(result).toEqual({
      id: 'version-1',
      blocks: [
        {
          id: 'summary',
          content: { body: 'Hello' },
          display: { motion: 'reveal' },
        },
      ],
    })
  })
})
