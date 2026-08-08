import {
  isPrivateScanHost,
  scanDesignFromUrl,
  validateScanUrl,
} from '@/lib/research/designContextScanner'

const FIXTURE_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Acme Legal — Trusted advisors</title>
  <link rel="stylesheet" href="/styles/main.css" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
</head>
<body class="page">
  <header class="site-header">
    <nav class="nav">
      <a class="nav-link" href="/">Home</a>
      <a class="nav-link" href="/about">About</a>
    </nav>
  </header>
  <main>
    <section class="hero">
      <h1 class="hero-title">Legal clarity for founders</h1>
      <a class="btn btn-primary" href="/contact">Book a call</a>
    </section>
    <section class="card-grid">
      <article class="card"><h2 class="card-title">Contracts</h2><p class="card-body">Drafting.</p><a class="btn btn-outline" href="/contracts">Learn more</a></article>
      <article class="card"><h2 class="card-title">Compliance</h2><p class="card-body">Review.</p><a class="btn btn-outline" href="/compliance">Learn more</a></article>
      <article class="card"><h2 class="card-title">Employment</h2><p class="card-body">Advice.</p><a class="btn btn-outline" href="/employment">Learn more</a></article>
    </section>
  </main>
  <footer class="site-footer">
    <p class="footer-text">© Acme Legal</p>
  </footer>
</body>
</html>`

const FIXTURE_CSS = `
:root {
  --color-primary: #0F172A;
  --color-accent: #F59E0B;
  --color-bg: #FAF9F6;
  --font-heading: "Fraunces", serif;
  --font-body: "Inter", sans-serif;
  --radius-md: 8px;
  --radius-lg: 16px;
  --elevation-md: 0 2px 8px rgba(15, 23, 42, 0.08);
  --elevation-lg: 0 8px 24px rgba(15, 23, 42, 0.12);
}
body {
  font-family: "Inter", sans-serif;
  background-color: #FAF9F6;
  color: #1E293B;
}
h1, h2, h3 {
  font-family: "Fraunces", serif;
  color: #0F172A;
}
.btn {
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.08);
}
.btn-primary { background-color: #F59E0B; }
.card { border-radius: 16px; box-shadow: 0 8px 24px rgba(15, 23, 42, 0.12); }
code, pre { font-family: "JetBrains Mono", monospace; }
`

describe('design-context scanner URL guards', () => {
  it('rejects private / local / metadata hosts', () => {
    expect(validateScanUrl('http://localhost:3000/').ok).toBe(false)
    expect(validateScanUrl('http://127.0.0.1/').ok).toBe(false)
    expect(validateScanUrl('http://10.0.0.5/').ok).toBe(false)
    expect(validateScanUrl('http://192.168.1.1/').ok).toBe(false)
    expect(validateScanUrl('http://169.254.169.254/latest/meta-data').ok).toBe(false)
    expect(validateScanUrl('http://example.local/').ok).toBe(false)
    expect(validateScanUrl('ftp://example.com/file').ok).toBe(false)
    expect(validateScanUrl('not a url').ok).toBe(false)
  })

  it('allows public http(s) hosts', () => {
    const ok = validateScanUrl('https://www.acmelegal.example/')
    expect(ok.ok).toBe(true)
    if (ok.ok) expect(ok.url.hostname).toBe('www.acmelegal.example')
  })

  it('isPrivateScanHost covers common private ranges', () => {
    expect(isPrivateScanHost('localhost')).toBe(true)
    expect(isPrivateScanHost('10.1.2.3')).toBe(true)
    expect(isPrivateScanHost('172.16.0.1')).toBe(true)
    expect(isPrivateScanHost('192.168.0.1')).toBe(true)
    expect(isPrivateScanHost('169.254.169.254')).toBe(true)
    expect(isPrivateScanHost('example.com')).toBe(false)
  })
})

describe('design-context scanner extraction', () => {
  beforeEach(() => {
    const fetchMock = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === 'https://www.acmelegal.example/') {
        return Promise.resolve({
          status: 200,
          arrayBuffer: () => Promise.resolve(new TextEncoder().encode(FIXTURE_HTML).buffer),
        })
      }
      if (url === 'https://www.acmelegal.example/styles/main.css') {
        return Promise.resolve({
          status: 200,
          arrayBuffer: () => Promise.resolve(new TextEncoder().encode(FIXTURE_CSS).buffer),
        })
      }
      return Promise.resolve({ status: 404, arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) })
    }) as jest.Mock
    global.fetch = fetchMock as unknown as typeof fetch
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('extracts palette, type stack, components, radius and elevation scales', async () => {
    const result = await scanDesignFromUrl('https://www.acmelegal.example/')

    expect(result.title).toBe('Acme Legal — Trusted advisors')
    expect(result.palette.some((color) => color.value === '#0F172A')).toBe(true)
    expect(result.palette.some((color) => color.value === '#F59E0B')).toBe(true)
    expect(result.palette.some((color) => color.value === '#FAF9F6')).toBe(true)

    expect(result.typeStack.some((type) => type.role === 'heading' && type.family.includes('Fraunces'))).toBe(true)
    expect(result.typeStack.some((type) => type.role === 'body' && type.family.includes('Inter'))).toBe(true)
    expect(result.typeStack.some((type) => type.role === 'mono' && type.family.includes('JetBrains Mono'))).toBe(true)

    const componentNames = result.componentHints.map((hint) => hint.name)
    expect(componentNames).toContain('card')
    expect(componentNames).toContain('btn')
    expect(componentNames).toContain('btn-outline')

    expect(result.radiusScale.length).toBeGreaterThan(0)
    expect(result.elevationScale.length).toBeGreaterThan(0)
    expect(result.notes.length).toBeGreaterThan(0)
  })

  it('throws for private URLs', async () => {
    await expect(scanDesignFromUrl('http://localhost:3000/')).rejects.toThrow(/private|local|metadata/i)
  })

  it('throws for HTTP error status', async () => {
    await expect(scanDesignFromUrl('https://www.acmelegal.example/missing')).rejects.toThrow(/HTTP 404/)
  })
})
