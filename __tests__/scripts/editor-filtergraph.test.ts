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

describe('editor filtergraph compiler', () => {
  it('escapes drawtext and computes duration', () => {
    expect(runModule<string>(`return m.escapeDrawtext(${JSON.stringify("It's 10:00, 100% [done]")})`)).toBe('It’s 10\\:00\\, 100\\% \\[done\\]')
    expect(runModule<number>(`return m.timelineDurationSeconds(${JSON.stringify({
      version: 1,
      tracks: [{ id: 't', kind: 'video', clips: [{ id: 'c', timelineStart: 1, duration: 2.5 }] }],
    })})`)).toBe(3.5)
  })

  it('compiles a trimmed video clip with silent output', () => {
    const result = runModule<{
      inputs: string[]
      filterComplex: string
      outputArgs: string[]
      durationSeconds: number
    }>(`return m.compileEditorFiltergraph(${JSON.stringify({
      settings,
      localMediaPaths: { c1: '/tmp/media/c1.mp4' },
      timeline: {
        version: 1,
        tracks: [{
          id: 't1',
          kind: 'video',
          clips: [{
            id: 'c1',
            timelineStart: 0,
            duration: 4,
            trimStart: 2,
            media: { type: 'upload', fileId: 'f1', url: 'https://x.test/a.mp4', mediaKind: 'video' },
          }],
        }],
      },
    })})`)
    expect(result.durationSeconds).toBe(4)
    expect(result.inputs).toEqual([
      '-f', 'lavfi', '-i', 'color=c=#000000:s=1280x720:r=30:d=4',
      '-i', '/tmp/media/c1.mp4',
      '-f', 'lavfi', '-t', '4', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
    ])
    expect(result.filterComplex).toContain('[1:v]trim=start=2:duration=4,setpts=PTS-STARTPTS[vc0]')
    expect(result.filterComplex).toContain("[base][vc0]overlay=x=(W-w)/2:y=(H-h)/2:enable='between(t,0,4)':eof_action=pass[ov0]")
    expect(result.filterComplex).toContain('[2:a]atrim=duration=4[aout]')
    expect(result.outputArgs).toEqual([
      '-map', '[vout]', '-map', '[aout]',
      '-c:v', 'libx264', '-crf', '20', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-r', '30',
      '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-t', '4',
    ])
  })

  it('compiles adjacent clips with xfade and rejects missing media paths', () => {
    const result = runModule<{ filterComplex: string }>(`return m.compileEditorFiltergraph(${JSON.stringify({
      settings,
      localMediaPaths: { c1: '/tmp/m/c1.mp4', c2: '/tmp/m/c2.mp4' },
      timeline: {
        version: 1,
        tracks: [{
          id: 't1',
          kind: 'video',
          clips: [
            {
              id: 'c1',
              timelineStart: 0,
              duration: 3,
              media: { type: 'upload', fileId: 'f1', url: 'https://x.test/a.mp4', mediaKind: 'video' },
              transitionAfter: { kind: 'crossfade', duration: 1 },
            },
            {
              id: 'c2',
              timelineStart: 3,
              duration: 3,
              media: { type: 'upload', fileId: 'f2', url: 'https://x.test/b.mp4', mediaKind: 'video' },
            },
          ],
        }],
      },
    })})`)
    expect(result.filterComplex).toContain('[vc0][vc1]xfade=transition=fade:duration=1:offset=2[vx0]')
    expect(runModule<string>(`try { m.compileEditorFiltergraph(${JSON.stringify({
      settings,
      localMediaPaths: {},
      timeline: {
        version: 1,
        tracks: [{ id: 't', kind: 'video', clips: [{ id: 'c9', timelineStart: 0, duration: 1, media: { type: 'upload', fileId: 'f', url: 'https://x.test/a.mp4', mediaKind: 'video' } }] }],
      },
    })}) } catch (error) { return String(error.message) }`)).toContain('no local media for clip c9')
  })

  it('compiles keyframed volume, scale, rotation and overlay position', () => {
    const result = runModule<{ filterComplex: string }>(`return m.compileEditorFiltergraph(${JSON.stringify({
      settings,
      localMediaPaths: { c1: '/tmp/m/c1.mp4' },
      timeline: {
        version: 1,
        tracks: [{
          id: 't1',
          kind: 'video',
          clips: [{
            id: 'c1',
            timelineStart: 2,
            duration: 4,
            volume: 1,
            media: { type: 'upload', fileId: 'f1', url: 'https://x.test/a.mp4', mediaKind: 'video' },
            keyframes: [
              { property: 'volume', atSeconds: 0, value: 1 },
              { property: 'volume', atSeconds: 2, value: 0 },
              { property: 'transform.scale', atSeconds: 0, value: 1 },
              { property: 'transform.scale', atSeconds: 4, value: 2 },
              { property: 'transform.rotation', atSeconds: 0, value: 0 },
              { property: 'transform.rotation', atSeconds: 4, value: 90 },
              { property: 'transform.x', atSeconds: 0, value: 0 },
              { property: 'transform.x', atSeconds: 4, value: 300 },
            ],
          }],
        }],
      },
    })})`)
    const scaleExpr = "if(lt(t,0),1,if(lt(t,4),1+(2-1)*(t-0)/4,2))"
    const rotationExpr = "if(lt(t,0),0,if(lt(t,4),0+(90-0)*(t-0)/4,90))"
    const xExpr = "if(lt((t-2),0),0,if(lt((t-2),4),0+(300-0)*((t-2)-0)/4,300))"
    const volumeExpr = "if(lt(t,0),1,if(lt(t,2),1+(0-1)*(t-0)/2,0))"
    expect(result.filterComplex).toContain(`scale=w='iw*(${scaleExpr})':h='ih*(${scaleExpr})':eval=frame`)
    expect(result.filterComplex).toContain(`rotate=a='(${rotationExpr})*PI/180':c=black@0`)
    expect(result.filterComplex).toContain(`overlay=x='(W-w)/2+(${xExpr})':y=(H-h)/2:enable='between(t,2,6)':eof_action=pass`)
    expect(result.filterComplex).toContain(`volume=volume='(${volumeExpr})':eval=frame`)
  })

  it('compiles opacity keyframes as sendcmd + colorchannelmixer commands', () => {
    const result = runModule<{ filterComplex: string }>(`return m.compileEditorFiltergraph(${JSON.stringify({
      settings,
      localMediaPaths: { c1: '/tmp/m/c1.mp4' },
      timeline: {
        version: 1,
        tracks: [{
          id: 't1',
          kind: 'video',
          clips: [{
            id: 'c1',
            timelineStart: 0,
            duration: 1,
            media: { type: 'upload', fileId: 'f1', url: 'https://x.test/a.mp4', mediaKind: 'video' },
            keyframes: [
              { property: 'transform.opacity', atSeconds: 0, value: 1 },
              { property: 'transform.opacity', atSeconds: 1, value: 0 },
            ],
          }],
        }],
      },
    })})`)
    expect(result.filterComplex).toContain("format=yuva420p,sendcmd=c='0 colorchannelmixer@op0 aa 1;")
    expect(result.filterComplex).toContain("',colorchannelmixer@op0=aa=1[vc0]")
  })

  it('compiles a speed ramp as split/trim/setpts segments joined with concat (video + audio)', () => {
    const result = runModule<{ filterComplex: string }>(`return m.compileEditorFiltergraph(${JSON.stringify({
      settings,
      localMediaPaths: { c1: '/tmp/m/c1.mp4' },
      timeline: {
        version: 1,
        tracks: [{
          id: 't1',
          kind: 'video',
          clips: [{
            id: 'c1',
            timelineStart: 0,
            duration: 4,
            trimStart: 1,
            volume: 1,
            media: { type: 'upload', fileId: 'f1', url: 'https://x.test/a.mp4', mediaKind: 'video' },
            keyframes: [
              { property: 'speed', atSeconds: 0, value: 1 },
              { property: 'speed', atSeconds: 4, value: 2 },
            ],
          }],
        }],
      },
    })})`)
    // video: split into 4 constant-speed slices, trims offset by trimStart=1
    expect(result.filterComplex).toContain('[1:v]split=4[vr0i0][vr0i1][vr0i2][vr0i3]')
    expect(result.filterComplex).toContain('[vr0i0]trim=start=1:duration=1.125,setpts=(PTS-STARTPTS)/1.125[vr0s0]')
    expect(result.filterComplex).toContain('[vr0i1]trim=start=2.125:duration=1.375,setpts=(PTS-STARTPTS)/1.375[vr0s1]')
    expect(result.filterComplex).toContain('[vr0s0][vr0s1][vr0s2][vr0s3]concat=n=4:v=1:a=0[vc0]')
    // audio: asplit + atrim + atempo per slice, then concat
    expect(result.filterComplex).toContain('[1:a]asplit=4[ar0i0][ar0i1][ar0i2][ar0i3]')
    expect(result.filterComplex).toContain('[ar0i0]atrim=start=1:duration=1.125,asetpts=PTS-STARTPTS,atempo=1.125[ar0s0]')
    expect(result.filterComplex).toContain('[ar0s0][ar0s1][ar0s2][ar0s3]concat=n=4:v=0:a=1[aout]')
  })
})
