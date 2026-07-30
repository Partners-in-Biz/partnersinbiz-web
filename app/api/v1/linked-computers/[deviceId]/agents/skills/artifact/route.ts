import fs from 'node:fs'
import { NextRequest, NextResponse } from 'next/server'
import { isMarketplaceAgentId } from '@/lib/agents/marketplace'
import { getAgent } from '@/lib/agents/team'
import { isValidAgentId } from '@/lib/agents/types'
import { buildSkillPackManifest, materializeSkillPackTarGz } from '@/lib/agents/skill-pack-builder'
import { authenticateSignedDeviceRequest, noStoreHeaders } from '@/lib/linked-computers/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Context = { params: Promise<{ deviceId: string }> }

function deviceError(error: unknown): Response {
  const message = error instanceof Error ? error.message : ''
  const status = /not found|digest mismatch/.test(message) ? 404
    : /authentication|signature|credential|replay|timestamp|revoked|active device/.test(message) ? 403
      : 400
  return NextResponse.json(
    {
      success: false,
      error: status === 404 ? 'Skill pack not found'
        : status === 403 ? 'Linked computer access denied'
          : 'Linked computer skill pack request invalid',
    },
    { status, headers: noStoreHeaders },
  )
}

/**
 * Device-authenticated skill pack download.
 * Query: agentId + packSha256 (content digest from buildSkillPackManifest).
 * Response body is tar.gz; headers carry content + archive digests for verify.
 */
export async function GET(request: NextRequest, context: Context) {
  const { deviceId } = await context.params
  try {
    await authenticateSignedDeviceRequest(request, deviceId, '')
    const url = new URL(request.url)
    const agentId = url.searchParams.get('agentId') ?? ''
    const packSha256 = url.searchParams.get('packSha256') ?? ''
    if (!isValidAgentId(agentId) || !/^[a-f0-9]{64}$/.test(packSha256)) {
      throw new Error('linked computers: invalid skill pack request')
    }

    let skillNames: string[] | null = null
    if (isMarketplaceAgentId(agentId)) {
      const agent = await getAgent(agentId)
      if (Array.isArray(agent?.marketplaceSkills) && agent.marketplaceSkills.length > 0) {
        skillNames = agent.marketplaceSkills
      }
    }
    const packOptions = skillNames ? { skillNames } : undefined
    const manifest = buildSkillPackManifest(agentId, packOptions)
    if (manifest.packSha256 !== packSha256) {
      throw new Error('skill-pack: digest mismatch')
    }

    const { archivePath, archiveSha256 } = materializeSkillPackTarGz(agentId, packSha256, packOptions)
    try {
      const bytes = fs.readFileSync(archivePath)
      return new NextResponse(bytes, {
        status: 200,
        headers: {
          ...noStoreHeaders,
          'content-type': 'application/gzip',
          'content-disposition': `attachment; filename="pib-skills-${agentId}.tgz"`,
          'x-pib-pack-sha256': manifest.packSha256,
          'x-pib-archive-sha256': archiveSha256,
          'x-pib-policy-version': manifest.policyVersion,
          'x-pib-agent-id': agentId,
        },
      })
    } finally {
      fs.rmSync(archivePath, { force: true })
    }
  } catch (error) {
    return deviceError(error)
  }
}
