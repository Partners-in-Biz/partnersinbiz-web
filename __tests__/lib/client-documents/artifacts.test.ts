import {
  collectDocumentArtifactStoragePaths,
  issueDocumentArtifactReadUrl,
  revokeDocumentArtifactTokens,
  stripDurableArtifactUrls,
} from '@/lib/client-documents/artifacts'

describe('client document artifacts', () => {
  it('collects only durable storage paths from signature request and external sign stamps', () => {
    const paths = collectDocumentArtifactStoragePaths({
      signatureRequests: [
        { pdfSnapshotPath: 'client-documents/doc-1/signed/req-1.pdf', pdfSnapshotUrl: 'https://example.test/old' },
        { pdfSnapshotPath: '  ', pdfSnapshotUrl: 'https://example.test/skip' },
        { pdfSnapshotPath: 'client-documents/doc-1/signed/req-2.pdf' },
      ],
      signedByExternal: {
        pdfSnapshotPath: 'client-documents/doc-1/signed/external.pdf',
        pdfSnapshotUrl: 'https://example.test/external',
      },
    })

    expect(paths).toEqual([
      'client-documents/doc-1/signed/req-1.pdf',
      'client-documents/doc-1/signed/req-2.pdf',
      'client-documents/doc-1/signed/external.pdf',
    ])
  })

  it('strips durable artifact URLs while keeping storage paths', () => {
    expect(
      stripDurableArtifactUrls({
        id: 'req-1',
        pdfSnapshotPath: 'client-documents/doc-1/signed/req-1.pdf',
        pdfSnapshotUrl: 'https://firebasestorage.googleapis.com/v0/b/x/o/y?alt=media&token=abc',
        nested: {
          pdfSnapshotUrl: 'https://example.test/nested',
          keep: true,
        },
      }),
    ).toEqual({
      id: 'req-1',
      pdfSnapshotPath: 'client-documents/doc-1/signed/req-1.pdf',
      nested: {
        keep: true,
      },
    })
  })

  it('issues a short-lived signed read URL and can rotate download tokens', async () => {
    const getSignedUrl = jest.fn(async () => ['https://signed.example/tmp'])
    const setMetadata = jest.fn(async () => undefined)
    const file = { getSignedUrl, setMetadata }
    const bucket = { file: jest.fn(() => file) }

    const issued = await issueDocumentArtifactReadUrl('client-documents/doc-1/signed/req-1.pdf', {
      bucket: bucket as never,
      nowMs: () => 1_700_000_000_000,
      ttlMs: 60_000,
    })
    expect(issued).toEqual({
      url: 'https://signed.example/tmp',
      expiresAt: new Date(1_700_000_000_000 + 60_000).toISOString(),
      storagePath: 'client-documents/doc-1/signed/req-1.pdf',
    })
    expect(getSignedUrl).toHaveBeenCalledWith({
      version: 'v4',
      action: 'read',
      expires: new Date(1_700_000_000_000 + 60_000),
    })

    await revokeDocumentArtifactTokens(
      ['client-documents/doc-1/signed/req-1.pdf', 'client-documents/doc-1/signed/req-1.pdf'],
      {
        bucket: bucket as never,
        randomToken: () => 'rotated-token',
      },
    )
    expect(setMetadata).toHaveBeenCalledTimes(1)
    expect(setMetadata).toHaveBeenCalledWith({
      metadata: {
        firebaseStorageDownloadTokens: 'rotated-token',
      },
      cacheControl: 'private, max-age=0, no-store',
    })
  })
})
