/**
 * Live progress for linked-computer (Mac) runs.
 *
 * VPS Hermes runs expose `/v1/runs/{id}/events` directly. Linked jobs use a
 * queue job id that is not on the VPS gateway, so the Messages EventSource must
 * stream from Firestore job state (and any Hermes events the Mac runtime posts).
 */
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { normalizeHermesEvent } from '@/lib/hermes/progress-events'
import type { ChatEvent } from '@/lib/hermes/types'

const LINKED_RUN_JOBS = 'linked_device_run_jobs'

const encoder = new TextEncoder()
const MAX_STORED_EVENTS = 200
const POLL_MS = 1_250

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function cleanString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}

export function sanitizeLinkedRunChatEvents(
  rawEvents: unknown,
  runId?: string,
): ChatEvent[] {
  if (!Array.isArray(rawEvents)) return []
  const out: ChatEvent[] = []
  for (const item of rawEvents.slice(0, 40)) {
    for (const event of normalizeHermesEvent(item, runId)) {
      // Drop heavy raw blobs from device-forwarded events; UI uses tool/preview.
      const { raw: _raw, ...safe } = event
      out.push(safe)
      if (out.length >= 40) return out
    }
  }
  return out
}

export async function getLinkedRunJobSnapshot(jobId: string): Promise<{
  exists: boolean
  status?: string
  machineLabel?: string
  error?: string
  chatEvents: ChatEvent[]
} | null> {
  const cleanId = cleanString(jobId)
  if (!cleanId) return null
  const snap = await adminDb.collection(LINKED_RUN_JOBS).doc(cleanId).get()
  if (!snap.exists) return null
  const data = snap.data() ?? {}
  const chatEvents = Array.isArray(data.chatEvents)
    ? data.chatEvents as ChatEvent[]
    : []
  return {
    exists: true,
    status: cleanString(data.status),
    machineLabel:
      cleanString(data.acceptedMachineLabel)
      ?? cleanString(asRecord(data.acceptanceReceipt).machineLabel)
      ?? cleanString(asRecord(data.receipt).machineLabel),
    error: cleanString(data.error),
    chatEvents,
  }
}

export async function appendLinkedRunChatEvents(input: {
  jobId: string
  events: unknown
}): Promise<number> {
  const jobId = cleanString(input.jobId)
  if (!jobId) return 0
  const incoming = sanitizeLinkedRunChatEvents(input.events, jobId)
  if (incoming.length === 0) return 0

  const ref = adminDb.collection(LINKED_RUN_JOBS).doc(jobId)
  await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists) return
    const data = snap.data() ?? {}
    const existing = Array.isArray(data.chatEvents) ? data.chatEvents as ChatEvent[] : []
    const merged = [...existing, ...incoming].slice(-MAX_STORED_EVENTS)
    tx.update(ref, {
      chatEvents: merged,
      updatedAt: FieldValue.serverTimestamp(),
    })
  })
  return incoming.length
}

function encodeSse(event: ChatEvent): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
}

function isTerminalLinkedStatus(status: string | undefined): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled' || status === 'expired'
}

/**
 * Long-lived SSE for a linked-computer job id. Emits stored Hermes events as the
 * Mac runtime posts them, plus status heartbeats while the job is still running.
 */
export function createLinkedComputerRunSseStream(
  jobId: string,
  options: { pollMs?: number; getSnapshot?: typeof getLinkedRunJobSnapshot } = {},
): ReadableStream<Uint8Array> {
  const pollMs = options.pollMs ?? POLL_MS
  const getSnapshot = options.getSnapshot ?? getLinkedRunJobSnapshot
  let closed = false
  let cursor = 0
  let emittedBootstrap = false

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const enqueue = (event: ChatEvent) => {
        if (closed) return
        controller.enqueue(encodeSse(event))
      }

      const tick = async (): Promise<boolean> => {
        const snap = await getSnapshot(jobId)
        if (!snap?.exists) {
          enqueue({
            event: 'stream.unavailable',
            runId: jobId,
            run_id: jobId,
            timestamp: Date.now() / 1000,
            activity: 'Linked computer run was not found.',
            error: 'linked_run_not_found',
          })
          return true
        }

        const terminal = isTerminalLinkedStatus(snap.status)
        if (terminal) {
          const events = snap.chatEvents
          if (events.length > cursor) {
            for (const event of events.slice(cursor)) enqueue(event)
            cursor = events.length
          }
          enqueue({
            event: snap.status === 'completed' ? 'run.completed' : 'run.failed',
            runId: jobId,
            run_id: jobId,
            timestamp: Date.now() / 1000,
            activity: snap.status === 'completed' ? 'Linked computer run finished' : 'Linked computer run failed',
            ...(snap.error ? { error: snap.error } : {}),
          })
          return true
        }

        if (!emittedBootstrap) {
          emittedBootstrap = true
          enqueue({
            event: 'heartbeat',
            runId: jobId,
            run_id: jobId,
            timestamp: Date.now() / 1000,
            activity: snap.machineLabel
              ? `Running on ${snap.machineLabel}`
              : 'Running on linked computer',
          })
        }

        const events = snap.chatEvents
        if (events.length > cursor) {
          for (const event of events.slice(cursor)) enqueue(event)
          cursor = events.length
        } else {
          enqueue({
            event: 'heartbeat',
            runId: jobId,
            run_id: jobId,
            timestamp: Date.now() / 1000,
            activity: snap.machineLabel
              ? `Still working on ${snap.machineLabel}`
              : 'Still working on linked computer',
          })
        }

        return false
      }

      const loop = async () => {
        try {
          while (!closed) {
            const done = await tick()
            if (done) break
            await new Promise((resolve) => setTimeout(resolve, pollMs))
          }
        } catch (error) {
          enqueue({
            event: 'stream.unavailable',
            runId: jobId,
            run_id: jobId,
            timestamp: Date.now() / 1000,
            error: error instanceof Error ? error.message : 'Linked stream failed',
            activity: 'Still working',
          })
        } finally {
          if (!closed) {
            closed = true
            try { controller.close() } catch { /* already closed */ }
          }
        }
      }

      void loop()
    },
    cancel() {
      closed = true
    },
  })
}
