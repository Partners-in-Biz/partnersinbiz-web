import type { BrandProfile } from '@/lib/organizations/types'
import { sanitizeEditorTimeline, validateEditorTimeline } from './sanitize'
import type { ActorType, EditorTimeline, EditorTrack } from './types'

export const VIDEO_EDITOR_TEMPLATE_CATEGORIES = ['intro', 'outro', 'lower_third', 'caption_style', 'end_screen'] as const
export type VideoEditorTemplateCategory = (typeof VIDEO_EDITOR_TEMPLATE_CATEGORIES)[number]

export const PLATFORM_TEMPLATE_ORG = 'platform'

export interface VideoEditorTemplate {
  id?: string
  orgId: string
  category: VideoEditorTemplateCategory
  title: string
  description?: string
  fragment: EditorTimeline
  deleted: boolean
  createdBy?: string
  createdByType?: ActorType
  createdAt?: unknown
  updatedAt?: unknown
}

export interface TemplateVariableContext {
  brand?: BrandProfile
  brandColors?: {
    primary?: string
    secondary?: string
    accent?: string
  }
  channelTitle?: string
  orgName?: string
}

function variableMap(ctx: TemplateVariableContext): Record<string, string> {
  const colors = {
    primary: ctx.brand?.colors?.primary ?? ctx.brandColors?.primary,
    secondary: ctx.brand?.colors?.secondary ?? ctx.brandColors?.secondary,
    accent: ctx.brand?.colors?.accent ?? ctx.brandColors?.accent,
  }
  return {
    '{{brand.primaryColor}}': colors?.primary ?? '#ffffff',
    '{{brand.secondaryColor}}': colors?.secondary ?? '#000000',
    '{{brand.accentColor}}': colors?.accent ?? '#7c3aed',
    '{{brand.font}}': ctx.brand?.fonts?.heading ?? 'Inter',
    '{{brand.bodyFont}}': ctx.brand?.fonts?.body ?? 'Inter',
    '{{brand.logoUrl}}': ctx.brand?.logoUrl ?? '',
    '{{brand.tagline}}': ctx.brand?.tagline ?? '',
    '{{channel.title}}': ctx.channelTitle ?? ctx.orgName ?? '',
    '{{org.name}}': ctx.orgName ?? '',
  }
}

function substitute(value: string, vars: Record<string, string>): string {
  let result = value
  for (const [token, replacement] of Object.entries(vars)) result = result.split(token).join(replacement)
  return result
}

export function resolveTemplateVariables(fragment: EditorTimeline, ctx: TemplateVariableContext): EditorTimeline {
  const vars = variableMap(ctx)
  const walk = (value: unknown): unknown => {
    if (typeof value === 'string') return substitute(value, vars)
    if (Array.isArray(value)) return value.map(walk)
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, walk(entry)]))
    }
    return value
  }
  return walk(fragment) as EditorTimeline
}

function freshId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000
}

export function extractSelectionFragment(timeline: EditorTimeline, trackId: string, clipIds: string[]): EditorTimeline {
  const track = timeline.tracks.find((entry) => entry.id === trackId)
  const clips = (track?.clips ?? []).filter((clip) => clipIds.includes(clip.id))
  if (!track || !clips.length) return { version: 1, tracks: [] }
  const offset = Math.min(...clips.map((clip) => clip.timelineStart))
  const groupIds = new Map<string, string>()
  return {
    version: 1,
    tracks: [{
      id: freshId('tpl-track'),
      kind: track.kind,
      ...(track.label ? { label: track.label } : {}),
      clips: clips.map((clip) => ({
        ...clone(clip),
        id: freshId('tpl-clip'),
        groupId: clip.groupId ? (groupIds.get(clip.groupId) ?? groupIds.set(clip.groupId, freshId('tpl-group')).get(clip.groupId)) : undefined,
        timelineStart: round3(clip.timelineStart - offset),
      })),
    }],
  }
}

export function insertFragment(timeline: EditorTimeline, fragment: EditorTimeline, atSeconds: number): EditorTimeline {
  let tracks: EditorTrack[] = timeline.tracks.map((track) => ({ ...track, clips: [...track.clips] }))
  const groupIds = new Map<string, string>()
  for (const fragmentTrack of fragment.tracks) {
    const clips = fragmentTrack.clips.map((clip) => ({
      ...clone(clip),
      id: freshId('clip'),
      groupId: clip.groupId ? (groupIds.get(clip.groupId) ?? groupIds.set(clip.groupId, freshId('group')).get(clip.groupId)) : undefined,
      timelineStart: round3(clip.timelineStart + Math.max(0, atSeconds)),
    }))
    const hasRoom = (track: EditorTrack) => clips.every((clip) =>
      !track.clips.some((existing) => clip.timelineStart < existing.timelineStart + existing.duration
        && clip.timelineStart + clip.duration > existing.timelineStart))
    const target = tracks.find((track) => track.kind === fragmentTrack.kind && !track.locked && hasRoom(track))
    if (target) {
      target.clips = [...target.clips, ...clips].sort((a, b) => a.timelineStart - b.timelineStart)
    } else {
      tracks = [...tracks, { id: freshId('track'), kind: fragmentTrack.kind, ...(fragmentTrack.label ? { label: fragmentTrack.label } : {}), clips }]
    }
  }
  const next = { version: 1 as const, tracks }
  const issues = validateEditorTimeline(next)
  if (issues.length) throw new Error(`Inserted fragment would create an invalid timeline: ${issues[0].message}`)
  return next
}

export function sanitizeVideoEditorTemplateInput(input: Record<string, unknown>): Omit<VideoEditorTemplate, 'id'> {
  const orgId = typeof input.orgId === 'string' && input.orgId.trim() ? input.orgId.trim() : ''
  const title = typeof input.title === 'string' && input.title.trim() ? input.title.trim() : ''
  if (!orgId) throw new Error('orgId is required')
  if (!title) throw new Error('title is required')
  if (!VIDEO_EDITOR_TEMPLATE_CATEGORIES.includes(input.category as VideoEditorTemplateCategory)) {
    throw new Error(`category must be one of ${VIDEO_EDITOR_TEMPLATE_CATEGORIES.join(', ')}`)
  }
  const fragment = sanitizeEditorTimeline(input.fragment)
  if (!fragment.tracks.some((track) => track.clips.length > 0)) throw new Error('fragment must contain at least one clip')
  const issues = validateEditorTimeline(fragment)
  if (issues.length) throw new Error(`fragment is invalid: ${issues[0].message}`)
  const description = typeof input.description === 'string' && input.description.trim() ? input.description.trim() : undefined
  return {
    orgId,
    category: input.category as VideoEditorTemplateCategory,
    title,
    ...(description ? { description } : {}),
    fragment,
    deleted: false,
  }
}
