import type { WorkflowTimelineEntry } from './types'

const TIMELINE_CAP = 40

/** Tiny helper kept separate from ops.ts to avoid circular imports with engine. */
export function appendTimeline(
  timeline: WorkflowTimelineEntry[] | undefined,
  entry: WorkflowTimelineEntry,
  cap = TIMELINE_CAP,
): WorkflowTimelineEntry[] {
  const next = [...(timeline ?? []), entry]
  return next.length > cap ? next.slice(next.length - cap) : next
}
