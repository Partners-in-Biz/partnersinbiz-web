import type { CreativeCanvas, CreativeCanvasNode, CreativeCanvasRun } from './types'

export interface HiggsfieldExecutionManifest {
  providerKey: 'higgsfield'
  cli: {
    command: 'higgsfield'
    args: string[]
    display: string
  }
  dispatch: {
    method: 'PUT'
    path: string
    bodyShape: {
      providerJobId: 'string'
      providerStatusUrl?: 'string'
      providerRequestId?: 'string'
      providerCallbackUrl?: 'string'
    }
  }
  callback: {
    method: 'POST'
    path: '/api/v1/creative-canvas/provider-callbacks/higgsfield'
    requiredHeader: 'x-creative-canvas-provider-secret'
  }
  sourceMedia: Array<{
    nodeId: string
    flag: '--image' | '--video' | '--audio'
    value: string
    role?: string
  }>
  generationSettings: Record<string, string | number | undefined>
  instructions: string[]
}

function shellQuote(value: string): string {
  if (/^[a-zA-Z0-9_./:=@-]+$/.test(value)) return value
  return `'${value.replace(/'/g, "'\\''")}'`
}

function sourceMediaValue(node: CreativeCanvasNode): string | undefined {
  return node.source?.storagePath
    ?? node.source?.url
    ?? node.source?.previewUrl
    ?? node.source?.refId
    ?? node.output?.url
    ?? node.output?.storagePath
    ?? node.output?.artifactId
}

function sourceMediaFlag(node: CreativeCanvasNode): '--image' | '--video' | '--audio' {
  const mime = node.source?.mimeType ?? ''
  const kind = node.output?.kind
  if (mime.startsWith('video/') || kind === 'video' || kind === 'youtube_render') return '--video'
  if (mime.startsWith('audio/') || kind === 'audio') return '--audio'
  return '--image'
}

function buildSourceMedia(
  run: CreativeCanvasRun,
  canvas: Pick<CreativeCanvas, 'nodes'> | undefined,
): HiggsfieldExecutionManifest['sourceMedia'] {
  if (!canvas?.nodes?.length) return []
  const sourceIds = new Set(run.input.sourceNodeIds)
  return canvas.nodes
    .filter((node) => sourceIds.has(node.id))
    .map((node) => {
      const value = sourceMediaValue(node)
      if (!value) return null
      return {
        nodeId: node.id,
        flag: sourceMediaFlag(node),
        value,
        role: node.source?.referenceRole,
      }
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
}

export function buildHiggsfieldExecutionManifest(
  run: CreativeCanvasRun & { id: string },
  canvas: Pick<CreativeCanvas, 'id' | 'orgId' | 'nodes'>,
): HiggsfieldExecutionManifest | undefined {
  if (run.providerKey !== 'higgsfield') return undefined

  const model = run.model || 'nano_banana_flash'
  const prompt = run.input.promptSummary || 'Generate a reviewable internal creative asset from the Creative Canvas run.'
  const sourceMedia = buildSourceMedia(run, canvas)
  const args = ['generate', 'create', model, '--prompt', prompt, '--json']
  sourceMedia.forEach((media) => {
    args.push(media.flag, media.value)
  })

  return {
    providerKey: 'higgsfield',
    cli: {
      command: 'higgsfield',
      args,
      display: ['higgsfield', ...args.map(shellQuote)].join(' '),
    },
    dispatch: {
      method: 'PUT',
      path: `/api/v1/creative-canvas/${canvas.id}/runs/${run.id}/provider-dispatch?orgId=${encodeURIComponent(canvas.orgId)}`,
      bodyShape: {
        providerJobId: 'string',
        providerStatusUrl: 'string',
        providerRequestId: 'string',
        providerCallbackUrl: 'string',
      },
    },
    callback: {
      method: 'POST',
      path: '/api/v1/creative-canvas/provider-callbacks/higgsfield',
      requiredHeader: 'x-creative-canvas-provider-secret',
    },
    sourceMedia,
    generationSettings: {
      outputKind: run.input.outputKind,
      operation: run.input.operation,
      aspectRatio: run.input.aspectRatio,
      durationSeconds: run.input.durationSeconds,
      variantCount: run.input.variantCount,
      seed: run.input.seed,
      stylePreset: run.input.stylePreset,
      cameraMotion: run.input.cameraMotion,
      negativePrompt: run.input.negativePrompt,
    },
    instructions: [
      'Run `higgsfield auth login` if the CLI session has expired before dispatch.',
      `Inspect model-specific params with \`higgsfield model get ${model} --json\` before adding optional flags.`,
      'Create the job without --wait when an asynchronous provider callback will complete the canvas run.',
      'After the CLI returns a job id, call the provider-dispatch endpoint with providerJobId and any provider status/request metadata.',
      'Do not publish, schedule, share, or make the output client-visible without the Creative Canvas review gate passing.',
    ],
  }
}
