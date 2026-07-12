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

  it('reduces arbitrary Hermes payloads to safe run fields', () => {
    expect(safeHermesRunPayload({
      run_id: 'run-1', status: 'started', endpoint: 'https://gateway.example/v1/runs',
      error: 'Bearer super-secret', nested: { working_directory: '/Users/peet/private' },
    })).toEqual({ runId: 'run-1', status: 'started' })
  })
})
