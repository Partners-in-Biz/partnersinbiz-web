export function extractSegmentsList<TSegment = unknown>(body: unknown): TSegment[] {
  if (!body || typeof body !== 'object') return []
  const data = (body as { data?: unknown }).data
  if (Array.isArray(data)) return data as TSegment[]
  if (data && typeof data === 'object' && Array.isArray((data as { segments?: unknown }).segments)) {
    return (data as { segments: TSegment[] }).segments
  }
  return []
}
