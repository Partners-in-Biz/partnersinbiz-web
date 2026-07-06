'use client'

// Thin typed fetch helpers for the Book Studio admin project workspace.
// Every endpoint responds with the platform envelope { success, data } (or
// { success: false, error, ...extra } on failure) — these helpers unwrap
// `body.data ?? body` and surface a consistent { ok, data, error, extra } shape
// so components never touch raw fetch/Response objects directly.

export type BookStudioApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; status: number; extra?: Record<string, unknown> }

async function request<T>(path: string, init?: RequestInit): Promise<BookStudioApiResult<T>> {
  try {
    const res = await fetch(path, init)
    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      const { success: _success, error, ...extra } = (body ?? {}) as Record<string, unknown>
      return {
        ok: false,
        error: typeof error === 'string' ? error : 'Request failed',
        status: res.status,
        extra: Object.keys(extra).length ? extra : undefined,
      }
    }
    const data = (body?.data ?? body) as T
    return { ok: true, data }
  } catch {
    return { ok: false, error: 'Network error — could not reach Book Studio', status: 0 }
  }
}

function withOrg(path: string, orgId: string, extraParams?: Record<string, string>) {
  const params = new URLSearchParams({ orgId, ...extraParams })
  return `${path}?${params.toString()}`
}

export type BookStudioListResponse<T> = { resource: string; records: T[] }

export function listBookStudioRecords<T>(resource: 'projects' | 'chapters' | 'pages', orgId: string) {
  return request<BookStudioListResponse<T>>(withOrg(`/api/v1/book-studio/${resource}`, orgId))
}

export function createBookStudioRecord<T>(resource: 'projects' | 'chapters' | 'pages', orgId: string, payload: Record<string, unknown>) {
  return request<T>(`/api/v1/book-studio/${resource}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, orgId }),
  })
}

export function patchBookStudioRecord<T>(resource: 'projects' | 'chapters' | 'pages', id: string, orgId: string, patch: Record<string, unknown>) {
  return request<T>(withOrg(`/api/v1/book-studio/${resource}/${encodeURIComponent(id)}`, orgId), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
}

export function deleteBookStudioRecord(resource: 'projects' | 'chapters' | 'pages', id: string, orgId: string) {
  return patchBookStudioRecord(resource, id, orgId, { deleted: true })
}

export type GeneratePuzzlesPayload = {
  kind: 'sudoku' | 'word_search' | 'maze' | 'crossword'
  count: number
  difficulty: 'easy' | 'medium' | 'hard' | 'expert'
  params?: { words?: string[]; entries?: string[] }
  startOrder?: number
}

export function generateBookStudioPuzzles<T>(projectId: string, orgId: string, payload: GeneratePuzzlesPayload) {
  return request<T>(withOrg(`/api/v1/book-studio/projects/${encodeURIComponent(projectId)}/pages/generate-puzzles`, orgId), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export function openBookStudioProjectInCanvas<T>(projectId: string, orgId: string) {
  return request<T>(withOrg(`/api/v1/book-studio/projects/${encodeURIComponent(projectId)}/open-in-canvas`, orgId), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  })
}

export function assembleBookStudioProject<T>(projectId: string, orgId: string) {
  return request<T>(withOrg(`/api/v1/book-studio/projects/${encodeURIComponent(projectId)}/assemble`, orgId), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  })
}
