import type { ChatEvent } from './types'

const encoder = new TextEncoder()

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

function rawString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function numericTimestamp(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  return Date.now() / 1000
}

export function normalizeHermesEvent(input: unknown, fallbackRunId?: string): ChatEvent[] {
  const raw = asRecord(input)
  const rawEvent = cleanString(raw.event) ?? cleanString(raw.type) ?? 'event'
  const runId = cleanString(raw.run_id) ?? cleanString(raw.runId) ?? fallbackRunId
  const timestamp = numericTimestamp(raw.timestamp)
  const tool = cleanString(raw.tool) ?? cleanString(raw.tool_name) ?? cleanString(raw.name)
  const preview = cleanString(raw.preview) ?? cleanString(raw.input) ?? cleanString(raw.description)
  const base: ChatEvent = {
    event: rawEvent,
    ...(runId ? { runId, run_id: runId } : {}),
    timestamp,
    ...(tool ? { tool } : {}),
    ...(preview ? { preview } : {}),
  }

  if (rawEvent === 'message.delta') {
    const delta = rawString(raw.delta) ?? rawString(raw.text)
    return [{
      ...base,
      event: 'assistant.text_delta',
      ...(delta !== undefined ? { delta, text: delta, preview: delta } : {}),
    }]
  }

  if (rawEvent === 'approval.request') {
    return [{
      ...base,
      event: 'approval.required',
      choices: Array.isArray(raw.choices) ? raw.choices.map(String) : ['once', 'session', 'always', 'deny'],
    }]
  }

  if (rawEvent === 'reasoning.available') {
    const text = cleanString(raw.text) ?? preview
    return [{
      ...base,
      event: 'reasoning.summary',
      ...(text ? { text, preview: text } : {}),
    }]
  }

  if (rawEvent === 'TaskCreate' || rawEvent === 'task.create' || rawEvent === 'task.created') {
    return [{
      ...base,
      event: 'task.created',
      title: cleanString(raw.title) ?? preview,
      status: cleanString(raw.status) ?? 'pending',
    }]
  }

  if (rawEvent === 'TaskUpdate' || rawEvent === 'task.update' || rawEvent === 'task.updated') {
    return [{
      ...base,
      event: 'task.updated',
      title: cleanString(raw.title) ?? preview,
      status: cleanString(raw.status) ?? cleanString(raw.state) ?? 'in_progress',
    }]
  }

  if (rawEvent === 'TodoWrite' || tool === 'TodoWrite') {
    const todos = Array.isArray(raw.todos) ? raw.todos : Array.isArray(raw.items) ? raw.items : undefined
    return [{
      ...base,
      event: 'task.updated',
      title: preview ?? 'Updated task list',
      status: 'in_progress',
      ...(todos ? { todos } : {}),
    }]
  }

  if (rawEvent === 'tool.started') {
    return [{ ...base, event: 'tool.started', activity: activityForTool(tool, preview) }]
  }

  if (rawEvent === 'tool.input_delta') {
    return [{ ...base, event: 'tool.input_delta', activity: activityForTool(tool, preview) }]
  }

  if (rawEvent === 'tool.completed') {
    return [{
      ...base,
      event: 'tool.completed',
      duration: typeof raw.duration === 'number' ? raw.duration : undefined,
      error: typeof raw.error === 'boolean' ? raw.error : raw.error ? String(raw.error) : undefined,
      activity: activityForTool(tool, preview),
    }]
  }

  return [base]
}

export function activityForTool(tool?: string, preview?: string): string {
  const label = `${tool ?? ''} ${preview ?? ''}`.toLowerCase()
  if (!label.trim()) return 'Working'
  if (/(test|jest|vitest|playwright|spec|lint|eslint|tsc|build|next build|npm run build|npm test)/.test(label)) {
    return 'Running checks'
  }
  if (/(read|view|cat|sed|head|tail|open|list|ls|find|rg|grep|search)/.test(label)) {
    return 'Reading files'
  }
  if (/(write|edit|patch|apply|save|create|update)/.test(label)) {
    return 'Editing files'
  }
  if (/(git|commit|push|pull|status|diff)/.test(label)) {
    return 'Working with git'
  }
  if (/(web|fetch|http|url|browser|screenshot)/.test(label)) {
    return 'Checking external context'
  }
  return 'Using a tool'
}

function encodeEvent(event: ChatEvent): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
}

export function createNormalizedHermesSseStream(
  upstreamBody: ReadableStream<Uint8Array>,
  options: { runId?: string; heartbeatMs?: number } = {},
): ReadableStream<Uint8Array> {
  const heartbeatMs = options.heartbeatMs ?? 25_000
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  let heartbeat: ReturnType<typeof setInterval> | null = null
  let closed = false

  const closeHeartbeat = () => {
    if (!heartbeat) return
    clearInterval(heartbeat)
    heartbeat = null
  }

  return new ReadableStream<Uint8Array>({
    start(controller) {
      reader = upstreamBody.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      const enqueue = (event: ChatEvent) => {
        if (closed) return
        controller.enqueue(encodeEvent(event))
      }

      heartbeat = setInterval(() => {
        enqueue({
          event: 'heartbeat',
          ...(options.runId ? { runId: options.runId, run_id: options.runId } : {}),
          timestamp: Date.now() / 1000,
          activity: 'Still polling run',
        })
      }, heartbeatMs)

      const handleBlock = (block: string) => {
        const trimmed = block.trim()
        if (!trimmed) return
        if (trimmed.startsWith(':')) {
          enqueue({
            event: 'heartbeat',
            ...(options.runId ? { runId: options.runId, run_id: options.runId } : {}),
            timestamp: Date.now() / 1000,
            activity: 'Still polling run',
          })
          return
        }

        const data = block
          .split(/\r?\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n')
        if (!data || data === '[DONE]') return

        try {
          for (const event of normalizeHermesEvent(JSON.parse(data), options.runId)) enqueue(event)
        } catch {
          enqueue({
            event: 'event',
            ...(options.runId ? { runId: options.runId, run_id: options.runId } : {}),
            timestamp: Date.now() / 1000,
            preview: data.slice(0, 500),
          })
        }
      }

      const pump = async () => {
        try {
          while (true) {
            const { done, value } = await reader!.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })
            const blocks = buffer.split(/\r?\n\r?\n/)
            buffer = blocks.pop() ?? ''
            for (const block of blocks) handleBlock(block)
          }
          buffer += decoder.decode()
          if (buffer.trim()) handleBlock(buffer)
          closed = true
          closeHeartbeat()
          controller.close()
        } catch (err) {
          closed = true
          closeHeartbeat()
          controller.error(err)
        }
      }

      void pump()
    },
    cancel() {
      closed = true
      closeHeartbeat()
      void reader?.cancel()
    },
  })
}
