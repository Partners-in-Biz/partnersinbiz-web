export type WorkspacePanelMetric = {
  label: string
  value: string
  detail?: string
}

export type WorkspacePanelSection = {
  heading?: string
  body?: string
  items?: string[]
}

export type WorkspacePanelSpec = {
  type: 'workspace_panel'
  id: string
  title: string
  eyebrow?: string
  body?: string
  metrics: WorkspacePanelMetric[]
  sections: WorkspacePanelSection[]
  columns: string[]
  rows: string[][]
}

function text(value: unknown, maximum: number): string {
  if (typeof value !== 'string') return ''
  return value.trim().slice(0, maximum)
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function panelId(value: unknown, title: string): string {
  const supplied = text(value, 128).replace(/[^A-Za-z0-9._:-]/g, '-')
  if (supplied) return supplied
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80)
  return slug || 'generated-workspace-panel'
}

/**
 * Converts agent-authored structured data into a deliberately small UI DSL.
 * It never accepts HTML, scripts, styles, component names, or executable actions.
 */
export function normalizeWorkspacePanel(value: unknown): WorkspacePanelSpec | null {
  const source = record(value)
  if (!source) return null
  const title = text(source.title, 120)
  if (!title) return null
  const metrics = (Array.isArray(source.metrics) ? source.metrics : [])
    .slice(0, 8)
    .flatMap((item): WorkspacePanelMetric[] => {
      const metric = record(item)
      if (!metric) return []
      const label = text(metric.label, 80)
      const metricValue = text(metric.value, 120)
      return label && metricValue ? [{ label, value: metricValue, detail: text(metric.detail, 160) || undefined }] : []
    })
  const sections = (Array.isArray(source.sections) ? source.sections : [])
    .slice(0, 12)
    .flatMap((item): WorkspacePanelSection[] => {
      const section = record(item)
      if (!section) return []
      const heading = text(section.heading ?? section.title, 100)
      const body = text(section.body ?? section.content, 4_000)
      const items = (Array.isArray(section.items) ? section.items : [])
        .map((entry) => text(entry, 500))
        .filter(Boolean)
        .slice(0, 20)
      return heading || body || items.length ? [{ heading: heading || undefined, body: body || undefined, items }] : []
    })
  const columns = (Array.isArray(source.columns) ? source.columns : [])
    .map((column) => text(column, 80))
    .filter(Boolean)
    .slice(0, 12)
  const rows = (Array.isArray(source.rows) ? source.rows : [])
    .slice(0, 100)
    .map((row) => {
      if (Array.isArray(row)) return row.slice(0, Math.max(columns.length, 12)).map((cell) => text(String(cell ?? ''), 500))
      const rowRecord = record(row)
      if (!rowRecord) return [text(String(row ?? ''), 500)]
      return columns.length
        ? columns.map((column) => text(String(rowRecord[column] ?? ''), 500))
        : Object.values(rowRecord).slice(0, 12).map((cell) => text(String(cell ?? ''), 500))
    })
  return {
    type: 'workspace_panel',
    id: panelId(source.id, title),
    title,
    eyebrow: text(source.eyebrow, 80) || undefined,
    body: text(source.body ?? source.content, 8_000) || undefined,
    metrics,
    sections,
    columns,
    rows,
  }
}

export const WORKSPACE_PANEL_EVENT = 'pib:open-workspace-panel'
