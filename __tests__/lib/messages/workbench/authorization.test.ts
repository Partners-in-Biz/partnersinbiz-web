import {
  WORKBENCH_MINIMUM_RUNTIME_VERSION,
  workbenchRuntimeUpdateRequired,
} from '@/lib/messages/workbench/authorization'

describe('Workbench runtime compatibility', () => {
  it('requires the runtime release that implements every Workbench poller', () => {
    expect(WORKBENCH_MINIMUM_RUNTIME_VERSION).toBe('1.1.8')
    expect(workbenchRuntimeUpdateRequired('1.1.7')).toBe(true)
    expect(workbenchRuntimeUpdateRequired('1.1.8')).toBe(false)
    expect(workbenchRuntimeUpdateRequired('1.2.0')).toBe(false)
    expect(workbenchRuntimeUpdateRequired('invalid')).toBe(true)
  })
})
