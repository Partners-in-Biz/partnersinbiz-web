import { mediaKeyForRef, sanitizeMediaPreviewReportInput } from '@/lib/video-editor/media-previews'

describe('mediaKeyForRef', () => {
  it('is deterministic per ref type', () => {
    expect(mediaKeyForRef({ type: 'upload', fileId: 'f1', url: 'https://x.test/a.mp4', mediaKind: 'video' })).toBe('upload:f1')
    expect(mediaKeyForRef({ type: 'youtube_source_asset', sourceAssetId: 's1', url: 'https://x.test/a.mp4', mediaKind: 'video' })).toBe('yt:s1')
    expect(mediaKeyForRef({ type: 'canvas_output', canvasId: 'c', nodeId: 'n', runId: 'r', url: 'https://x.test/a.mp4', mediaKind: 'video' })).toBe('canvas:c:n:r')
  })
})

describe('sanitizeMediaPreviewReportInput', () => {
  it('accepts a full ready report', () => {
    const patch = sanitizeMediaPreviewReportInput({
      status: 'ready',
      waveform: { url: 'https://x.test/w.json', storagePath: 'p/w.json', peaksPerSecond: 20, peakCount: 80, junk: true },
      filmstrip: { url: 'https://x.test/f.jpg', storagePath: 'p/f.jpg', frameIntervalSeconds: 2, frameWidth: 160, frameHeight: 90, frameCount: 10 },
      proxy: { url: 'https://x.test/p.mp4', storagePath: 'p/p.mp4', sizeBytes: 1234, width: 960, height: 540 },
    })
    expect(patch.status).toBe('ready')
    expect(patch.waveform).toEqual({ url: 'https://x.test/w.json', storagePath: 'p/w.json', peaksPerSecond: 20, peakCount: 80 })
    expect(patch.proxy?.sizeBytes).toBe(1234)
  })

  it('rejects invalid statuses, http urls and partial artifacts', () => {
    expect(sanitizeMediaPreviewReportInput({ status: 'exploded' }).status).toBeUndefined()
    expect(sanitizeMediaPreviewReportInput({ status: 'ready', proxy: { url: 'http://x.test/p.mp4', storagePath: 'p', sizeBytes: 1, width: 1, height: 1 } }).proxy).toBeUndefined()
    expect(sanitizeMediaPreviewReportInput({ status: 'ready', waveform: { url: 'https://x.test/w.json' } }).waveform).toBeUndefined()
    expect(sanitizeMediaPreviewReportInput({ status: 'failed', error: { message: 'boom' } }).error).toEqual({ code: 'preview_failed', message: 'boom' })
  })
})
