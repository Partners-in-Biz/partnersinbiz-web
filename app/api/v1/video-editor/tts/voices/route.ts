import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess } from '@/lib/api/response'
import { resolveCreativeProviderCredential } from '@/lib/creative-canvas/connections/resolve'
import { OPENAI_TTS_VOICES, listElevenLabsVoices } from '@/lib/video-editor/tts'

export const dynamic = 'force-dynamic'

export const GET = withAuth('client', async (req: NextRequest, user) => {
  const orgId = req.nextUrl.searchParams.get('orgId') ?? ''
  const voices = [...OPENAI_TTS_VOICES]
  if (orgId) {
    const credential = await resolveCreativeProviderCredential({ provider: 'elevenlabs', orgId, uid: user.uid })
    if (credential.kind === 'byok' && typeof credential.credentials.apiKey === 'string') {
      voices.push(...await listElevenLabsVoices(credential.credentials.apiKey).catch(() => []))
    }
  }
  return apiSuccess({ voices })
})
