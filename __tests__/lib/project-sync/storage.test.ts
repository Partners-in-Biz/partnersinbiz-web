import { Readable } from 'node:stream'
import { createProjectSyncStorageBroker } from '@/lib/project-sync/storage'

const SHA = 'a'.repeat(64)

describe('project sync Firebase Storage CAS broker', () => {
  it('issues short-lived object-specific create-only upload and download URLs', async () => {
    const getSignedUrl = jest.fn(async (options) => [`https://signed.example/${options.action}`])
    const setMetadata = jest.fn(async () => undefined)
    const file = jest.fn(() => ({
      getSignedUrl,
      setMetadata,
      getMetadata: async () => [{
        size: '3',
        metadata: { projectSyncSha256: SHA, projectSyncSize: '3', projectSyncVerified: 'true' },
      }],
    }))
    const broker = createProjectSyncStorageBroker({
      bucket: { file },
      nowMs: () => 1_700_000_000_000,
      ttlMs: 60_000,
    })

    const upload = await broker.signUpload({ orgId: 'org-a', projectId: 'project-a', sha256: SHA, size: 3 })
    const download = await broker.signDownload({ orgId: 'org-a', projectId: 'project-a', sha256: SHA, size: 3 })

    expect(file).toHaveBeenCalledWith(`project-sync/org-a/project-a/objects/${SHA}`)
    expect(getSignedUrl).toHaveBeenNthCalledWith(1, expect.objectContaining({
      version: 'v4',
      action: 'write',
      contentType: 'application/octet-stream',
      extensionHeaders: { 'content-length': '3', 'x-goog-if-generation-match': '0' },
    }))
    expect(getSignedUrl).toHaveBeenNthCalledWith(2, expect.objectContaining({ version: 'v4', action: 'read' }))
    expect(setMetadata).toHaveBeenCalledWith({ customTime: '2023-11-14T22:13:20.000Z' })
    expect(setMetadata.mock.invocationCallOrder[0]).toBeLessThan(getSignedUrl.mock.invocationCallOrder[1])
    expect(upload).toEqual(expect.objectContaining({ sha256: SHA, size: 3, url: 'https://signed.example/write' }))
    expect(download).toEqual(expect.objectContaining({ sha256: SHA, size: 3, url: 'https://signed.example/read' }))
  })

  it('streams and verifies the exact uploaded hash and size before marking an object trusted', async () => {
    const setMetadata = jest.fn(async () => undefined)
    const file = jest.fn(() => ({
      createReadStream: () => Readable.from([Buffer.from('abc')]),
      setMetadata,
      getMetadata: async () => [{ generation: '7', size: '3' }],
      getSignedUrl: jest.fn(),
    }))
    const broker = createProjectSyncStorageBroker({ bucket: { file } })

    await expect(broker.verifyUpload({
      orgId: 'org-a',
      projectId: 'project-a',
      sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
      size: 3,
    })).resolves.toEqual(expect.objectContaining({ verified: true, size: 3 }))
    expect(setMetadata).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({
        projectSyncSha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
        projectSyncSize: '3',
        projectSyncVerified: 'true',
      }),
    }))
  })

  it('rejects uploaded bytes that do not match the signed object contract', async () => {
    const setMetadata = jest.fn()
    const remove = jest.fn(async () => undefined)
    const broker = createProjectSyncStorageBroker({
      bucket: { file: () => ({
        createReadStream: () => Readable.from([Buffer.from('abcd')]),
        setMetadata,
        getMetadata: async () => [{ generation: '9', size: '4' }],
        delete: remove,
        getSignedUrl: jest.fn(),
      }) },
    })

    await expect(broker.verifyUpload({ orgId: 'org-a', projectId: 'project-a', sha256: SHA, size: 3 }))
      .rejects.toThrow('size verification failed')
    expect(setMetadata).not.toHaveBeenCalled()
    expect(remove).toHaveBeenCalledWith({ preconditionOpts: { ifGenerationMatch: 9 } })
  })
})
