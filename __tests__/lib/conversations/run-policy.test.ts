import {
  CONVERSATION_CLIENT_FINALIZE_EXHAUSTED_ERROR,
  CONVERSATION_LOCAL_HERMES_OFFLINE_USER_ERROR,
  CONVERSATION_RUN_RECOVERING_LEGACY_USER_ERROR,
  CONVERSATION_RUN_RECOVERING_USER_ERROR,
  humanizeConversationRunError,
  isLocalConversationRuntimeKind,
  isLocalHermesUnreachableError,
  localHermesOfflineUserError,
  isConversationBrowserToolFailure,
  isConversationInfrastructureInterrupt,
  isRecoverableConversationRunError,
} from '@/lib/conversations/run-policy'

describe('humanizeConversationRunError', () => {
  it('rewrites the old retrying-automatically essay into a short send-again line', () => {
    expect(humanizeConversationRunError(
      'The agent hit a temporary computer/gateway interruption. Partners in Biz is retrying automatically — leave this chat open.',
    )).toBe(CONVERSATION_RUN_RECOVERING_USER_ERROR)
    expect(humanizeConversationRunError(CONVERSATION_RUN_RECOVERING_LEGACY_USER_ERROR))
      .toBe(CONVERSATION_RUN_RECOVERING_USER_ERROR)
    expect(humanizeConversationRunError(`  ${CONVERSATION_RUN_RECOVERING_LEGACY_USER_ERROR}\n`))
      .toBe(CONVERSATION_RUN_RECOVERING_USER_ERROR)
    expect(CONVERSATION_RUN_RECOVERING_USER_ERROR.length).toBeLessThan(80)
  })

  it('rewrites agent-browser connect failures into recovery guidance', () => {
    expect(humanizeConversationRunError('Unable to connect. Is the computer able to access the url?'))
      .toBe(CONVERSATION_RUN_RECOVERING_USER_ERROR)
  })

  it('maps connection-reset style gateway deaths to recovery guidance', () => {
    expect(humanizeConversationRunError('ClientConnectorError: Connection refused'))
      .toBe(CONVERSATION_RUN_RECOVERING_USER_ERROR)
    expect(humanizeConversationRunError('Broken pipe while streaming events'))
      .toBe(CONVERSATION_RUN_RECOVERING_USER_ERROR)
    expect(humanizeConversationRunError('Tool terminal returned error exit_code": -15'))
      .toBe(CONVERSATION_RUN_RECOVERING_USER_ERROR)
  })

  it('maps real-profile guard failures to the owner-only browsing message', () => {
    expect(humanizeConversationRunError('real_profile_guard'))
      .toBe("This computer's owner has enabled browsing as themselves; your chat cannot run there.")
  })

  it('maps remaining Appendix C runtime errors to operator-safe chat copy', () => {
    expect(humanizeConversationRunError('org_mismatch'))
      .toBe('This agent profile belongs to a different organisation on that computer. Re-pair the computer.')
    expect(humanizeConversationRunError('grant_not_active'))
      .toBe("The organisation's access to this computer is paused.")
    expect(humanizeConversationRunError('device grant not active'))
      .toBe("The organisation's access to this computer is paused.")
    expect(humanizeConversationRunError('linked_device_hermes_update_required'))
      .toBe('Hermes on this computer is too old. It will update automatically when idle.')
    expect(humanizeConversationRunError('hermes_update_failed'))
      .toBe('Hermes could not update on this computer. It keeps working on the previous version; see the runbook.')
  })

  describe('selected computer offline / Local Hermes unreachable', () => {
    // Exactly what messages/route stores: classifyWorkspaceDispatchFailure sanitizes a
    // tunnel 502 on local-profiles/<agent> to this fixed string + dispatch_unavailable.
    const SANITIZED_DISPATCH_FAILURE = 'Agent run could not be started on the gateway.'
    // Runtime-target selection failure text stored alongside runtimeDispatchFailureCode.
    const STALE_TARGET_TEXT = 'That computer went offline. Pick a healthy computer and retry.'
    const UNHEALTHY_TARGET_TEXT = 'That computer is unhealthy right now. Pick another computer or retry shortly.'
    const NAMED_MAC_OFFLINE = 'peets-mac-mini offline — Local Hermes unreachable. Send the message again once it reconnects.'

    it.each(['linked-computer', 'local'])('maps the sanitized dispatch failure on a %s runtime to the named offline line', (runtimeKind) => {
      const context = { runtimeKind, runtimeLabel: 'peets-mac-mini', failureCode: 'dispatch_unavailable' }
      expect(isLocalHermesUnreachableError(SANITIZED_DISPATCH_FAILURE, context)).toBe(true)
      expect(humanizeConversationRunError(SANITIZED_DISPATCH_FAILURE, context)).toBe(NAMED_MAC_OFFLINE)
      expect(humanizeConversationRunError(SANITIZED_DISPATCH_FAILURE, context)).not.toBe(CONVERSATION_RUN_RECOVERING_USER_ERROR)
      expect(humanizeConversationRunError(SANITIZED_DISPATCH_FAILURE, context)).not.toMatch(/retrying automatically|leave this chat open/i)
    })

    it('never labels a VPS dispatch failure as Local Hermes unreachable', () => {
      const context = { runtimeKind: 'vps', runtimeLabel: 'Partners VPS', failureCode: 'dispatch_unavailable' }
      expect(isLocalHermesUnreachableError(SANITIZED_DISPATCH_FAILURE, context)).toBe(false)
      expect(humanizeConversationRunError(SANITIZED_DISPATCH_FAILURE, context)).toBe(SANITIZED_DISPATCH_FAILURE)
      expect(humanizeConversationRunError(SANITIZED_DISPATCH_FAILURE, context)).not.toMatch(/Local Hermes/)
      for (const runtimeKind of ['remote', 'legacy', undefined, null, '']) {
        expect(isLocalHermesUnreachableError(SANITIZED_DISPATCH_FAILURE, { runtimeKind, failureCode: 'dispatch_unavailable' })).toBe(false)
      }
    })

    it.each([
      ['runtime_target_stale', STALE_TARGET_TEXT],
      ['runtime_target_unhealthy', UNHEALTHY_TARGET_TEXT],
      ['runtime_target_not_found', 'That computer is not available for agent dispatch.'],
      ['runtime_target_disabled', 'That computer is not available for agent dispatch.'],
    ])('maps %s on a local runtime to the offline line and leaves VPS text untouched', (failureCode, stored) => {
      expect(humanizeConversationRunError(stored, { runtimeKind: 'local', failureCode }))
        .toBe(CONVERSATION_LOCAL_HERMES_OFFLINE_USER_ERROR)
      expect(humanizeConversationRunError(stored, { runtimeKind: 'vps', failureCode })).toBe(stored)
    })

    it('never treats client finalize exhaustion as offline: the host accepted the run', () => {
      // Set after MAX_RUN_POLL_ATTEMPTS on a message that already has a runId, so the
      // Mac was reachable. Naming it offline would invite a duplicate send.
      for (const runtimeKind of ['local', 'linked-computer', 'vps', undefined]) {
        const context = { runtimeKind, runtimeLabel: 'peets-mac-mini' }
        expect(isLocalHermesUnreachableError(CONVERSATION_CLIENT_FINALIZE_EXHAUSTED_ERROR, context)).toBe(false)
        expect(humanizeConversationRunError(CONVERSATION_CLIENT_FINALIZE_EXHAUSTED_ERROR, context))
          .toBe(CONVERSATION_CLIENT_FINALIZE_EXHAUSTED_ERROR)
      }
      expect(humanizeConversationRunError(CONVERSATION_CLIENT_FINALIZE_EXHAUSTED_ERROR)).not.toMatch(/Local Hermes unreachable/)
    })

    it('never classifies from free text: agent prose mentioning local-profiles or computer unavailable stays as-is', () => {
      const vpsProse = 'I checked https://hermes-api.partnersinbiz.online/local-profiles/pip/v1/health and the computer unavailable page returned 502 Bad Gateway.'
      expect(isLocalHermesUnreachableError(vpsProse, { runtimeKind: 'vps' })).toBe(false)
      expect(humanizeConversationRunError(vpsProse, { runtimeKind: 'vps', runtimeLabel: 'Partners VPS' })).toBe(vpsProse)
      // Same prose from a local run that finished with a real failure but no dispatch code.
      expect(isLocalHermesUnreachableError(vpsProse, { runtimeKind: 'local' })).toBe(false)
      expect(humanizeConversationRunError(vpsProse, { runtimeKind: 'local' })).toBe(vpsProse)
      for (const raw of [
        'Computer unavailable',
        'linked computers: linked_device_offline',
        'Local Hermes is temporarily unavailable; the runtime will reconnect automatically.',
        'Hermes stream /v1/runs/run_1/events failed: 502',
        'Agent gateway returned 502 Bad Gateway',
      ]) {
        expect(isLocalHermesUnreachableError(raw)).toBe(false)
        expect(isLocalHermesUnreachableError(raw, { runtimeKind: 'vps' })).toBe(false)
        expect(isLocalHermesUnreachableError(raw, { runtimeKind: 'local' })).toBe(false)
        expect(humanizeConversationRunError(raw, { runtimeKind: 'vps' })).not.toMatch(/Local Hermes unreachable/)
      }
    })

    it('does not swallow transient interrupts on a reachable host', () => {
      expect(humanizeConversationRunError('gateway_draining', { runtimeKind: 'local' })).toBe(CONVERSATION_RUN_RECOVERING_USER_ERROR)
      expect(humanizeConversationRunError('ClientConnectorError: Connection refused', { runtimeKind: 'linked-computer' }))
        .toBe(CONVERSATION_RUN_RECOVERING_USER_ERROR)
      expect(isRecoverableConversationRunError('gateway_draining')).toBe(true)
      expect(isRecoverableConversationRunError('signal=SIGTERM')).toBe(true)
      expect(isLocalConversationRuntimeKind('vps')).toBe(false)
      expect(isLocalConversationRuntimeKind('linked-computer')).toBe(true)
      expect(isLocalConversationRuntimeKind('Local')).toBe(true)
    })

    it('names the machine when the dispatch label is known', () => {
      expect(localHermesOfflineUserError('Mac')).toBe('Mac offline — Local Hermes unreachable. Send the message again once it reconnects.')
      expect(localHermesOfflineUserError('  ')).toBe(CONVERSATION_LOCAL_HERMES_OFFLINE_USER_ERROR)
      expect(CONVERSATION_LOCAL_HERMES_OFFLINE_USER_ERROR).toMatch(/^Selected computer offline — Local Hermes unreachable\./)
    })

    it('keeps the specific code mappings ahead of the offline class', () => {
      expect(humanizeConversationRunError('linked_device_hermes_update_required', { runtimeKind: 'local', failureCode: 'linked_device_hermes_update_required' }))
        .toBe('Hermes on this computer is too old. It will update automatically when idle.')
      expect(humanizeConversationRunError('grant_not_active on this computer', { runtimeKind: 'linked-computer', failureCode: 'dispatch_unavailable' }))
        .toBe("The organisation's access to this computer is paused.")
    })
  })

  it('preserves ordinary short errors', () => {
    expect(humanizeConversationRunError('Project is not linked to this computer'))
      .toBe('Project is not linked to this computer')
  })

  it('handles empty input', () => {
    expect(humanizeConversationRunError('')).toMatch(/failed/i)
    expect(humanizeConversationRunError(null)).toMatch(/failed/i)
  })
})

describe('isRecoverableConversationRunError', () => {
  it('classifies browser and infrastructure interrupts as recoverable', () => {
    expect(isConversationBrowserToolFailure('Unable to connect. Is the computer able to access the url?')).toBe(true)
    expect(isConversationInfrastructureInterrupt('Local Hermes pip runtime restarting; reattachment retry window exhausted')).toBe(true)
    expect(isRecoverableConversationRunError('gateway_draining')).toBe(true)
    expect(isRecoverableConversationRunError('The agent hit a temporary computational limit')).toBe(true)
    expect(isRecoverableConversationRunError('429 Too Many Requests / rate limit')).toBe(true)
    expect(humanizeConversationRunError('RESOURCE_EXHAUSTED: overloaded'))
      .toBe(CONVERSATION_RUN_RECOVERING_USER_ERROR)
    expect(isRecoverableConversationRunError('Project is not linked to this computer')).toBe(false)
  })
})
