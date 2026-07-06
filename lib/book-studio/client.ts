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

export type BookStudioSurface = 'admin' | 'portal'
export type BookStudioResourcePath = 'projects' | 'chapters' | 'pages' | 'briefs' | 'series'

export function bookStudioApiPath(
  surface: BookStudioSurface,
  resource: BookStudioResourcePath,
  orgId: string,
  id?: string,
) {
  const idPart = id === undefined ? '' : `/${encodeURIComponent(id)}`
  if (surface === 'portal') return `/api/v1/portal/book-studio/${resource}${idPart}`
  return `/api/v1/book-studio/${resource}${idPart}?${new URLSearchParams({ orgId }).toString()}`
}

export type BookStudioListResponse<T> = { resource: string; records: T[] }

export function listBookStudioRecords<T>(
  resource: BookStudioResourcePath,
  orgId: string,
  surface: BookStudioSurface = 'admin',
) {
  return request<BookStudioListResponse<T>>(bookStudioApiPath(surface, resource, orgId))
}

export function createBookStudioRecord<T>(
  resource: BookStudioResourcePath,
  orgId: string,
  payload: Record<string, unknown>,
  surface: BookStudioSurface = 'admin',
) {
  return request<T>(bookStudioApiPath(surface, resource, orgId), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(surface === 'admin' ? { ...payload, orgId } : payload),
  })
}

export function patchBookStudioRecord<T>(
  resource: BookStudioResourcePath,
  id: string,
  orgId: string,
  patch: Record<string, unknown>,
  surface: BookStudioSurface = 'admin',
) {
  return request<T>(bookStudioApiPath(surface, resource, orgId, id), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
}

export function deleteBookStudioRecord(
  resource: BookStudioResourcePath,
  id: string,
  orgId: string,
  surface: BookStudioSurface = 'admin',
) {
  return patchBookStudioRecord(resource, id, orgId, { deleted: true }, surface)
}

export type GeneratePuzzlesPayload = {
  kind: 'sudoku' | 'word_search' | 'maze' | 'crossword'
  count: number
  difficulty: 'easy' | 'medium' | 'hard' | 'expert'
  params?: { words?: string[]; entries?: { word: string; clue: string }[] }
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
