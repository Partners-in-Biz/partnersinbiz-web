import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

const modulePath = join(process.cwd(), 'scripts/higgsfield-executor/lib/editor-filtergraph.mjs')

function runModule<T>(code: string): T {
  const stdout = execFileSync(process.execPath, ['--input-type=module', '-e', `
    import * as m from ${JSON.stringify(`file://${modulePath}`)};
    const result = await (async () => { ${code} })();
    process.stdout.write(JSON.stringify(result));
  `], { encoding: 'utf8' })
  return JSON.parse(stdout) as T
}

const settings = { width: 1280, height: 720, fps: 30, background: '#000000' }

function compileTracks(tracks: unknown[], localMediaPaths: Record<string, string>) {
  return runModule<{ filterComplex: string }>(`return m.compileEditorFiltergraph(${JSON.stringify({
    settings, localMediaPaths, timeline: { version: 1, tracks },
  })})`)
}

function compileTracksError(tracks: unknown[], localMediaPaths: Record<string, string>) {
  return runModule<string>(`try {
    m.compileEditorFiltergraph(${JSON.stringify({ settings, localMediaPaths, timeline: { version: 1, tracks } })})
    return 'ok'
  } catch (error) {
    return String(error.message)
  }`)
}

const audioClip = (id: string, extra: Record<string, unknown> = {}) => ({
  id, timelineStart: 0, duration: 4,
  media: { type: 'upload', fileId: `f-${id}`, url: `https://x.test/${id}.mp3`, mediaKind: 'audio' },
  volume: 1,
  ...extra,
})

describe('audio engineering', () => {
  it('applies track gainDb and pan to every source on the track', () => {
    const { filterComplex } = compileTracks(
      [{ id: 't-a', kind: 'audio', gainDb: -6, pan: 0.5, clips: [audioClip('c1')] }],
      { c1: '/tmp/m/c1.mp3' },
    )

    expect(filterComplex).toContain('volume=-6dB')
    expect(filterComplex).toContain('stereotools=balance_out=0.5')
  })

  it('applies clip fade in/out with afade at stream-relative times', () => {
    const { filterComplex } = compileTracks(
      [{ id: 't-a', kind: 'audio', clips: [audioClip('c1', { fadeInSeconds: 0.5, fadeOutSeconds: 1 })] }],
      { c1: '/tmp/m/c1.mp3' },
    )

    expect(filterComplex).toContain('afade=t=in:st=0:d=0.5')
    expect(filterComplex).toContain('afade=t=out:st=3:d=1')
  })

  it('compiles noise reduction and voice isolation clip effects', () => {
    const { filterComplex } = compileTracks(
      [{
        id: 't-a', kind: 'audio',
        clips: [audioClip('c1', {
          effects: [
            { kind: 'noise_reduction', params: { amountDb: 18 } },
            { kind: 'voice_isolation', params: {} },
          ],
        })],
      }],
      { c1: '/tmp/m/c1.mp3' },
    )

    expect(filterComplex).toContain('afftdn=nr=18')
    expect(filterComplex).toContain('highpass=f=100,lowpass=f=8000,afftdn=nr=20:nf=-30')
  })

  it('solo on one track excludes non-solo audio tracks', () => {
    const { filterComplex } = compileTracks(
      [
        { id: 't-a', kind: 'audio', solo: true, clips: [audioClip('c1')] },
        { id: 't-b', kind: 'audio', clips: [audioClip('c2')] },
      ],
      { c1: '/tmp/m/c1.mp3', c2: '/tmp/m/c2.mp3' },
    )

    expect(filterComplex).toContain('[1:a]')
    expect(filterComplex).not.toContain('[2:a]')
  })

  it('fails fast when audio effects are attached to visual-only clips', () => {
    const error = compileTracksError(
      [{
        id: 't-v',
        kind: 'video',
        clips: [{
          id: 'c1',
          timelineStart: 0,
          duration: 4,
          media: { type: 'upload', fileId: 'f-c1', url: 'https://x.test/c1.png', mediaKind: 'image' },
          effects: [{ kind: 'noise_reduction', params: { amountDb: 18 } }],
        }],
      }],
      { c1: '/tmp/m/c1.png' },
    )

    expect(error).toBe('audio effect noise_reduction requires an audio source on clip c1')
  })

  it('legacy single-source output stays byte-identical without new fields', () => {
    const { filterComplex } = compileTracks(
      [{ id: 't-a', kind: 'audio', clips: [audioClip('c1', { volume: 0.8 })] }],
      { c1: '/tmp/m/c1.mp3' },
    )

    expect(filterComplex).toContain('[1:a]atrim=start=0:duration=4,asetpts=PTS-STARTPTS,volume=0.8[aout]')
  })
})

describe('auto-ducking', () => {
  it('routes voice through asplit into sidechaincompress against ducked tracks', () => {
    const { filterComplex } = compileTracks(
      [
        { id: 't-voice', kind: 'audio', audioRole: 'voice', clips: [audioClip('c1')] },
        { id: 't-music', kind: 'audio', audioRole: 'music', duckUnderVoice: true, clips: [audioClip('c2')] },
      ],
      { c1: '/tmp/m/c1.mp3', c2: '/tmp/m/c2.mp3' },
    )

    expect(filterComplex).toContain('asplit=2[duckvout][duckscraw]')
    expect(filterComplex).toContain('[duckscraw]apad=whole_dur=4[ducksc]')
    expect(filterComplex).toContain('sidechaincompress=threshold=0.05:ratio=8:attack=20:release=400[ducked]')
    expect(filterComplex).toContain('[duckvout][ducked]amix=inputs=2:duration=longest:normalize=0[aout]')
  })

  it('pads short voice sidechains so longer ducked music can continue', () => {
    const { filterComplex } = compileTracks(
      [
        { id: 't-voice', kind: 'audio', audioRole: 'voice', clips: [audioClip('c1', { duration: 1 })] },
        { id: 't-music', kind: 'audio', audioRole: 'music', duckUnderVoice: true, clips: [audioClip('c2', { duration: 3 })] },
      ],
      { c1: '/tmp/m/c1.mp3', c2: '/tmp/m/c2.mp3' },
    )

    expect(filterComplex).toContain('[duckscraw]apad=whole_dur=3[ducksc]')
    expect(filterComplex).toContain('[ac1][ducksc]sidechaincompress=threshold=0.05:ratio=8:attack=20:release=400[ducked]')
    expect(filterComplex).toContain('[duckvout][ducked]amix=inputs=2:duration=longest:normalize=0[aout]')
  })

  it('mixes multiple voice and ducked tracks while preserving other audio', () => {
    const { filterComplex } = compileTracks(
      [
        { id: 't-voice-1', kind: 'audio', audioRole: 'voice', clips: [audioClip('c1')] },
        { id: 't-voice-2', kind: 'audio', audioRole: 'voice', clips: [audioClip('c2')] },
        { id: 't-music-1', kind: 'audio', duckUnderVoice: true, clips: [audioClip('c3')] },
        { id: 't-music-2', kind: 'audio', duckUnderVoice: true, clips: [audioClip('c4')] },
        { id: 't-sfx', kind: 'audio', clips: [audioClip('c5')] },
      ],
      {
        c1: '/tmp/m/c1.mp3',
        c2: '/tmp/m/c2.mp3',
        c3: '/tmp/m/c3.mp3',
        c4: '/tmp/m/c4.mp3',
        c5: '/tmp/m/c5.mp3',
      },
    )

    expect(filterComplex).toContain('[ac0][ac1]amix=inputs=2:duration=longest:normalize=0[duckvmix]')
    expect(filterComplex).toContain('[ac2][ac3]amix=inputs=2:duration=longest:normalize=0[duckdmix]')
    expect(filterComplex).toContain('[duckvout][ducked][ac4]amix=inputs=3:duration=longest:normalize=0[aout]')
  })

  it('treats video-track audio as a voice sidechain source', () => {
    const { filterComplex } = compileTracks(
      [
        {
          id: 't-video',
          kind: 'video',
          clips: [{
            ...audioClip('c1'),
            media: { type: 'upload', fileId: 'f-c1', url: 'https://x.test/c1.mp4', mediaKind: 'video' },
          }],
        },
        { id: 't-music', kind: 'audio', duckUnderVoice: true, clips: [audioClip('c2')] },
      ],
      { c1: '/tmp/m/c1.mp4', c2: '/tmp/m/c2.mp3' },
    )

    expect(filterComplex).toContain('[ac1][ducksc]sidechaincompress=threshold=0.05:ratio=8:attack=20:release=400[ducked]')
  })

  it('does not duck when no track opts in', () => {
    const { filterComplex } = compileTracks(
      [
        { id: 't-voice', kind: 'audio', audioRole: 'voice', clips: [audioClip('c1')] },
        { id: 't-music', kind: 'audio', audioRole: 'music', clips: [audioClip('c2')] },
      ],
      { c1: '/tmp/m/c1.mp3', c2: '/tmp/m/c2.mp3' },
    )

    expect(filterComplex).not.toContain('sidechaincompress')
    expect(filterComplex).toContain('[ac0][ac1]amix=inputs=2:duration=longest:normalize=0[aout]')
  })

  it('falls back to the legacy mix when solo removes the ducked track', () => {
    const { filterComplex } = compileTracks(
      [
        { id: 't-voice', kind: 'audio', audioRole: 'voice', solo: true, clips: [audioClip('c1')] },
        { id: 't-music', kind: 'audio', duckUnderVoice: true, clips: [audioClip('c2')] },
      ],
      { c1: '/tmp/m/c1.mp3', c2: '/tmp/m/c2.mp3' },
    )

    expect(filterComplex).not.toContain('sidechaincompress')
    expect(filterComplex).toContain('[1:a]atrim=start=0:duration=4,asetpts=PTS-STARTPTS[aout]')
    expect(filterComplex).not.toContain('[2:a]')
  })
})
