import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  collectRunMediaPaths,
  rewriteRunMediaReferences,
  uploadRunMedia,
} from '../../runtime-installers/runtime/media-upload'

function writeFile(dir: string, name: string, bytes: number | string): string {
  const filePath = path.join(dir, name)
  fs.writeFileSync(filePath, typeof bytes === 'number' ? Buffer.alloc(bytes, 1) : bytes)
  return filePath
}

describe('linked runtime media upload', () => {
  let dir = ''

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pib-run-media-'))
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('rewrites referenced markdown and richParts, and skips >10 MB and unreferenced files', async () => {
    const chart = writeFile(dir, 'chart.png', 'png-bytes')
    const unused = writeFile(dir, 'unused.png', 'orphan')
    const huge = writeFile(dir, 'huge.png', 10 * 1024 * 1024 + 1)
    const finalText = `Generated chart ![](${chart}) and oversized ![](${huge})`
    const richParts = [{ type: 'image', url: chart }]
    const toolResults = [
      { event: 'tool.completed', tool: 'image_gen', path: chart },
      { event: 'tool.completed', tool: 'image_gen', path: unused },
      { event: 'tool.completed', tool: 'browser', screenshot: huge },
    ]

    const paths = collectRunMediaPaths({
      workingDirectory: dir,
      finalText,
      toolResults,
      richParts,
    })
    expect(paths).toEqual([chart])
    expect(paths).not.toContain(unused)
    expect(paths).not.toContain(huge)

    const post = jest.fn(async (_url: string, body: { filename: string; contentType: string; bytesBase64: string }) => {
      expect(body.filename).toBe('chart.png')
      expect(body.contentType).toBe('image/png')
      expect(Buffer.from(body.bytesBase64, 'base64').toString()).toBe('png-bytes')
      return Response.json({ success: true, data: { url: '/api/v1/conversations/conv-1/attachments/abc123' } })
    })

    const uploaded = await uploadRunMedia(post, 'job-1', paths)
    expect(post).toHaveBeenCalledTimes(1)
    expect(post).toHaveBeenCalledWith('/runs/job-1/media', expect.objectContaining({
      filename: 'chart.png',
      contentType: 'image/png',
    }))
    expect(uploaded.get(chart)).toBe('/api/v1/conversations/conv-1/attachments/abc123')
    expect(uploaded.has(unused)).toBe(false)
    expect(uploaded.has(huge)).toBe(false)
    expect((await uploadRunMedia(post, 'job-1', [huge])).size).toBe(0)

    const rewritten = rewriteRunMediaReferences(finalText, uploaded, richParts)
    expect(rewritten.finalText).toBe('Generated chart ![](/api/v1/conversations/conv-1/attachments/abc123) and oversized ![](' + huge + ')')
    expect(rewritten.richParts).toEqual([{ type: 'image', url: '/api/v1/conversations/conv-1/attachments/abc123' }])
  })

  it('does not upload working-directory files that the final text never references', () => {
    const referenced = writeFile(dir, 'keep.csv', 'a,b\n1,2\n')
    writeFile(dir, 'ignore.csv', 'nope')
    const paths = collectRunMediaPaths({
      workingDirectory: dir,
      finalText: `Download ![](${referenced})`,
      toolResults: [],
    })
    expect(paths).toEqual([referenced])
  })
})
