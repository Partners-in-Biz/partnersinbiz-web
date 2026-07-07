import {
  TimelineOpError,
  addClip,
  addTrack,
  clearClipGroup,
  groupMembers,
  moveClip,
  moveClipGroup,
  removeClip,
  removeClipGroup,
  removeTrack,
  reorderTracks,
  setClipGroup,
  splitClip,
  trimClip,
} from '@/lib/video-editor/timeline-ops'
import type { EditorClip, EditorTimeline } from '@/lib/video-editor/types'

function clip(id: string, start: number, duration: number, extra: Partial<EditorClip> = {}): EditorClip {
  return {
    id,
    timelineStart: start,
    duration,
    media: { type: 'upload', fileId: `file-${id}`, url: `https://x.test/${id}.mp4`, mediaKind: 'video' },
    ...extra,
  }
}

function baseTimeline(): EditorTimeline {
  return {
    version: 1,
    tracks: [
      { id: 't1', kind: 'video', label: 'V1', clips: [clip('a', 0, 4), clip('b', 4, 3)] },
      { id: 't2', kind: 'audio', label: 'A1', clips: [] },
    ],
  }
}

describe('track ops', () => {
  it('adds, removes and reorders tracks without mutating the input', () => {
    const input = baseTimeline()
    const added = addTrack(input, { kind: 'overlay', label: 'Overlay', index: 0 })
    expect(input.tracks).toHaveLength(2)
    expect(added.tracks[0]).toMatchObject({ kind: 'overlay', label: 'Overlay', clips: [] })
    expect(new Set(added.tracks.map((track) => track.id)).size).toBe(3)

    const removed = removeTrack(added, added.tracks[0].id)
    expect(removed.tracks.map((track) => track.id)).toEqual(['t1', 't2'])
    expect(() => removeTrack(baseTimeline(), 'missing')).toThrow(TimelineOpError)

    expect(reorderTracks(baseTimeline(), 't2', 0).tracks.map((track) => track.id)).toEqual(['t2', 't1'])
    expect(reorderTracks(baseTimeline(), 't1', 99).tracks.map((track) => track.id)).toEqual(['t2', 't1'])
  })
})

describe('addClip / removeClip', () => {
  it('inserts sorted clips, allows abutting clips and rejects overlaps', () => {
    const next = addClip(baseTimeline(), 't1', clip('c', 7, 2))
    expect(next.tracks[0].clips.map((item) => item.id)).toEqual(['a', 'b', 'c'])
    expect(addClip(baseTimeline(), 't1', clip('c', 7, 1)).tracks[0].clips).toHaveLength(3)
    expect(() => addClip(baseTimeline(), 't1', clip('c', 3, 2))).toThrow(TimelineOpError)
    expect(() => addClip(baseTimeline(), 't1', clip('a', 8, 1))).toThrow('already exists')
  })

  it('removes a clip and throws for unknown ids', () => {
    const next = removeClip(baseTimeline(), 't1', 'a')
    expect(next.tracks[0].clips.map((item) => item.id)).toEqual(['b'])
    expect(() => removeClip(baseTimeline(), 't1', 'zzz')).toThrow(TimelineOpError)
    expect(() => removeClip(baseTimeline(), 'zzz', 'a')).toThrow(TimelineOpError)
  })
})

describe('moveClip', () => {
  it('moves within and across compatible tracks', () => {
    const next = moveClip(baseTimeline(), 't1', 'a', { toStart: 8 })
    expect(next.tracks[0].clips.map((item) => item.id)).toEqual(['b', 'a'])
    expect(next.tracks[0].clips[1].timelineStart).toBe(8)

    const timeline: EditorTimeline = {
      version: 1,
      tracks: [
        { id: 't1', kind: 'video', clips: [clip('a', 0, 4)] },
        { id: 't3', kind: 'video', clips: [] },
      ],
    }
    const moved = moveClip(timeline, 't1', 'a', { toStart: 1, targetTrackId: 't3' })
    expect(moved.tracks[0].clips).toHaveLength(0)
    expect(moved.tracks[1].clips[0]).toMatchObject({ id: 'a', timelineStart: 1 })
  })

  it('rejects overlapping and incompatible moves', () => {
    expect(() => moveClip(baseTimeline(), 't1', 'b', { toStart: 2 })).toThrow(TimelineOpError)
    expect(() => moveClip(baseTimeline(), 't1', 'b', { toStart: -5 })).toThrow(TimelineOpError)
    expect(() => moveClip(baseTimeline(), 't1', 'a', { toStart: 0, targetTrackId: 't2' })).toThrow(TimelineOpError)
  })
})

describe('trimClip', () => {
  it('trims the end and start with speed-aware trimStart', () => {
    const end = trimClip(baseTimeline(), 't1', 'a', { edge: 'end', deltaSeconds: -1 })
    expect(end.tracks[0].clips[0]).toMatchObject({ id: 'a', timelineStart: 0, duration: 3 })

    const timeline: EditorTimeline = {
      version: 1,
      tracks: [{ id: 't1', kind: 'video', clips: [clip('a', 2, 4, { trimStart: 1, speed: 2 })] }],
    }
    const start = trimClip(timeline, 't1', 'a', { edge: 'start', deltaSeconds: 1 })
    expect(start.tracks[0].clips[0]).toMatchObject({ timelineStart: 3, duration: 3, trimStart: 3 })
  })

  it('rejects trims that remove, rewind or overlap clips', () => {
    expect(() => trimClip(baseTimeline(), 't1', 'a', { edge: 'end', deltaSeconds: -4 })).toThrow(TimelineOpError)
    expect(() => trimClip(baseTimeline(), 't1', 'b', { edge: 'start', deltaSeconds: -1 })).toThrow(TimelineOpError)
    expect(() => trimClip(baseTimeline(), 't1', 'a', { edge: 'end', deltaSeconds: 1 })).toThrow(TimelineOpError)
  })
})

describe('splitClip', () => {
  it('splits media and text clips while preserving right-edge transitions', () => {
    const timeline: EditorTimeline = {
      version: 1,
      tracks: [{ id: 't1', kind: 'video', clips: [clip('a', 2, 4, { trimStart: 1, speed: 2, transitionAfter: { kind: 'crossfade', duration: 1 } })] }],
    }
    const next = splitClip(timeline, 't1', 'a', 3)
    const [left, right] = next.tracks[0].clips
    expect(left).toMatchObject({ id: 'a', timelineStart: 2, duration: 1, trimStart: 1, speed: 2 })
    expect(left.transitionAfter).toBeUndefined()
    expect(right).toMatchObject({ id: 'a-s1', timelineStart: 3, duration: 3, trimStart: 3, speed: 2 })
    expect(right.transitionAfter).toEqual({ kind: 'crossfade', duration: 1 })

    const textTimeline: EditorTimeline = {
      version: 1,
      tracks: [{
        id: 't1',
        kind: 'text',
        clips: [{ id: 'x', timelineStart: 0, duration: 4, text: { content: 'Hi', fontSizePx: 48, color: '#fff', align: 'center', animationPreset: 'none' } }],
      }],
    }
    const text = splitClip(textTimeline, 't1', 'x', 1)
    expect(text.tracks[0].clips.map((item) => item.duration)).toEqual([1, 3])
    expect(text.tracks[0].clips[1].text?.content).toBe('Hi')
  })

  it('rejects exterior splits and generates unique ids', () => {
    expect(() => splitClip(baseTimeline(), 't1', 'a', 0)).toThrow(TimelineOpError)
    expect(() => splitClip(baseTimeline(), 't1', 'a', 4)).toThrow(TimelineOpError)
    const once = splitClip(baseTimeline(), 't1', 'a', 2)
    const twice = splitClip(once, 't1', 'a', 1)
    const ids = twice.tracks[0].clips.map((item) => item.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

function groupedTimeline(): EditorTimeline {
  return {
    version: 1,
    tracks: [
      { id: 'v1', kind: 'video', clips: [clip('a', 0, 4), clip('b', 4, 3)] },
      { id: 'a1', kind: 'audio', clips: [clip('m', 0, 4, { media: { type: 'upload', fileId: 'file-m', url: 'https://x.test/m.mp3', mediaKind: 'audio' } })] },
    ],
  }
}

describe('linked clip groups', () => {
  it('links clips across tracks under one groupId and lists members', () => {
    const linked = setClipGroup(groupedTimeline(), [
      { trackId: 'v1', clipId: 'a' },
      { trackId: 'a1', clipId: 'm' },
    ])
    const groupId = linked.tracks[0].clips[0].groupId
    expect(groupId).toBeTruthy()
    expect(linked.tracks[1].clips[0].groupId).toBe(groupId)
    expect(groupMembers(linked, groupId!)).toEqual([
      { trackId: 'v1', clipId: 'a' },
      { trackId: 'a1', clipId: 'm' },
    ])
    const cleared = clearClipGroup(linked, groupId!)
    expect(cleared.tracks[0].clips[0].groupId).toBeUndefined()
    expect(cleared.tracks[1].clips[0].groupId).toBeUndefined()
  })

  it('rejects linking fewer than two clips or unknown clips', () => {
    expect(() => setClipGroup(groupedTimeline(), [{ trackId: 'v1', clipId: 'a' }])).toThrow(TimelineOpError)
    expect(() => setClipGroup(groupedTimeline(), [
      { trackId: 'v1', clipId: 'a' },
      { trackId: 'v1', clipId: 'nope' },
    ])).toThrow(TimelineOpError)
  })

  it('moves every member by the same delta and rejects collisions atomically', () => {
    const linked = setClipGroup(groupedTimeline(), [
      { trackId: 'v1', clipId: 'a' },
      { trackId: 'a1', clipId: 'm' },
    ])
    const groupId = linked.tracks[0].clips[0].groupId!
    const moved = moveClipGroup(linked, groupId, 10)
    expect(moved.tracks[0].clips.find((c) => c.id === 'a')?.timelineStart).toBe(10)
    expect(moved.tracks[1].clips[0].timelineStart).toBe(10)
    // moving left below zero clamps as a whole-group error, not per clip
    expect(() => moveClipGroup(linked, groupId, -1)).toThrow(TimelineOpError)
    // collision with clip b on v1 rejects the whole move
    expect(() => moveClipGroup(linked, groupId, 1)).toThrow(TimelineOpError)
  })

  it('removes all group members at once', () => {
    const linked = setClipGroup(groupedTimeline(), [
      { trackId: 'v1', clipId: 'a' },
      { trackId: 'a1', clipId: 'm' },
    ])
    const groupId = linked.tracks[0].clips[0].groupId!
    const removed = removeClipGroup(linked, groupId)
    expect(removed.tracks[0].clips.map((c) => c.id)).toEqual(['b'])
    expect(removed.tracks[1].clips).toHaveLength(0)
    expect(() => removeClipGroup(groupedTimeline(), 'missing-group')).toThrow(TimelineOpError)
  })
})
