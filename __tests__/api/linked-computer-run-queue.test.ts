import { NextRequest } from 'next/server'
import { handleLinkedRunClaim } from '@/app/api/v1/linked-computers/[deviceId]/runs/claim/route'
import { handleLinkedRunProgress } from '@/app/api/v1/linked-computers/[deviceId]/runs/[jobId]/progress/route'
import { handleLinkedRunComplete } from '@/app/api/v1/linked-computers/[deviceId]/runs/[jobId]/complete/route'

const identity = { deviceId: 'device-a', ownerUserId: 'user-a', credentialVersion: 3 }
const claim = { jobId: 'job-a', requestId: 'request-1234567890', prompt: 'do work', workspaceId: 'workspace-a', projectId: 'project-a', mappingId: 'mapping-a', relativeFolder: 'Projects/project-a' }

describe('linked computer outbound run routes', () => {
  it('returns a path-safe claim and no secrets or physical paths', async () => {
    const req = new NextRequest('https://app.test/api/v1/linked-computers/device-a/runs/claim', { method: 'POST', body: '{}' })
    const response = await handleLinkedRunClaim(req, 'device-a', async () => identity, async () => claim)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data).toEqual(claim)
    expect(JSON.stringify(body)).not.toMatch(/Users\/|C:\\\\|credential|publicKey|endpoint|token/i)
  })

  it('fails closed when signed identity and path device differ', async () => {
    const req = new NextRequest('https://app.test/api/v1/linked-computers/device-a/runs/claim', { method: 'POST', body: '{}' })
    const response = await handleLinkedRunClaim(req, 'device-a', async () => ({ ...identity, deviceId: 'device-b' }), async () => claim)
    expect(response.status).toBe(403)
  })

  it('binds progress and completion to path device and job', async () => {
    const progressReq = new NextRequest('https://app.test/api/v1/linked-computers/device-a/runs/job-a/progress', { method: 'POST', body: JSON.stringify({ receipt: { jobId: 'job-a' }, message: 'working' }) })
    const progress = jest.fn(async () => ({}))
    expect((await handleLinkedRunProgress(progressReq, 'device-a', 'job-a', async () => identity, progress)).status).toBe(200)
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({ deviceId: 'device-a', jobId: 'job-a', event: 'progress' }))

    const completeReq = new NextRequest('https://app.test/api/v1/linked-computers/device-a/runs/job-a/complete', { method: 'POST', body: JSON.stringify({ receipt: { jobId: 'job-a' }, outcome: 'completed', output: 'done' }) })
    const complete = jest.fn(async () => ({}))
    expect((await handleLinkedRunComplete(completeReq, 'device-a', 'job-a', async () => identity, complete)).status).toBe(200)
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ deviceId: 'device-a', jobId: 'job-a', event: 'complete', output: 'done' }))
  })
})
