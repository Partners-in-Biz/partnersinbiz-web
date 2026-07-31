import {
  classifyWorkspaceDispatchFailure,
  safeHermesRunPayload,
  sanitizeDispatchMetadata,
} from '@/lib/workspaces/dispatch-errors'

describe('workspace dispatch safety', () => {
  it('classifies arbitrary upstream failures into an allowlisted browser DTO', () => {
    const unsafe = new Error('POST https://gateway.example/v1/runs failed: apiKey=super-secret /Users/peet/private')
    expect(classifyWorkspaceDispatchFailure(unsafe)).toEqual({
      code: 'dispatch_unavailable',
      message: 'Agent run could not be started on the gateway.',
      retryable: true,
    })
    expect(JSON.stringify(classifyWorkspaceDispatchFailure(unsafe))).not.toMatch(/gateway\.example|super-secret|Users/)
  })

  it('keeps only logical identifiers and path class in stored metadata', () => {
    const metadata = sanitizeDispatchMetadata({
      conversationId: 'conv-1', messageId: 'msg-1', orgId: 'org-1', workspaceId: 'workspace-1',
      projectId: 'project-1', workspacePathClass: 'project', requestedRuntimeTargetId: 'local',
      runtimeTargetId: 'local', source: 'pib-unified-chat',
      vpsWorkingPath: '/var/lib/hermes/private', localWorkingPath: '/Users/peet/private',
      baseUrl: 'https://gateway.example', apiKey: 'super-secret', arbitrary: { password: 'secret' },
    })
    expect(metadata).toEqual(expect.objectContaining({
      conversationId: 'conv-1', workspaceId: 'workspace-1', projectId: 'project-1',
      workspacePathClass: 'project', requestedRuntimeTargetId: 'local', runtimeTargetId: 'local',
    }))
    expect(JSON.stringify(metadata)).not.toMatch(/var\/lib|Users\/peet|gateway\.example|super-secret|password/)
  })

  it('preserves hermes-features-delegation branch keys so cron can auto-complete children', () => {
    // Mirrors production createRun metadata in lib/hermes-features/runtime-deps.ts
    const productionMetadata = {
      source: 'hermes-features-delegation',
      delegationId: 'del_1712345678_ab12cd',
      childId: 'child_1712345678_0',
      parentRunHint: 'messages:conv-1:msg:msg-9',
      dispatchAgentId: 'maya',
      orgId: 'org-1',
      conversationId: 'conv-1',
      branchMessageId: 'branch-msg-1',
      messageId: 'branch-msg-1',
      // must still be stripped
      apiKey: 'super-secret',
      vpsWorkingPath: '/var/lib/hermes/private',
    }
    const metadata = sanitizeDispatchMetadata(productionMetadata)
    expect(metadata).toEqual(expect.objectContaining({
      source: 'hermes-features-delegation',
      delegationId: 'del_1712345678_ab12cd',
      childId: 'child_1712345678_0',
      parentRunHint: 'messages:conv-1:msg:msg-9',
      dispatchAgentId: 'maya',
      orgId: 'org-1',
      conversationId: 'conv-1',
      branchMessageId: 'branch-msg-1',
      messageId: 'branch-msg-1',
    }))
    expect(metadata).not.toHaveProperty('apiKey')
    expect(metadata).not.toHaveProperty('vpsWorkingPath')
  })

  it('reduces arbitrary Hermes payloads to safe run fields', () => {
    expect(safeHermesRunPayload({
      run_id: 'run-1', status: 'started', endpoint: 'https://gateway.example/v1/runs',
      error: 'Bearer super-secret', nested: { working_directory: '/Users/peet/private' },
    })).toEqual({ runId: 'run-1', status: 'started' })
  })

  it('allowlists only the signed linked-runtime receipt contract', () => {
    expect(safeHermesRunPayload({ run_id: 'run-1', execution_receipt: {
      deviceId: 'device-a', runtimeTargetId: 'linked-device:device-a', credentialVersion: 2,
      mappingId: 'map-a', runtimeVersion: '2.0.0', acceptedAt: '2026-07-12T12:00:00.000Z',
      toolStartedAt: '2026-07-12T12:00:00.001Z', outcome: 'accepted', runId: 'run-1', requestId: 'assistant-1',
      signature: 'Abcdefghijklmnop', apiKey: 'secret', endpoint: 'https://private.example',
    } })).toEqual({ runId: 'run-1', executionReceipt: {
      deviceId: 'device-a', runtimeTargetId: 'linked-device:device-a', credentialVersion: 2,
      mappingId: 'map-a', runtimeVersion: '2.0.0', acceptedAt: '2026-07-12T12:00:00.000Z',
      toolStartedAt: '2026-07-12T12:00:00.001Z', outcome: 'accepted', runId: 'run-1', requestId: 'assistant-1',
      signature: 'Abcdefghijklmnop',
    } })
  })
})
