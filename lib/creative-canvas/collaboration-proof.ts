import type {
  CreativeCanvasActorType,
  CreativeCanvasCollaborationProofEvidence,
  CreativeCanvasProofBinding,
  CreativeCanvasRemoteMutationEvidence,
} from './types'

type RemotePresenceInput = {
  actorUid: string
  actorType: CreativeCanvasActorType
  hasUnsavedGraphChanges?: boolean
  graphSignature?: string
}

type AppliedDraftInput = {
  actorUid: string
  actorType: CreativeCanvasActorType
  graphSignature: string
  touchedNodeIds: string[]
  touchedEdgeIds: string[]
  appliedAt: string
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
}

function hasTouchedGraph(mutation: CreativeCanvasRemoteMutationEvidence): boolean {
  return mutation.touchedNodeIds.length > 0 || mutation.touchedEdgeIds.length > 0
}

export function collectCollaborationMutationProof(input: {
  remotePresence: RemotePresenceInput[]
  activity: CreativeCanvasRemoteMutationEvidence[]
  latestAppliedDraft?: AppliedDraftInput
  currentGraphSignature: string
  streamConnected: boolean
  capturedAt: string
  binding: CreativeCanvasProofBinding
}): CreativeCanvasCollaborationProofEvidence {
  const typedMutations = input.activity.filter(hasTouchedGraph)
  const actorIds = unique([
    ...input.remotePresence.map((item) => item.actorUid),
    ...typedMutations.map((item) => item.actorUid),
  ])
  const operationKinds = unique(typedMutations.map((item) => item.operation))
  const touchedNodeIds = unique(typedMutations.flatMap((item) => item.touchedNodeIds))
  const appliedDraftHandled = Boolean(
    input.latestAppliedDraft
      && input.latestAppliedDraft.graphSignature === input.currentGraphSignature,
  )
  const source = appliedDraftHandled
    ? 'draft_applied'
    : input.streamConnected
      ? 'stream'
      : 'poll'
  const outcome = appliedDraftHandled
    ? 'remote_changes_adopted'
    : 'remote_changes_observed'

  return {
    ...input.binding,
    collaborationRemoteActorCount: actorIds.length,
    collaborationRemoteEventCount: typedMutations.length,
    collaborationRemoteMutationCount: typedMutations.length,
    collaborationRemoteMutationKindCount: operationKinds.length,
    collaborationRemoteTouchedNodeCount: touchedNodeIds.length,
    collaborationRemoteGraphSignature: appliedDraftHandled
      ? input.currentGraphSignature
      : input.binding.graphSignature,
    collaborationRemoteSource: source,
    collaborationRemoteOutcome: outcome,
    collaborationCapturedAt: input.capturedAt,
    collaborationEvidence: `${actorIds.length} remote actors; ${typedMutations.length} typed remote mutations; ${touchedNodeIds.length} touched nodes; source ${source}; outcome ${outcome}.`,
    collaborationRemoteMutations: typedMutations,
  }
}
