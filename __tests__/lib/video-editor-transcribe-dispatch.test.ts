import {
  buildTranscriptionManifest,
  dispatchTranscriptionJob,
  transcriptionRuntimeConfigFromEnv,
} from '@/lib/video-editor/transcribe-dispatch'

describe('transcriptionRuntimeConfigFromEnv', () => {
  it('derives the submit url from HIGGSFIELD_RUNTIME_URL', () => {
    const config = transcriptionRuntimeConfigFromEnv({
      HIGGSFIELD_RUNTIME_URL: 'https://vps.example/higgsfield-executor/',
      HIGGSFIELD_RUNTIME_API_KEY: 'k',
      NEXT_PUBLIC_APP_URL: 'https://partnersinbiz.online/',
    } as NodeJS.ProcessEnv)
    expect(config).toEqual({
      submitUrl: 'https://vps.example/higgsfield-executor/video-editor/transcriptions',
      apiKey: 'k',
      callbackBaseUrl: 'https://partnersinbiz.online',
    })
  })
  it('honours the explicit override', () => {
    const config = transcriptionRuntimeConfigFromEnv({
      VIDEO_EDITOR_TRANSCRIBE_SUBMIT_URL: 'https://other.example/transcriptions',
    } as NodeJS.ProcessEnv)
    expect(config.submitUrl).toBe('https://other.example/transcriptions')
  })
})

describe('buildTranscriptionManifest', () => {
  it('builds the executor contract', () => {
    const manifest = buildTranscriptionManifest({
      transcriptId: 't-1', orgId: 'org-1', projectId: 'p-1',
      media: { url: 'https://firebasestorage.googleapis.com/v0/b/x/o/a.mp4?alt=media', mediaKind: 'video' },
      language: 'en',
      byok: { apiKey: 'sk-user', baseUrl: 'https://api.openai.com/v1' },
    })
    expect(manifest).toEqual({
      kind: 'video_editor_transcription',
      job: { id: 't-1', orgId: 'org-1', projectId: 'p-1' },
      media: { url: 'https://firebasestorage.googleapis.com/v0/b/x/o/a.mp4?alt=media', mediaKind: 'video' },
      language: 'en',
      byok: { apiKey: 'sk-user', baseUrl: 'https://api.openai.com/v1' },
      report: { method: 'PUT', path: '/api/v1/video-editor/transcripts/t-1?orgId=org-1' },
    })
  })
  it('omits byok when the platform gateway is used', () => {
    const manifest = buildTranscriptionManifest({
      transcriptId: 't-2', orgId: 'org-1', projectId: 'p-1',
      media: { url: 'https://x.test/a.mp3', mediaKind: 'audio' },
    })
    expect(manifest.byok).toBeUndefined()
    expect(manifest.language).toBeUndefined()
  })
})

describe('dispatchTranscriptionJob', () => {
  const manifest = buildTranscriptionManifest({
    transcriptId: 't-1', orgId: 'org-1', projectId: 'p-1',
    media: { url: 'https://x.test/a.mp3', mediaKind: 'audio' },
  })

  afterEach(() => { (global.fetch as jest.Mock | undefined)?.mockRestore?.() })

  it('POSTs the manifest with callback and returns providerJobId', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ providerJobId: 'vtx-1' }),
    }) as unknown as typeof fetch
    const result = await dispatchTranscriptionJob(manifest, {
      submitUrl: 'https://vps.example/video-editor/transcriptions', apiKey: 'k', callbackBaseUrl: 'https://app.example',
    })
    expect(result).toEqual({ providerJobId: 'vtx-1' })
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0]
    expect(url).toBe('https://vps.example/video-editor/transcriptions')
    expect(init.headers.Authorization).toBe('Bearer k')
    const body = JSON.parse(init.body)
    expect(body.callback.url).toBe('https://app.example/api/v1/video-editor/transcripts/t-1')
  })

  it('throws when the executor rejects or omits providerJobId', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503, text: async () => 'down' }) as unknown as typeof fetch
    await expect(dispatchTranscriptionJob(manifest, { submitUrl: 'https://vps.example/x' })).rejects.toThrow('503')
    global.fetch = jest.fn().mockResolvedValue({ ok: true, text: async () => '{}' }) as unknown as typeof fetch
    await expect(dispatchTranscriptionJob(manifest, { submitUrl: 'https://vps.example/x' })).rejects.toThrow('providerJobId')
    await expect(dispatchTranscriptionJob(manifest, {})).rejects.toThrow('not configured')
  })
})
