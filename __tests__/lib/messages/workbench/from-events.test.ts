import type { ChatEvent, RichMessagePart } from '@/lib/hermes/types'
import {
  buildWorkbenchBrowserTargets,
  buildWorkbenchChanges,
  buildWorkbenchFileTree,
  buildWorkbenchTerminalEntries,
} from '@/lib/messages/workbench/from-events'

describe('buildWorkbenchTerminalEntries', () => {
  it('skips streaming text deltas and heartbeats', () => {
    const events: ChatEvent[] = [
      { event: 'assistant.text_delta', delta: 'Hello' },
      { event: 'heartbeat' },
      { event: 'tool.started', tool: 'terminal', input: 'npm test' },
    ]
    const entries = buildWorkbenchTerminalEntries(events)
    expect(entries).toHaveLength(1)
    expect(entries[0].label).toBe('terminal')
  })

  it('correlates a tool.started entry with its later tool.completed into one done/failed row', () => {
    const events: ChatEvent[] = [
      { event: 'tool.started', tool: 'terminal' },
      { event: 'tool.completed', tool: 'terminal' },
    ]
    const entries = buildWorkbenchTerminalEntries(events)
    expect(entries).toHaveLength(1)
    expect(entries[0].status).toBe('done')
  })

  it('preserves the started command when completion only contains output', () => {
    const entries = buildWorkbenchTerminalEntries([
      { event: 'tool.started', runId: 'run-1', tool: 'terminal', input: 'npm test' },
      { event: 'tool.completed', runId: 'run-1', tool: 'terminal', output: 'PASS' },
    ])
    expect(entries).toHaveLength(1)
    expect(entries[0].body).toBe('$ npm test\nPASS')
  })

  it('uses tool call identity to correlate concurrent calls of the same tool', () => {
    const entries = buildWorkbenchTerminalEntries([
      { event: 'tool.started', runId: 'run-1', tool: 'terminal', input: 'first', raw: { toolCallId: 'a' } },
      { event: 'tool.started', runId: 'run-1', tool: 'terminal', input: 'second', raw: { toolCallId: 'b' } },
      { event: 'tool.completed', runId: 'run-1', tool: 'terminal', output: 'SECOND', raw: { toolCallId: 'b' } },
      { event: 'tool.completed', runId: 'run-1', tool: 'terminal', output: 'FIRST', raw: { toolCallId: 'a' } },
    ])
    expect(entries.map((entry) => entry.body)).toEqual(['$ first\nFIRST', '$ second\nSECOND'])
  })

  it('uses the most recent matching call as the fallback when call identity is unavailable', () => {
    const entries = buildWorkbenchTerminalEntries([
      { event: 'tool.started', runId: 'run-1', tool: 'terminal', input: 'first' },
      { event: 'tool.started', runId: 'run-1', tool: 'terminal', input: 'second' },
      { event: 'tool.completed', runId: 'run-1', tool: 'terminal', output: 'SECOND' },
      { event: 'tool.completed', runId: 'run-1', tool: 'terminal', output: 'FIRST' },
    ])
    expect(entries.map((entry) => entry.body)).toEqual(['$ first\nFIRST', '$ second\nSECOND'])
  })

  it('normalizes snake-case run ids before correlating identity-less completions', () => {
    const entries = buildWorkbenchTerminalEntries([
      { event: 'tool.started', run_id: 'run-1', tool: 'terminal', input: 'first' },
      { event: 'tool.started', run_id: 'run-2', tool: 'terminal', input: 'second' },
      { event: 'tool.completed', run_id: 'run-1', tool: 'terminal', output: 'FIRST' },
      { event: 'tool.completed', run_id: 'run-2', tool: 'terminal', output: 'SECOND' },
    ])
    expect(entries.map((entry) => entry.body)).toEqual(['$ first\nFIRST', '$ second\nSECOND'])
  })

  it('keeps unscoped completions isolated from explicitly scoped runs', () => {
    const entries = buildWorkbenchTerminalEntries([
      { event: 'tool.started', tool: 'terminal', input: 'unscoped' },
      { event: 'tool.started', runId: 'run-2', tool: 'terminal', input: 'scoped' },
      { event: 'tool.completed', tool: 'terminal', output: 'UNSCOPED' },
      { event: 'tool.completed', runId: 'run-2', tool: 'terminal', output: 'SCOPED' },
    ])
    expect(entries.map((entry) => entry.body)).toEqual(['$ unscoped\nUNSCOPED', '$ scoped\nSCOPED'])
  })

  it('classifies status from event type and error/exit code for uncorrelated events', () => {
    const events: ChatEvent[] = [
      { event: 'tool.completed', tool: 'terminal', exitCode: 1 },
      { event: 'tool.completed', tool: 'terminal', error: true },
      { event: 'reasoning.summary', text: 'Thinking' },
    ]
    const entries = buildWorkbenchTerminalEntries(events)
    expect(entries.map((entry) => entry.status)).toEqual(['failed', 'failed', 'info'])
  })

  it('builds a $ prefixed command line plus output/stderr body', () => {
    const events: ChatEvent[] = [
      { event: 'tool.completed', tool: 'terminal', input: 'ls -la', output: 'file.txt', stderr: 'warning: slow disk' },
    ]
    const [entry] = buildWorkbenchTerminalEntries(events)
    expect(entry.body).toContain('$ ls -la')
    expect(entry.body).toContain('file.txt')
    expect(entry.body).toContain('warning: slow disk')
  })

  it('includes meta with timestamp, event name, duration and exit code', () => {
    const events: ChatEvent[] = [
      { event: 'tool.completed', tool: 'terminal', timestamp: 1_700_000_000, durationMs: 240, exitCode: 0 },
    ]
    const [entry] = buildWorkbenchTerminalEntries(events)
    expect(entry.meta).toContain('tool.completed')
    expect(entry.meta).toContain('240ms')
    expect(entry.meta).toContain('exit 0')
  })

  it('keeps only the most recent 48 entries', () => {
    const events: ChatEvent[] = Array.from({ length: 60 }, (_, index) => ({
      event: 'tool.completed',
      tool: `tool-${index}`,
    }))
    const entries = buildWorkbenchTerminalEntries(events)
    expect(entries).toHaveLength(48)
    expect(entries[0].label).toBe('tool-12')
    expect(entries.at(-1)?.label).toBe('tool-59')
  })

  it('carries through the tool name and timestamp fields', () => {
    const events: ChatEvent[] = [{ event: 'tool.started', tool: 'read_file', timestamp: 1_700_000_000 }]
    const [entry] = buildWorkbenchTerminalEntries(events)
    expect(entry.tool).toBe('read_file')
    expect(entry.timestamp).toBe(1_700_000_000)
  })
})

describe('buildWorkbenchFileTree', () => {
  it('extracts extension-bearing paths from input/output/preview text', () => {
    const events: ChatEvent[] = [
      { event: 'tool.completed', tool: 'read_file', input: 'lib/messages/workbench/types.ts' },
      { event: 'tool.completed', tool: 'write_file', output: 'Wrote components/messages/workbench/AgentWorkbenchRail.tsx successfully' },
      { event: 'tool.started', tool: 'edit', preview: 'Editing app/api/route.ts' },
    ]
    const tree = buildWorkbenchFileTree(events)
    const paths = flattenPaths(tree)
    expect(paths).toContain('lib/messages/workbench/types.ts')
    expect(paths).toContain('components/messages/workbench/AgentWorkbenchRail.tsx')
    expect(paths).toContain('app/api/route.ts')
  })

  it('builds a nested tree with directories before files, sorted alphabetically', () => {
    const events: ChatEvent[] = [
      { event: 'tool.completed', tool: 'read_file', input: 'b/z.ts' },
      { event: 'tool.completed', tool: 'read_file', input: 'b/a.ts' },
      { event: 'tool.completed', tool: 'read_file', input: 'a.ts' },
    ]
    const tree = buildWorkbenchFileTree(events)
    expect(tree.map((node) => node.name)).toEqual(['b', 'a.ts'])
    expect(tree[0].kind).toBe('directory')
    expect(tree[0].children?.map((node) => node.name)).toEqual(['a.ts', 'z.ts'])
  })

  it('deduplicates repeated paths', () => {
    const events: ChatEvent[] = [
      { event: 'tool.completed', tool: 'read_file', input: 'lib/foo.ts' },
      { event: 'tool.completed', tool: 'read_file', input: 'lib/foo.ts' },
    ]
    const tree = buildWorkbenchFileTree(events)
    expect(flattenPaths(tree)).toEqual(['lib/foo.ts'])
  })

  it('treats read/write/edit/ls tool input as a path hint even without an extension', () => {
    const events: ChatEvent[] = [
      { event: 'tool.completed', tool: 'ls', input: 'src/components' },
      { event: 'tool.completed', tool: 'list_dir', input: 'src/lib' },
    ]
    const tree = buildWorkbenchFileTree(events)
    expect(tree).toHaveLength(1)
    expect(tree[0]).toMatchObject({ name: 'src', kind: 'directory' })
    expect(tree[0].children).toEqual([
      expect.objectContaining({ path: 'src/components', kind: 'directory' }),
      expect.objectContaining({ path: 'src/lib', kind: 'directory' }),
    ])
  })

  it('extracts a "path" JSON key hint from structured tool input', () => {
    const events: ChatEvent[] = [
      { event: 'tool.completed', tool: 'apply_patch', input: '{"path": "src/utils/helpers.ts", "content": "..."}' },
    ]
    const tree = buildWorkbenchFileTree(events)
    expect(flattenPaths(tree)).toContain('src/utils/helpers.ts')
  })

  it('ignores unrelated prose and tools with no path-like content', () => {
    const events: ChatEvent[] = [
      { event: 'assistant.text_delta', delta: 'Thinking about the plan for a moment...' },
      { event: 'tool.completed', tool: 'web_search', output: 'Found 12 relevant results across 3 domains' },
    ]
    expect(buildWorkbenchFileTree(events)).toEqual([])
  })

  it('normalizes absolute paths and keeps a nested structure', () => {
    const events: ChatEvent[] = [
      { event: 'tool.completed', tool: 'read_file', input: '/Users/dev/project/src/index.ts' },
    ]
    const tree = buildWorkbenchFileTree(events)
    expect(flattenPaths(tree)).toEqual(['/Users/dev/project/src/index.ts'])
  })

  it('returns an empty tree for no events', () => {
    expect(buildWorkbenchFileTree([])).toEqual([])
  })
})

describe('buildWorkbenchChanges', () => {
  it('derives added/modified/deleted/renamed status from write/edit/delete/rename-style tool names', () => {
    const events: ChatEvent[] = [
      { event: 'tool.completed', tool: 'create_file', input: 'src/new-feature.ts' },
      { event: 'tool.completed', tool: 'edit_file', input: 'src/existing.ts' },
      { event: 'tool.completed', tool: 'delete_file', input: 'src/old.ts' },
      { event: 'tool.completed', tool: 'rename_file', input: 'src/renamed.ts' },
    ]
    const changes = buildWorkbenchChanges(events)
    const byPath = Object.fromEntries(changes.map((change) => [change.path, change.status]))
    expect(byPath['src/new-feature.ts']).toBe('added')
    expect(byPath['src/existing.ts']).toBe('modified')
    expect(byPath['src/old.ts']).toBe('deleted')
    expect(byPath['src/renamed.ts']).toBe('renamed')
  })

  it('captures a preview of tool output for changed files', () => {
    const events: ChatEvent[] = [
      { event: 'tool.completed', tool: 'write_file', input: 'src/config.ts', output: 'export const config = {}' },
    ]
    const [change] = buildWorkbenchChanges(events)
    expect(change.path).toBe('src/config.ts')
    expect(change.preview).toContain('export const config')
  })

  it('parses a fenced ```diff block and infers the path, treating /dev/null as added', () => {
    const diffBlock = [
      '```diff',
      'diff --git a/src/foo.ts b/src/foo.ts',
      '--- /dev/null',
      '+++ b/src/foo.ts',
      '@@ -0,0 +1,2 @@',
      '+export const foo = 1',
      '+export const bar = 2',
      '```',
    ].join('\n')
    const events: ChatEvent[] = [{ event: 'tool.completed', tool: 'apply_patch', output: diffBlock }]
    const changes = buildWorkbenchChanges(events)
    expect(changes).toHaveLength(1)
    expect(changes[0].path).toBe('src/foo.ts')
    expect(changes[0].status).toBe('added')
    expect(changes[0].patch).toContain('@@ -0,0 +1,2 @@')
  })

  it('treats a +++ /dev/null diff as deleted', () => {
    const diffBlock = [
      '```diff',
      '--- a/src/gone.ts',
      '+++ /dev/null',
      '@@ -1,2 +0,0 @@',
      '-export const gone = true',
      '```',
    ].join('\n')
    const events: ChatEvent[] = [{ event: 'tool.completed', tool: 'apply_patch', output: diffBlock }]
    const changes = buildWorkbenchChanges(events)
    expect(changes).toHaveLength(1)
    expect(changes[0].path).toBe('src/gone.ts')
    expect(changes[0].status).toBe('deleted')
  })

  it('parses raw unified diff text without a fence', () => {
    const rawDiff = [
      '--- a/src/plain.ts',
      '+++ b/src/plain.ts',
      '@@ -1 +1 @@',
      '-old',
      '+new',
    ].join('\n')
    const events: ChatEvent[] = [{ event: 'tool.completed', tool: 'apply_patch', output: rawDiff }]
    const changes = buildWorkbenchChanges(events)
    expect(changes).toHaveLength(1)
    expect(changes[0].path).toBe('src/plain.ts')
    expect(changes[0].status).toBe('modified')
  })

  it('merges tool-derived and diff-derived entries for the same path, sorted by path', () => {
    const events: ChatEvent[] = [
      { event: 'tool.completed', tool: 'edit_file', input: 'src/b.ts' },
      { event: 'tool.completed', tool: 'edit_file', input: 'src/a.ts', output: '```diff\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-x\n+y\n```' },
    ]
    const changes = buildWorkbenchChanges(events)
    expect(changes.map((change) => change.path)).toEqual(['src/a.ts', 'src/b.ts'])
    expect(changes[0].patch).toContain('@@ -1 +1 @@')
  })

  it('returns an empty list when nothing looks like a change', () => {
    const events: ChatEvent[] = [{ event: 'tool.completed', tool: 'web_search', output: 'no file paths here' }]
    expect(buildWorkbenchChanges(events)).toEqual([])
  })
})

describe('buildWorkbenchBrowserTargets', () => {
  it('extracts http(s) URLs from event input/output/preview', () => {
    const events: ChatEvent[] = [
      { event: 'tool.completed', tool: 'browser_navigate', input: 'https://partnersinbiz.online/dashboard' },
    ]
    const targets = buildWorkbenchBrowserTargets(events)
    expect(targets).toHaveLength(1)
    expect(targets[0].url).toBe('https://partnersinbiz.online/dashboard')
    expect(targets[0].source).toBe('event')
  })

  it('strips trailing punctuation from URLs found in prose', () => {
    const events: ChatEvent[] = [
      { event: 'tool.completed', tool: 'fetch', output: 'See https://example.com/page.' },
    ]
    const [target] = buildWorkbenchBrowserTargets(events)
    expect(target.url).toBe('https://example.com/page')
  })

  it('deduplicates repeated URLs across events', () => {
    const events: ChatEvent[] = [
      { event: 'tool.started', tool: 'browser_navigate', input: 'https://example.com' },
      { event: 'tool.completed', tool: 'browser_navigate', output: 'https://example.com' },
    ]
    expect(buildWorkbenchBrowserTargets(events)).toHaveLength(1)
  })

  it('includes image rich parts as browser targets', () => {
    const richParts: RichMessagePart[] = [
      { type: 'image', id: 'img-1', url: 'https://cdn.example.com/screenshot.png', caption: 'Homepage' },
    ]
    const targets = buildWorkbenchBrowserTargets([], richParts)
    expect(targets).toHaveLength(1)
    expect(targets[0].imageUrl).toBe('https://cdn.example.com/screenshot.png')
    expect(targets[0].source).toBe('rich_part')
  })

  it('flattens gallery rich parts into one target per image', () => {
    const richParts: RichMessagePart[] = [
      {
        type: 'gallery',
        id: 'gallery-1',
        images: [
          { url: 'https://cdn.example.com/a.png' },
          { url: 'https://cdn.example.com/b.png' },
        ],
      },
    ]
    const targets = buildWorkbenchBrowserTargets([], richParts)
    expect(targets).toHaveLength(2)
    expect(targets.map((target) => target.imageUrl)).toEqual([
      'https://cdn.example.com/a.png',
      'https://cdn.example.com/b.png',
    ])
  })

  it('includes http(s) file rich parts as attachment-sourced targets', () => {
    const richParts: RichMessagePart[] = [
      { type: 'file', id: 'file-1', url: 'https://cdn.example.com/report.pdf', name: 'report.pdf' },
    ]
    const targets = buildWorkbenchBrowserTargets([], richParts)
    expect(targets).toHaveLength(1)
    expect(targets[0].source).toBe('attachment')
  })

  it('ignores non-http file rich parts', () => {
    const richParts: RichMessagePart[] = [
      { type: 'file', id: 'file-1', url: 'storage://internal/report.pdf', name: 'report.pdf' },
    ]
    expect(buildWorkbenchBrowserTargets([], richParts)).toEqual([])
  })

  it('returns an empty list when there is no browser-relevant activity', () => {
    expect(buildWorkbenchBrowserTargets([{ event: 'tool.completed', tool: 'read_file', input: 'src/a.ts' }])).toEqual([])
  })
})

function flattenPaths(nodes: ReturnType<typeof buildWorkbenchFileTree>): string[] {
  const paths: string[] = []
  const visit = (list: typeof nodes) => {
    for (const node of list) {
      if (node.kind === 'file') paths.push(node.path)
      if (node.children) visit(node.children)
    }
  }
  visit(nodes)
  return paths.sort()
}
