import type { Pipeline } from './types'

export function extractPipelinesList(body: unknown): Pipeline[] {
  if (!body || typeof body !== 'object') return []
  const data = (body as { data?: unknown }).data
  if (Array.isArray(data)) return data as Pipeline[]
  if (data && typeof data === 'object' && Array.isArray((data as { pipelines?: unknown }).pipelines)) {
    return (data as { pipelines: Pipeline[] }).pipelines
  }
  if (Array.isArray((body as { pipelines?: unknown }).pipelines)) {
    return (body as { pipelines: Pipeline[] }).pipelines
  }
  return []
}
