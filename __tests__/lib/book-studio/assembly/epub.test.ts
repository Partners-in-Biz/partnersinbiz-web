import JSZip from 'jszip'
import { buildEpub, type BuildEpubInput, type EpubChapterInput } from '@/lib/book-studio/assembly/epub'

jest.setTimeout(120000)

// Tiny valid 1x1 PNG; sharp normalizes it to JPEG inside the builder.
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)

function chapters(): EpubChapterInput[] {
  return [
    { order: 1, title: 'The Letter', body: '# The Letter\n\nMarta walked the sea wall as she had every morning.\n\n## The Turning Tide\n\nA storm was coming.' },
    { order: 2, title: 'The Crossing', body: 'She left before dawn.\n\nThe boat rocked hard against the swell.' },
  ]
}

function baseInput(overrides?: Partial<BuildEpubInput>): BuildEpubInput {
  return {
    project: {
      id: 'proj-123',
      title: 'The Salt Ledger',
      metadata: { authorName: 'A. Tester', isbn: '978-1-2345-6789-0' },
    },
    chapters: chapters(),
    ...overrides,
  }
}

async function unzip(bytes: Uint8Array) {
  return JSZip.loadAsync(bytes)
}

describe('buildEpub', () => {
  it('produces mimetype as the first entry with the exact required content', async () => {
    const bytes = await buildEpub(baseInput())
    const zip = await unzip(bytes)
    const names = Object.keys(zip.files)
    expect(names[0]).toBe('mimetype')
    const content = await zip.file('mimetype')!.async('string')
    expect(content).toBe('application/epub+zip')
  })

  it('includes container.xml, content.opf, and nav.xhtml', async () => {
    const bytes = await buildEpub(baseInput())
    const zip = await unzip(bytes)
    expect(zip.file('META-INF/container.xml')).toBeTruthy()
    expect(zip.file('OEBPS/content.opf')).toBeTruthy()
    expect(zip.file('OEBPS/nav.xhtml')).toBeTruthy()
  })

  it('writes one chapter file per chapter', async () => {
    const bytes = await buildEpub(baseInput())
    const zip = await unzip(bytes)
    const chapterFiles = Object.keys(zip.files).filter((n) => /^OEBPS\/chapter-\d+\.xhtml$/.test(n))
    expect(chapterFiles).toHaveLength(2)
  })

  it('content.opf contains the title and ISBN when set', async () => {
    const bytes = await buildEpub(baseInput())
    const zip = await unzip(bytes)
    const opf = await zip.file('OEBPS/content.opf')!.async('string')
    expect(opf).toContain('<dc:title>The Salt Ledger</dc:title>')
    expect(opf).toContain('urn:isbn:978-1-2345-6789-0')
  })

  it('escapes special characters in chapter body text', async () => {
    const bytes = await buildEpub(
      baseInput({
        chapters: [{ order: 1, title: 'Comparisons', body: 'a < b and b > a & "quoted"' }],
      })
    )
    const zip = await unzip(bytes)
    const chapter = await zip.file('OEBPS/chapter-1.xhtml')!.async('string')
    expect(chapter).toContain('a &lt; b and b &gt; a &amp; &quot;quoted&quot;')
    expect(chapter).not.toContain('a < b')
  })

  it('includes cover.jpg and cover metadata in the opf when a cover image is supplied', async () => {
    const bytes = await buildEpub(baseInput({ coverImage: PNG_1X1 }))
    const zip = await unzip(bytes)
    expect(zip.file('OEBPS/cover.jpg')).toBeTruthy()
    expect(zip.file('OEBPS/cover.xhtml')).toBeTruthy()
    const opf = await zip.file('OEBPS/content.opf')!.async('string')
    expect(opf).toContain('<meta name="cover" content="cover-image"/>')
  })

  it('omits cover entries when no cover image is supplied', async () => {
    const bytes = await buildEpub(baseInput())
    const zip = await unzip(bytes)
    expect(zip.file('OEBPS/cover.jpg')).toBeNull()
    const opf = await zip.file('OEBPS/content.opf')!.async('string')
    expect(opf).not.toContain('name="cover"')
  })

  it('is deterministic: two builds are byte-equal', async () => {
    const a = await buildEpub(baseInput({ coverImage: PNG_1X1 }))
    const b = await buildEpub(baseInput({ coverImage: PNG_1X1 }))
    expect(Buffer.compare(Buffer.from(a), Buffer.from(b))).toBe(0)
  })
})
