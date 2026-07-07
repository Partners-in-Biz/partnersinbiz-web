import {
  VIDEO_EDITOR_TEMPLATE_CATEGORIES,
  extractSelectionFragment,
  insertFragment,
  resolveTemplateVariables,
  sanitizeVideoEditorTemplateInput,
} from '@/lib/video-editor/templates'
import type { EditorTimeline } from '@/lib/video-editor/types'

const fragment: EditorTimeline = {
  version: 1,
  tracks: [{
    id: 'tpl-text',
    kind: 'text',
    clips: [{
      id: 'tpl-c1',
      timelineStart: 0,
      duration: 3,
      text: { content: '{{channel.title}} - subscribe!', fontSizePx: 64, fontFamily: '{{brand.font}}', color: '{{brand.primaryColor}}', align: 'center', animationPreset: 'fade_in' },
    }],
  }],
}

describe('template variables', () => {
  it('resolves brand + channel variables in text payloads', () => {
    const resolved = resolveTemplateVariables(fragment, {
      brand: { colors: { primary: '#ff5500' }, fonts: { heading: 'Sora' } },
      channelTitle: 'Acme Films',
      orgName: 'Acme',
    })
    const text = resolved.tracks[0].clips[0].text!
    expect(text.content).toBe('Acme Films - subscribe!')
    expect(text.color).toBe('#ff5500')
    expect(text.fontFamily).toBe('Sora')
  })

  it('falls back to defaults for missing brand values', () => {
    const resolved = resolveTemplateVariables(fragment, { orgName: 'Acme' })
    const text = resolved.tracks[0].clips[0].text!
    expect(text.content).toBe('Acme - subscribe!')
    expect(text.color).toBe('#ffffff')
    expect(text.fontFamily).toBe('Inter')
  })

  it('resolves existing organization settings brandColors and preserves unknown tokens', () => {
    const unresolved: EditorTimeline = {
      version: 1,
      tracks: [{
        id: 'tpl-text',
        kind: 'text',
        clips: [{
          id: 'tpl-c',
          timelineStart: 0,
          duration: 3,
          text: { content: '{{unknown.token}}', fontSizePx: 64, color: '{{brand.primaryColor}}', align: 'center', animationPreset: 'none' },
        }],
      }],
    }
    const resolved = resolveTemplateVariables(unresolved, { brandColors: { primary: '#123456' }, orgName: 'Acme' })
    expect(resolved.tracks[0].clips[0].text?.content).toBe('{{unknown.token}}')
    expect(resolved.tracks[0].clips[0].text?.color).toBe('#123456')
  })

  it('merges brand profile colors with settings brandColors per key', () => {
    const secondary: EditorTimeline = {
      version: 1,
      tracks: [{
        id: 'tpl-text',
        kind: 'text',
        clips: [{
          id: 'tpl-c',
          timelineStart: 0,
          duration: 3,
          text: { content: 'Brand', fontSizePx: 64, color: '{{brand.secondaryColor}}', backgroundColor: '{{brand.accentColor}}', align: 'center', animationPreset: 'none' },
        }],
      }],
    }
    const resolved = resolveTemplateVariables(secondary, {
      brand: { colors: { secondary: '#00ff00' } },
      brandColors: { secondary: '#111111', accent: '#222222' },
    })
    expect(resolved.tracks[0].clips[0].text?.color).toBe('#00ff00')
    expect(resolved.tracks[0].clips[0].text?.backgroundColor).toBe('#222222')
  })
})

describe('fragment extract/insert', () => {
  const timeline: EditorTimeline = {
    version: 1,
    tracks: [
      { id: 't-text', kind: 'text', clips: [{ id: 'c-a', timelineStart: 10, duration: 3, text: { content: 'Hi', fontSizePx: 48, color: '#fff', align: 'center', animationPreset: 'none' } }] },
      { id: 't-video', kind: 'video', clips: [] },
    ],
  }

  it('extracts selected clips normalized to t=0', () => {
    const extracted = extractSelectionFragment(timeline, 't-text', ['c-a'])
    expect(extracted.tracks).toHaveLength(1)
    expect(extracted.tracks[0].kind).toBe('text')
    expect(extracted.tracks[0].clips[0].timelineStart).toBe(0)
  })

  it('inserts a fragment at an offset with fresh clip ids, merging by track kind', () => {
    const next = insertFragment(timeline, fragment, 20)
    const textTrack = next.tracks.find((track) => track.kind === 'text')!
    expect(textTrack.clips).toHaveLength(2)
    const inserted = textTrack.clips.find((clip) => clip.timelineStart === 20)!
    expect(inserted.id).not.toBe('tpl-c1')
    expect(inserted.duration).toBe(3)
  })

  it('remaps group ids and deep-clones nested clip payloads on insertion', () => {
    const linked: EditorTimeline = {
      version: 1,
      tracks: [{
        id: 'tpl-text',
        kind: 'text',
        clips: [
          { id: 'a', groupId: 'group-1', timelineStart: 0, duration: 2, text: { content: 'A', fontSizePx: 48, color: '#fff', align: 'center', animationPreset: 'none' } },
          { id: 'b', groupId: 'group-1', timelineStart: 2, duration: 2, text: { content: 'B', fontSizePx: 48, color: '#fff', align: 'center', animationPreset: 'none' } },
        ],
      }],
    }
    const next = insertFragment({ version: 1, tracks: [{ id: 'target', kind: 'text', clips: [] }] }, linked, 10)
    const inserted = next.tracks[0].clips
    expect(inserted[0].groupId).toBeTruthy()
    expect(inserted[0].groupId).toBe(inserted[1].groupId)
    expect(inserted[0].groupId).not.toBe('group-1')
    inserted[0].text!.content = 'changed'
    expect(linked.tracks[0].clips[0].text!.content).toBe('A')
  })

  it('preserves linked group relationships across fragment tracks with a fresh group id', () => {
    const linked: EditorTimeline = {
      version: 1,
      tracks: [
        { id: 'tpl-video', kind: 'video', clips: [{ id: 'v', groupId: 'group-1', timelineStart: 0, duration: 2, media: { type: 'upload', fileId: 'f-v', url: 'https://x.test/v.mp4', mediaKind: 'video' } }] },
        { id: 'tpl-audio', kind: 'audio', clips: [{ id: 'a', groupId: 'group-1', timelineStart: 0, duration: 2, media: { type: 'upload', fileId: 'f-a', url: 'https://x.test/a.mp3', mediaKind: 'audio' } }] },
      ],
    }
    const next = insertFragment({ version: 1, tracks: [] }, linked, 0)
    const video = next.tracks.find((track) => track.kind === 'video')!.clips[0]
    const audio = next.tracks.find((track) => track.kind === 'audio')!.clips[0]
    expect(video.groupId).toBeTruthy()
    expect(video.groupId).toBe(audio.groupId)
    expect(video.groupId).not.toBe('group-1')
  })

  it('appends a new track when no unlocked track of that kind exists', () => {
    const onlyVideo: EditorTimeline = { version: 1, tracks: [{ id: 't-v', kind: 'video', clips: [] }] }
    const next = insertFragment(onlyVideo, fragment, 0)
    expect(next.tracks.some((track) => track.kind === 'text')).toBe(true)
  })

  it('extracts deep-cloned clips with fresh group ids', () => {
    const linkedTimeline: EditorTimeline = {
      version: 1,
      tracks: [{
        id: 't-text',
        kind: 'text',
        clips: [{ id: 'c-a', groupId: 'group-1', timelineStart: 10, duration: 3, text: { content: 'Hi', fontSizePx: 48, color: '#fff', align: 'center', animationPreset: 'none' } }],
      }],
    }
    const extracted = extractSelectionFragment(linkedTimeline, 't-text', ['c-a'])
    expect(extracted.tracks[0].clips[0].groupId).not.toBe('group-1')
    extracted.tracks[0].clips[0].text!.content = 'changed'
    expect(linkedTimeline.tracks[0].clips[0].text!.content).toBe('Hi')
  })
})

describe('sanitizeVideoEditorTemplateInput', () => {
  it('validates category and requires a fragment with at least one clip', () => {
    expect(VIDEO_EDITOR_TEMPLATE_CATEGORIES).toEqual(['intro', 'outro', 'lower_third', 'caption_style', 'end_screen'])
    const result = sanitizeVideoEditorTemplateInput({
      orgId: 'org-1',
      title: 'Intro pop',
      category: 'intro',
      fragment,
    })
    expect(result).toMatchObject({ orgId: 'org-1', title: 'Intro pop', category: 'intro', deleted: false })
    expect(result.fragment.tracks[0].clips).toHaveLength(1)
    expect(() => sanitizeVideoEditorTemplateInput({ orgId: 'org-1', title: 'x', category: 'nope', fragment }))
      .toThrow(/category/)
    expect(() => sanitizeVideoEditorTemplateInput({ orgId: 'org-1', title: 'x', category: 'intro', fragment: { version: 1, tracks: [] } }))
      .toThrow(/fragment/)
    expect(() => sanitizeVideoEditorTemplateInput({
      orgId: 'org-1',
      title: 'bad',
      category: 'intro',
      fragment: { version: 1, tracks: [{ id: 't1', kind: 'text', clips: [{ id: 'c1', timelineStart: 0, duration: 0, text: { content: 'Bad', fontSizePx: 48, color: '#fff', align: 'center', animationPreset: 'none' } }] }] },
    })).toThrow(/fragment is invalid/)
  })
})
