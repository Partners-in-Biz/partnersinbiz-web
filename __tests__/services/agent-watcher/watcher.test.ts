jest.mock('../../../services/agent-watcher/src/config', () => ({
  AGENT_IDS: ['pip', 'theo', 'maya', 'sage', 'nora'],
  getAgentConfig: jest.fn(),
}))

jest.mock('../../../services/agent-watcher/src/claim', () => ({
  claimTask: jest.fn(),
  claimReviewTask: jest.fn(),
  startHeartbeat: jest.fn(),
}))

jest.mock('../../../services/agent-watcher/src/hermes', () => ({
  runAndPoll: jest.fn(),
}))

jest.mock('../../../services/agent-watcher/src/firestore', () => ({
  db: {},
  FieldValue: {
    serverTimestamp: jest.fn(() => 'SERVER_TIME'),
    delete: jest.fn(() => 'DELETE_FIELD'),
  },
}))

jest.mock('../../../services/agent-watcher/src/task-updates', () => ({
  agentStatusUpdate: (status: string) => ({ agentStatus: status }),
}))

jest.mock('../../../services/agent-watcher/src/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

import { getAgentConfig } from '../../../services/agent-watcher/src/config'
import { claimTask, startHeartbeat } from '../../../services/agent-watcher/src/claim'
import { runAndPoll } from '../../../services/agent-watcher/src/hermes'
import { dispatchTask } from '../../../services/agent-watcher/src/watcher'

const getAgentConfigMock = getAgentConfig as jest.Mock
const claimTaskMock = claimTask as jest.Mock
const startHeartbeatMock = startHeartbeat as jest.Mock
const runAndPollMock = runAndPoll as jest.Mock

function makeTaskRef() {
  const update = jest.fn(async () => undefined)
  return {
    id: 'task-1',
    path: 'orgs/org-1/projects/project-1/tasks/task-1',
    parent: {
      doc: jest.fn(),
    },
    update,
  }
}

describe('agent watcher dispatchTask', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    getAgentConfigMock.mockResolvedValue({ enabled: true, baseUrl: 'https://hermes.local', apiKey: 'secret' })
    claimTaskMock.mockResolvedValue(true)
    startHeartbeatMock.mockReturnValue(jest.fn())
    runAndPollMock.mockImplementation(async (_cfg, _input, onRunCreated) => {
      await onRunCreated('run-live-1')
      return { runId: 'run-live-1', output: 'done summary', error: null }
    })
  })

  it('ignores pending tasks that are not eligible for dispatch', async () => {
    const taskRef = makeTaskRef()

    await dispatchTask(taskRef as never, {
      orgId: 'org-1',
      assigneeAgentId: 'theo',
      agentStatus: 'pending',
      columnId: 'todo',
      requiresApproval: true,
      approvalStatus: 'pending',
    })

    expect(claimTaskMock).not.toHaveBeenCalled()
    expect(runAndPollMock).not.toHaveBeenCalled()
    expect(taskRef.update).not.toHaveBeenCalled()
  })

  it('writes the live run id, heartbeats while running, and marks successful tasks done with the run id', async () => {
    const taskRef = makeTaskRef()
    const stopHeartbeat = jest.fn()
    startHeartbeatMock.mockReturnValue(stopHeartbeat)

    await dispatchTask(taskRef as never, {
      orgId: 'org-1',
      assigneeAgentId: 'theo',
      agentStatus: 'pending',
      columnId: 'todo',
      title: 'Ship watcher hardening',
    })

    expect(claimTaskMock).toHaveBeenCalledWith(taskRef, 'theo')
    expect(startHeartbeatMock).toHaveBeenCalledWith(taskRef)
    expect(stopHeartbeat).toHaveBeenCalledTimes(1)
    expect(taskRef.update).toHaveBeenNthCalledWith(1, expect.objectContaining({
      agentStatus: 'in-progress',
      agentHeartbeatAt: 'SERVER_TIME',
    }))
    expect(taskRef.update).toHaveBeenCalledWith(expect.objectContaining({
      agentConversationId: 'run-live-1',
    }))
    expect(taskRef.update).toHaveBeenLastCalledWith(expect.objectContaining({
      agentStatus: 'done',
      agentConversationId: 'run-live-1',
      agentOutput: expect.objectContaining({ summary: 'done summary' }),
    }))
  })

  it('marks failed Hermes runs blocked while preserving the live run id and stopping the heartbeat', async () => {
    const taskRef = makeTaskRef()
    const stopHeartbeat = jest.fn()
    startHeartbeatMock.mockReturnValue(stopHeartbeat)
    runAndPollMock.mockImplementation(async (_cfg, _input, onRunCreated) => {
      await onRunCreated('run-failed-1')
      return { runId: 'run-failed-1', output: null, error: 'gateway failed' }
    })

    await dispatchTask(taskRef as never, {
      orgId: 'org-1',
      assigneeAgentId: 'theo',
      agentStatus: 'pending',
      columnId: 'todo',
      title: 'Ship watcher hardening',
    })

    expect(stopHeartbeat).toHaveBeenCalledTimes(1)
    expect(taskRef.update).toHaveBeenLastCalledWith(expect.objectContaining({
      agentStatus: 'blocked',
      agentConversationId: 'run-failed-1',
      agentOutput: expect.objectContaining({ summary: 'Watcher error: gateway failed' }),
    }))
  })
})
