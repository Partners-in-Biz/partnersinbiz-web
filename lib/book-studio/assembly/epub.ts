// EPUB 3 assembly engine for Book Studio (jszip based).
//
// Builds a minimal, valid EPUB 3 package: mimetype (stored, uncompressed),
// container.xml, content.opf (package document), nav.xhtml (EPUB3 nav TOC),
// one XHTML file per chapter, an optional cover, and a small stylesheet.

import JSZip from 'jszip'
import sharp from 'sharp'

// Fixed epoch so identical inputs produce byte-identical zip archives
// (jszip embeds the entry's last-modified date in the local file header).
const EPOCH = new Date(0)

export interface EpubChapterInput {
  title: string
  body: string
  order: number
}

export interface BuildEpubInput {
  project: {
    id?: string
    projectId?: string
    title: string
    metadata?: {
      authorName?: string
      language?: string
      isbn?: string
    }
  }
  chapters: EpubChapterInput[]
  coverImage?: Buffer
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// Minimal markdown-ish -> XHTML body conversion: blank-line split into
// paragraphs; a leading '# ' becomes an <h1>, '## ' becomes an <h2>; all
// other text content is escaped and wrapped in <p>.
function bodyToXhtml(body: string): string {
  const chunks = body.split(/\n\s*\n/)
  const parts: string[] = []
  for (const chunk of chunks) {
    const raw = chunk.trim()
    if (!raw) continue
    if (raw.startsWith('## ')) {
      parts.push(`<h2>${escapeXml(raw.slice(3).trim())}</h2>`)
    } else if (raw.startsWith('# ')) {
      parts.push(`<h1>${escapeXml(raw.slice(2).trim())}</h1>`)
    } else {
      parts.push(`<p>${escapeXml(raw)}</p>`)
    }
  }
  return parts.join('\n')
}

function chapterFileName(index: number): string {
  return `chapter-${index + 1}.xhtml`
}

function stableIdentifier(project: BuildEpubInput['project']): string {
  if (project.metadata?.isbn) return `urn:isbn:${project.metadata.isbn}`
  const id = project.id ?? project.projectId ?? 'unknown'
  return `urn:uuid:book-${id}`
}

export async function buildEpub(input: BuildEpubInput): Promise<Uint8Array> {
  const { project, chapters, coverImage } = input
  const metadata = project.metadata ?? {}
  const language = metadata.language ?? 'en'
  const identifier = stableIdentifier(project)
  const sortedChapters = [...chapters].sort((a, b) => a.order - b.order)
  const hasCover = Boolean(coverImage)

  const zip = new JSZip()

  // 1. mimetype MUST be the first entry, stored (uncompressed).
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE', date: EPOCH })

  // 2. META-INF/container.xml
  const containerXml = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`
  zip.file('META-INF/container.xml', containerXml, { date: EPOCH })

  // 3. Cover image (optional)
  let coverJpeg: Buffer | undefined
  if (coverImage) {
    coverJpeg = await sharp(coverImage).jpeg().toBuffer()
    zip.file('OEBPS/cover.jpg', coverJpeg, { date: EPOCH })

    const coverXhtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
  <title>${escapeXml(project.title)}</title>
  <meta charset="utf-8"/>
  <link rel="stylesheet" type="text/css" href="styles.css"/>
</head>
<body epub:type="cover">
  <div class="cover">
    <img src="cover.jpg" alt="${escapeXml(project.title)} cover"/>
  </div>
</body>
</html>
`
    zip.file('OEBPS/cover.xhtml', coverXhtml, { date: EPOCH })
  }

  // 4. Chapter XHTML files
  const chapterFiles = sortedChapters.map((chapter, index) => {
    const fileName = chapterFileName(index)
    const xhtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${escapeXml(
      language
    )}">
<head>
  <title>${escapeXml(chapter.title)}</title>
  <meta charset="utf-8"/>
  <link rel="stylesheet" type="text/css" href="styles.css"/>
</head>
<body>
  <section epub:type="chapter">
    <h1>${escapeXml(chapter.title)}</h1>
    ${bodyToXhtml(chapter.body)}
  </section>
</body>
</html>
`
    zip.file(`OEBPS/${fileName}`, xhtml, { date: EPOCH })
    return { fileName, title: chapter.title, id: `chapter-${index + 1}` }
  })

  // 5. styles.css
  const stylesCss = `body { font-family: serif; line-height: 1.5; margin: 1em; }
h1 { font-size: 1.6em; margin-bottom: 0.6em; }
h2 { font-size: 1.3em; margin-bottom: 0.5em; }
p { margin: 0 0 0.8em 0; text-indent: 0; }
.cover { text-align: center; margin: 0; padding: 0; }
.cover img { max-width: 100%; max-height: 100vh; }
`
  zip.file('OEBPS/styles.css', stylesCss, { date: EPOCH })

  // 6. nav.xhtml (EPUB3 navigation document / TOC)
  const navItems = chapterFiles
    .map((c) => `      <li><a href="${c.fileName}">${escapeXml(c.title)}</a></li>`)
    .join('\n')
  const navXhtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
  <title>Table of Contents</title>
  <meta charset="utf-8"/>
  <link rel="stylesheet" type="text/css" href="styles.css"/>
</head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>Table of Contents</h1>
    <ol>
${navItems}
    </ol>
  </nav>
</body>
</html>
`
  zip.file('OEBPS/nav.xhtml', navXhtml, { date: EPOCH })

  // 7. content.opf (package document)
  const manifestItems: string[] = [
    '    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
    '    <item id="css" href="styles.css" media-type="text/css"/>',
  ]
  const spineItems: string[] = []

  if (hasCover) {
    manifestItems.push('    <item id="cover-image" href="cover.jpg" media-type="image/jpeg" properties="cover-image"/>')
    manifestItems.push('    <item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>')
    spineItems.push('    <itemref idref="cover" linear="no"/>')
  }

  for (const c of chapterFiles) {
    manifestItems.push(`    <item id="${c.id}" href="${c.fileName}" media-type="application/xhtml+xml"/>`)
    spineItems.push(`    <itemref idref="${c.id}"/>`)
  }

  const metaCover = hasCover ? '\n    <meta name="cover" content="cover-image"/>' : ''
  const contentOpf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" xml:lang="${escapeXml(
    language
  )}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">${escapeXml(identifier)}</dc:identifier>
    <dc:title>${escapeXml(project.title)}</dc:title>
    <dc:language>${escapeXml(language)}</dc:language>
    ${metadata.authorName ? `<dc:creator>${escapeXml(metadata.authorName)}</dc:creator>` : ''}
    <meta property="dcterms:modified">1970-01-01T00:00:00Z</meta>${metaCover}
  </metadata>
  <manifest>
${manifestItems.join('\n')}
  </manifest>
  <spine>
${spineItems.join('\n')}
  </spine>
</package>
`
  zip.file('OEBPS/content.opf', contentOpf, { date: EPOCH })

  const bytes = await zip.generateAsync({
    type: 'uint8array',
    mimeType: 'application/epub+zip',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  })
  return bytes
}
