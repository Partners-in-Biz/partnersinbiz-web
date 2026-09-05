import {
  CONVERSATION_LOCAL_HERMES_OFFLINE_USER_ERROR,
  CONVERSATION_RUN_RECOVERING_LEGACY_USER_ERROR,
  CONVERSATION_RUN_RECOVERING_USER_ERROR,
  humanizeConversationRunError,
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
    const offlineClass = [
      'linked computers: linked_device_offline',
      'linked computers: linked_device_stale',
      'runtime_target_stale',
      'runtime_target_unhealthy',
      'Computer unavailable',
      'The selected runtime target is unavailable.',
      'Local Hermes is temporarily unavailable; the runtime will reconnect automatically.',
      'Agent run could not be started on the gateway. (GET https://hermes-api.partnersinbiz.online/local-profiles/pip/v1/health → 502)',
      'Hermes stream /v1/runs/run_1/events failed: 502',
      'Agent gateway returned 502 Bad Gateway',
      'Computer unavailable (fetch failed: ECONNREFUSED tunnel)',
    ]

    it.each(offlineClass)('maps %s to the short offline line, not the recovering essay', (raw) => {
      expect(isLocalHermesUnreachableError(raw)).toBe(true)
      expect(humanizeConversationRunError(raw)).toBe(CONVERSATION_LOCAL_HERMES_OFFLINE_USER_ERROR)
      expect(humanizeConversationRunError(raw)).not.toBe(CONVERSATION_RUN_RECOVERING_USER_ERROR)
      expect(humanizeConversationRunError(raw)).not.toMatch(/retrying automatically|leave this chat open/i)
    })

    it('names the machine when the dispatch label is known', () => {
      expect(humanizeConversationRunError('linked_device_offline', { runtimeLabel: 'Mac' }))
        .toBe('Mac offline — Local Hermes unreachable. Send the message again once it reconnects.')
      expect(humanizeConversationRunError('Computer unavailable', { runtimeLabel: "Peet's Mac mini" }))
        .toBe("Peet's Mac mini offline — Local Hermes unreachable. Send the message again once it reconnects.")
      expect(localHermesOfflineUserError('  ')).toBe(CONVERSATION_LOCAL_HERMES_OFFLINE_USER_ERROR)
      expect(CONVERSATION_LOCAL_HERMES_OFFLINE_USER_ERROR).toMatch(/^Selected computer offline — Local Hermes unreachable\./)
    })

    it('is never a silent requeue candidate', () => {
      for (const raw of offlineClass) expect(isRecoverableConversationRunError(raw)).toBe(false)
    })

    it('does not swallow transient interrupts on a reachable host or unrelated tool 502s', () => {
      expect(isLocalHermesUnreachableError('gateway_draining')).toBe(false)
      expect(isLocalHermesUnreachableError('ClientConnectorError: Connection refused')).toBe(false)
      expect(isLocalHermesUnreachableError('RESOURCE_EXHAUSTED: overloaded')).toBe(false)
      expect(isLocalHermesUnreachableError('curl https://example.com → 502')).toBe(false)
      expect(isLocalHermesUnreachableError('Project is not linked to this computer')).toBe(false)
      expect(humanizeConversationRunError('gateway_draining')).toBe(CONVERSATION_RUN_RECOVERING_USER_ERROR)
      expect(isRecoverableConversationRunError('gateway_draining')).toBe(true)
      expect(isRecoverableConversationRunError('signal=SIGTERM')).toBe(true)
    })

    it('keeps the specific code mappings ahead of the offline class', () => {
      expect(humanizeConversationRunError('linked_device_hermes_update_required'))
        .toBe('Hermes on this computer is too old. It will update automatically when idle.')
      expect(humanizeConversationRunError('grant_not_active on this computer'))
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
