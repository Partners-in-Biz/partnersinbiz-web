import { NextRequest } from 'next/server'
import { handleBrowserIdentity } from '@/app/api/v1/linked-computers/[deviceId]/grants/[orgId]/browser-identity/route'
import { enqueueBrowserPolicyJobs } from '@/lib/linked-computers/agent-host-service'

describe('browser identity route and policy jobs', () => {
  it('saves consent and enqueues one sync-policy job per managed profile', async () => {
    const save = jest.fn(async () => ({
      useRealProfile: true,
      realProfilePin: 'Profile 2',
      headed: true,
      autoclose: false,
      updatedByUserId: 'owner-a',
      updatedAt: 'now',
    }))
    const enqueue = jest.fn(async () => ['job-pip', 'job-maya'])
    const req = new NextRequest('https://test/api/v1/linked-computers/device-a/grants/org-a/browser-identity', {
      method: 'PUT',
      body: JSON.stringify({
        useRealProfile: true,
        realProfilePin: 'Profile 2',
        headed: true,
        autoclose: false,
      }),
    })
    const response = await handleBrowserIdentity(req, { uid: 'owner-a' }, 'device-a', 'org-a', save, enqueue)
    expect(response.status).toBe(200)
    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      deviceId: 'device-a',
      orgId: 'org-a',
      actorUserId: 'owner-a',
      identity: { useRealProfile: true, realProfilePin: 'Profile 2', headed: true, autoclose: false },
    }))
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({
      deviceId: 'device-a',
      orgId: 'org-a',
      actorUserId: 'owner-a',
      browserPolicy: { useRealProfile: true, realProfilePin: 'Profile 2', headed: true, autoclose: false },
    }))
    expect((await response.json()).data.jobIds).toEqual(['job-pip', 'job-maya'])
  })

  it('enqueues one browser-policy sync-policy job for each desired agent', async () => {
    const enqueue = jest.fn(async (input: { idempotencyKey: string; payload: { agentId: string } }) => ({
      jobId: `job-${input.payload.agentId}`,
    }))
    const jobIds = await enqueueBrowserPolicyJobs({
      deviceId: 'device-a',
      orgId: 'org-a',
      actorUserId: 'owner-a',
      browserPolicy: { useRealProfile: true, realProfilePin: null, headed: false, autoclose: false },
    }, {
      loadDevice: async () => ({
        deviceId: 'device-a',
        credentialVersion: 3,
        desiredAgents: [
          { agentId: 'pip', keepInSync: true },
          { agentId: 'maya', keepInSync: true },
        ],
      } as never),
      policyPayload: async (agentId) => ({
        agentId: `partners--${agentId}`,
        catalogAgentId: agentId,
        policyVersion: 'v1',
        keepInSync: true,
        runtimeSkills: [],
        pibSkills: [],
        vpsExternalDir: null,
        preferredPort: 8755,
      }) as never,
      enqueueAgentHostJob: enqueue as never,
    })
    expect(jobIds.sort()).toEqual(['job-partners--maya', 'job-partners--pip'])
    expect(enqueue).toHaveBeenCalledTimes(2)
    expect(enqueue.mock.calls.map((call) => call[0].idempotencyKey).sort()).toEqual([
      'browser-policy:device-a:partners--maya:true::false:false',
      'browser-policy:device-a:partners--pip:true::false:false',
    ])
    expect(enqueue.mock.calls[0][0].payload.browserPolicy).toEqual({
      useRealProfile: true,
      realProfilePin: null,
      headed: false,
      autoclose: false,
    })
  })
})
