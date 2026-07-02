import type { CreativeCanvas, CreativeCanvasNode, CreativeCanvasRun } from './types'
import { getCanvasModel } from './model-registry'

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
  statusRefresh: {
    method: 'PUT'
    path: string
    bodyShape: {
      status: 'queued | running | waiting_for_review | failed | cancelled'
      providerStatus?: 'string'
      providerStatusMessage?: 'string'
      error?: {
        code: 'string'
        message: 'string'
        retryable: 'boolean'
      }
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
  options?: { includeReferenceImages?: boolean },
): HiggsfieldExecutionManifest['sourceMedia'] {
  const sourceIds = new Set(run.input.sourceNodeIds)
  const fromNodes = (canvas?.nodes ?? [])
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
  // Reference URLs gathered from linked nodes at generate time (the combine
  // flow) arrive on the run input directly — include any not already covered.
  // Audio models take no image references, so callers can opt out.
  if (options?.includeReferenceImages === false) return fromNodes
  const covered = new Set(fromNodes.map((item) => item.value))
  const fromReferences = (run.input.referenceImageUrls ?? [])
    .filter((url) => !covered.has(url))
    .map((url, index) => ({
      nodeId: `reference-${index + 1}`,
      flag: '--image' as const,
      value: url,
      role: 'general',
    }))
  return [...fromNodes, ...fromReferences]
}

export function buildHiggsfieldExecutionManifest(
  run: CreativeCanvasRun & { id: string },
  canvas: Pick<CreativeCanvas, 'id' | 'orgId' | 'nodes'>,
): HiggsfieldExecutionManifest | undefined {
  if (run.providerKey !== 'higgsfield') return undefined

  const model = run.model || 'nano_banana_flash'
  // Audio runs carry no visual settings: guard every image/video-only hint so
  // the executor never receives aspect-ratio / mask / blend flags for a model
  // that cannot accept them. Detected from the catalog kind (authoritative)
  // with the run's requested outputKind as fallback for uncatalogued models.
  const isAudio = getCanvasModel(model)?.kind === 'audio' || run.input.outputKind === 'audio'
  const prompt = run.input.promptSummary || 'Generate a reviewable internal creative asset from the Creative Canvas run.'
  const sourceMedia = buildSourceMedia(run, canvas, { includeReferenceImages: !isAudio })
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
    statusRefresh: {
      method: 'PUT',
      path: `/api/v1/creative-canvas/${canvas.id}/runs/${run.id}/provider-status?orgId=${encodeURIComponent(canvas.orgId)}`,
      bodyShape: {
        status: 'queued | running | waiting_for_review | failed | cancelled',
        providerStatus: 'string',
        providerStatusMessage: 'string',
        error: {
          code: 'string',
          message: 'string',
          retryable: 'boolean',
        },
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
      editIntent: run.input.editIntent,
      lightMatch: run.input.blendControls?.lightMatch ? 'true' : undefined,
      textureAdaptive: run.input.blendControls?.textureAdaptive ? 'true' : undefined,
      autoShadows: run.input.blendControls?.autoShadows ? 'true' : undefined,
      perspectiveMatch: run.input.blendControls?.perspectiveMatch ? 'true' : undefined,
      preserveSubject: run.input.blendControls?.preserveSubject ? 'true' : undefined,
      maskRegion: run.input.editMask?.region
        ? `${run.input.editMask.region.x},${run.input.editMask.region.y},${run.input.editMask.region.width},${run.input.editMask.region.height},${run.input.editMask.region.unit}`
        : undefined,
      brushStrokeCount: run.input.editMask?.brush?.strokes.length,
    },
    instructions: [
      'Run `higgsfield auth login` if the CLI session has expired before dispatch.',
      `Inspect model-specific params with \`higgsfield model get ${model} --json\` before adding optional flags.`,
      run.input.editIntent
        ? `Honor edit intent ${run.input.editIntent}; for inpainting, use the mask plus prompt and preserve enabled blend controls for light, texture, shadows, perspective, and subject continuity.`
        : 'For image edits, preserve brush/prompt semantics and blend controls when the run input includes them.',
      'Create the job without --wait when an asynchronous provider callback will complete the canvas run.',
      'After the CLI returns a job id, call the provider-dispatch endpoint with providerJobId and any provider status/request metadata.',
      'While polling, report non-terminal provider states to the provider-status endpoint; use failed/cancelled there when no output will arrive.',
      'Do not publish, schedule, share, or make the output client-visible without the Creative Canvas review gate passing.',
    ],
  }
}
