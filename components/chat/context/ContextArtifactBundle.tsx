'use client'
import type { ChatArtifactSummary } from '@/lib/chat-context/types'
import { ContextArtifactCard } from './ContextArtifactCard'
export function ContextArtifactBundle({ artifacts, onActivate }: { artifacts: ChatArtifactSummary[]; onActivate?: (artifact: ChatArtifactSummary) => void }) {
  if (!artifacts.length) return null
  return <div className="ml-0 mt-2 grid max-w-full gap-2 lg:ml-10">{artifacts.map((artifact) => <ContextArtifactCard key={artifact.id} artifact={artifact} onActivate={onActivate} />)}</div>
}
