import { chatContextReferenceKey, type ChatContextReference } from './types'

export interface ContextSelectionSources {
  explicit?: ChatContextReference
  conversation?: ChatContextReference
  composer?: ChatContextReference
  attached?: ChatContextReference[]
  available?: ChatContextReference[]
}

export function selectActiveContext(sources: ContextSelectionSources): ChatContextReference | undefined {
  const candidates = [sources.explicit, sources.conversation, sources.composer, ...(sources.attached ?? []).slice().reverse()]
  return candidates.find((candidate): candidate is ChatContextReference => Boolean(
    candidate && (
      !sources.available
      || sources.available.some(item => chatContextReferenceKey(item) === chatContextReferenceKey(candidate))
    ),
  ))
}
