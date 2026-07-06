import { fetchImageForAssemblyFromUrl } from '@/lib/book-studio/assembly/assemble'

function response(body: string, init: ResponseInit = {}) {
  return new Response(body, init)
}

describe('fetchImageForAssemblyFromUrl', () => {
  afterEach(() => {
    ;(global.fetch as jest.Mock | undefined)?.mockReset?.()
  })

  it('rejects literal private network URLs before fetch', async () => {
    global.fetch = jest.fn() as unknown as typeof fetch

    await expect(fetchImageForAssemblyFromUrl('http://127.0.0.1/cover.png')).rejects.toThrow(/private|reserved/i)
    await expect(fetchImageForAssemblyFromUrl('http://10.0.0.5/cover.png')).rejects.toThrow(/private|reserved/i)
    await expect(fetchImageForAssemblyFromUrl('http://[::1]/cover.png')).rejects.toThrow(/private|reserved/i)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('rejects oversized responses from content-length', async () => {
    global.fetch = jest.fn().mockResolvedValue(response('', {
      status: 200,
      headers: { 'content-length': String(10 * 1024 * 1024 + 1) },
    })) as unknown as typeof fetch

    await expect(fetchImageForAssemblyFromUrl('https://93.184.216.34/cover.png')).rejects.toThrow(/10MB/)
  })

  it('rejects oversized streaming responses even without content-length', async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(10 * 1024 * 1024 + 1))
        controller.close()
      },
    })
    global.fetch = jest.fn().mockResolvedValue(new Response(stream, { status: 200 })) as unknown as typeof fetch

    await expect(fetchImageForAssemblyFromUrl('https://93.184.216.34/cover.png')).rejects.toThrow(/10MB/)
  })

  it('follows redirects only after revalidating the next URL', async () => {
    global.fetch = jest.fn().mockResolvedValue(response('', {
      status: 302,
      headers: { location: 'http://127.0.0.1/private.png' },
    })) as unknown as typeof fetch

    await expect(fetchImageForAssemblyFromUrl('https://93.184.216.34/cover.png')).rejects.toThrow(/private|reserved/i)
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })
})
