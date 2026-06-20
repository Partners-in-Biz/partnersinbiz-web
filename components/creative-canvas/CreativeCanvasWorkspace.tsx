'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  addEdge,
  type Connection,
  type Edge,
  type Node,
} from '@xyflow/react'
import type {
  CreativeCanvas,
  CreativeCanvasEdge,
  CreativeCanvasExport,
  CreativeCanvasNode,
  CreativeCanvasNodeType,
  CreativeCanvasRun,
  CreativeCanvasSourceLibraryItem,
  CreativeCanvasVersion,
} from '@/lib/creative-canvas/types'
import { buildCreativeCanvasOrchestrationPlan } from '@/lib/creative-canvas/orchestration'

type CreativeCanvasMode = 'admin' | 'portal'

interface CreativeCanvasWorkspaceProps {
  mode: CreativeCanvasMode
  orgId?: string
}

interface CreativeCanvasApiListResponse {
  success?: boolean
  data?: {
    canvases?: CreativeCanvas[]
  }
}

interface CreativeCanvasVersionApiResponse {
  success?: boolean
  data?: {
    versions?: Array<CreativeCanvasVersion & { id?: string }>
  }
}

interface CreativeCanvasSourceLibraryApiResponse {
  success?: boolean
  data?: {
    sources?: CreativeCanvasSourceLibraryItem[]
    source?: CreativeCanvasSourceLibraryItem
  }
}

interface CreativeCanvasRunApiResponse {
  success?: boolean
  data?: {
    runs?: Array<CreativeCanvasRun & { id: string }>
    run?: CreativeCanvasRun & { id: string }
    agentTaskDraft?: {
      agentInput?: {
        providerExecution?: {
          cli?: {
            display?: string
          }
          dispatch?: {
            path?: string
          }
          callback?: {
            path?: string
          }
          statusRefresh?: {
            path?: string
          }
        }
      }
    }
  }
}

const nodeTypeLabels: Record<CreativeCanvasNodeType, string> = {
  source: 'Source',
  brief: 'Brief',
  prompt: 'Prompt',
  model: 'Model',
  edit: 'Edit',
  review: 'Review',
  output: 'Output',
}

const palette: Array<{ type: CreativeCanvasNodeType; label: string; description: string }> = [
  { type: 'source', label: 'Source', description: 'Brand assets, uploads, research, URLs' },
  { type: 'prompt', label: 'Prompt', description: 'Generation brief, style, and constraints' },
  { type: 'model', label: 'Model', description: 'Higgsfield or agent-backed generation' },
  { type: 'edit', label: 'Edit', description: 'Inpaint, masks, style transfer, and motion' },
  { type: 'review', label: 'Review', description: 'Brand, rights, and approval gate' },
  { type: 'output', label: 'Output', description: 'Draft image, video, copy, blog, book asset' },
]

type CreativeCanvasWorkflowPreset = {
  key: string
  label: string
  description: string
  outputKind: CreativeCanvasRun['input']['outputKind']
  exportTarget: CreativeCanvasExport['target']
  aspectRatio: string
  durationSeconds: number
  stylePreset: string
  cameraMotion: string
  negativePrompt: string
  nodes: Array<{
    suffix: string
    type: CreativeCanvasNodeType
    title: string
    data: Record<string, unknown>
    source?: CreativeCanvasNode['source']
    provider?: CreativeCanvasNode['provider']
    edit?: CreativeCanvasNode['edit']
    review?: CreativeCanvasNode['review']
    output?: CreativeCanvasNode['output']
  }>
  edges: Array<{ from: string; to: string; label: string }>
}

const workflowPresets: CreativeCanvasWorkflowPreset[] = [
  {
    key: 'social-launch',
    label: 'Social launch',
    description: 'Product source, UGC prompt, Higgsfield model, review, social draft.',
    outputKind: 'social_post_draft',
    exportTarget: 'social_draft',
    aspectRatio: '9:16',
    durationSeconds: 6,
    stylePreset: 'ugc_product_demo',
    cameraMotion: 'camera_push',
    negativePrompt: 'blurry, distorted hands, false claims, unreadable captions',
    nodes: [
      {
        suffix: 'source',
        type: 'source',
        title: 'Product / brand source',
        data: { workflowRole: 'source', requiredInputs: ['product_image', 'brand_logo', 'offer_context'] },
        source: { kind: 'upload', referenceRole: 'product', weight: 1, altText: 'Product or brand source' },
      },
      {
        suffix: 'brief',
        type: 'brief',
        title: 'Social launch brief',
        data: { workflowRole: 'brief', channel: 'reels_tiktok_shorts', requiredOutputs: ['hook', 'caption', 'cta'] },
      },
      {
        suffix: 'prompt',
        type: 'prompt',
        title: 'UGC launch prompt',
        data: { workflowRole: 'prompt', agentId: 'maya', promptType: 'ugc_social_launch' },
      },
      {
        suffix: 'model',
        type: 'model',
        title: 'Higgsfield vertical video',
        data: { workflowRole: 'generation', ownerAgentId: 'maya' },
        provider: { key: 'higgsfield', model: 'nano_banana_flash', mode: 'vertical_social' },
        edit: { operation: 'video_motion', outputKind: 'social_post_draft', strength: 0.65, motion: { mode: 'camera_push', durationSeconds: 6 }, references: [] },
      },
      {
        suffix: 'review',
        type: 'review',
        title: 'Brand and rights review',
        data: { workflowRole: 'review', requiredReviewerAgentId: 'maya' },
        review: { status: 'needed', syntheticMediaDisclosure: true, rightsStatus: 'needs_review', brandStatus: 'needs_review' },
      },
      {
        suffix: 'output',
        type: 'output',
        title: 'Social post draft',
        data: { workflowRole: 'output', exportTarget: 'social_draft' },
        output: { kind: 'social_post_draft', textPreview: 'Hook, caption, thumbnail, and vertical creative ready for review' },
      },
    ],
    edges: [
      { from: 'source', to: 'brief', label: 'source context' },
      { from: 'brief', to: 'prompt', label: 'brief to prompt' },
      { from: 'prompt', to: 'model', label: 'generate' },
      { from: 'model', to: 'review', label: 'needs review' },
      { from: 'review', to: 'output', label: 'approved draft' },
    ],
  },
  {
    key: 'blog-article',
    label: 'Blog article',
    description: 'Research/source brief into copy draft, review, and document export.',
    outputKind: 'blog_draft',
    exportTarget: 'client_document',
    aspectRatio: '1:1',
    durationSeconds: 5,
    stylePreset: 'editorial_article',
    cameraMotion: 'none',
    negativePrompt: 'unsupported claims, thin advice, duplicated sections',
    nodes: [
      {
        suffix: 'research',
        type: 'source',
        title: 'Research and source packet',
        data: { workflowRole: 'source', requiredInputs: ['research_item', 'client_offer', 'proof_points'] },
        source: { kind: 'research_item', referenceRole: 'general', weight: 1, altText: 'Research packet' },
      },
      {
        suffix: 'brief',
        type: 'brief',
        title: 'Blog strategy brief',
        data: { workflowRole: 'brief', agentId: 'pip', requiredOutputs: ['angle', 'outline', 'seo_notes'] },
      },
      {
        suffix: 'prompt',
        type: 'prompt',
        title: 'Long-form draft prompt',
        data: { workflowRole: 'prompt', agentId: 'pip', promptType: 'blog_article' },
      },
      {
        suffix: 'model',
        type: 'model',
        title: 'Agent copy draft',
        data: { workflowRole: 'generation', ownerAgentId: 'pip' },
        provider: { key: 'agent_task', mode: 'blog_draft' },
      },
      {
        suffix: 'review',
        type: 'review',
        title: 'Editorial review',
        data: { workflowRole: 'review', checks: ['source_support', 'brand_voice', 'cta'] },
        review: { status: 'needed', syntheticMediaDisclosure: false, rightsStatus: 'needs_review', brandStatus: 'needs_review' },
      },
      {
        suffix: 'output',
        type: 'output',
        title: 'Blog draft export',
        data: { workflowRole: 'output', exportTarget: 'client_document' },
        output: { kind: 'blog_draft', textPreview: 'Article outline, draft body, SEO title, meta description, and CTA' },
      },
    ],
    edges: [
      { from: 'research', to: 'brief', label: 'evidence' },
      { from: 'brief', to: 'prompt', label: 'outline' },
      { from: 'prompt', to: 'model', label: 'draft' },
      { from: 'model', to: 'review', label: 'editorial gate' },
      { from: 'review', to: 'output', label: 'document draft' },
    ],
  },
  {
    key: 'video-production',
    label: 'Video production',
    description: 'Script, storyboard, Higgsfield render, review, YouTube/shorts export.',
    outputKind: 'youtube_render',
    exportTarget: 'youtube_studio',
    aspectRatio: '16:9',
    durationSeconds: 15,
    stylePreset: 'cinematic_product',
    cameraMotion: 'camera_push',
    negativePrompt: 'jumpy cuts, off-brand visuals, inaccurate claims',
    nodes: [
      {
        suffix: 'source',
        type: 'source',
        title: 'Video source assets',
        data: { workflowRole: 'source', requiredInputs: ['product_images', 'voice_notes', 'b_roll'] },
        source: { kind: 'youtube_asset', referenceRole: 'motion', weight: 1, altText: 'Video source assets' },
      },
      {
        suffix: 'brief',
        type: 'brief',
        title: 'Video concept brief',
        data: { workflowRole: 'brief', requiredOutputs: ['script', 'shot_list', 'thumbnail_direction'] },
      },
      {
        suffix: 'prompt',
        type: 'prompt',
        title: 'Storyboard prompt',
        data: { workflowRole: 'prompt', agentId: 'maya', promptType: 'video_storyboard' },
      },
      {
        suffix: 'model',
        type: 'model',
        title: 'Higgsfield video render',
        data: { workflowRole: 'generation', ownerAgentId: 'maya' },
        provider: { key: 'higgsfield', model: 'nano_banana_flash', mode: 'video_render' },
        edit: { operation: 'video_motion', outputKind: 'youtube_render', strength: 0.7, motion: { mode: 'camera_push', durationSeconds: 15 }, references: [] },
      },
      {
        suffix: 'review',
        type: 'review',
        title: 'Video QA review',
        data: { workflowRole: 'review', checks: ['brand', 'rights', 'claims', 'thumbnail'] },
        review: { status: 'needed', syntheticMediaDisclosure: true, rightsStatus: 'needs_review', brandStatus: 'needs_review' },
      },
      {
        suffix: 'output',
        type: 'output',
        title: 'Video render package',
        data: { workflowRole: 'output', exportTarget: 'youtube_studio' },
        output: { kind: 'youtube_render', textPreview: 'Video render, thumbnail, description, and chapter draft' },
      },
    ],
    edges: [
      { from: 'source', to: 'brief', label: 'assets' },
      { from: 'brief', to: 'prompt', label: 'storyboard' },
      { from: 'prompt', to: 'model', label: 'render' },
      { from: 'model', to: 'review', label: 'qa gate' },
      { from: 'review', to: 'output', label: 'video package' },
    ],
  },
  {
    key: 'book-package',
    label: 'Book package',
    description: 'Book concept, cover/artifact generation, review, Book Studio export.',
    outputKind: 'book_artifact',
    exportTarget: 'book_studio',
    aspectRatio: '2:3',
    durationSeconds: 5,
    stylePreset: 'book_cover_concept',
    cameraMotion: 'none',
    negativePrompt: 'trademarked characters, misleading author claims, unreadable title text',
    nodes: [
      {
        suffix: 'source',
        type: 'source',
        title: 'Book source material',
        data: { workflowRole: 'source', requiredInputs: ['manuscript_notes', 'audience', 'market_evidence'] },
        source: { kind: 'book_studio_record', referenceRole: 'style', weight: 1, altText: 'Book source material' },
      },
      {
        suffix: 'brief',
        type: 'brief',
        title: 'Book package brief',
        data: { workflowRole: 'brief', requiredOutputs: ['positioning', 'cover_direction', 'metadata_notes'] },
      },
      {
        suffix: 'prompt',
        type: 'prompt',
        title: 'Cover and asset prompt',
        data: { workflowRole: 'prompt', agentId: 'maya', promptType: 'book_cover_artifact' },
      },
      {
        suffix: 'model',
        type: 'model',
        title: 'Higgsfield book asset',
        data: { workflowRole: 'generation', ownerAgentId: 'maya' },
        provider: { key: 'higgsfield', model: 'nano_banana_flash', mode: 'book_artifact' },
        edit: { operation: 'variation', outputKind: 'book_artifact', strength: 0.6, motion: { mode: 'none' }, references: [] },
      },
      {
        suffix: 'review',
        type: 'review',
        title: 'Publishing readiness review',
        data: { workflowRole: 'review', checks: ['rights', 'market_fit', 'store_metadata', 'brand'] },
        review: { status: 'needed', syntheticMediaDisclosure: true, rightsStatus: 'needs_review', brandStatus: 'needs_review' },
      },
      {
        suffix: 'output',
        type: 'output',
        title: 'Book Studio artifact',
        data: { workflowRole: 'output', exportTarget: 'book_studio' },
        output: { kind: 'book_artifact', textPreview: 'Cover concept, metadata notes, and review packet for Book Studio' },
      },
    ],
    edges: [
      { from: 'source', to: 'brief', label: 'source material' },
      { from: 'brief', to: 'prompt', label: 'asset brief' },
      { from: 'prompt', to: 'model', label: 'generate cover' },
      { from: 'model', to: 'review', label: 'publishing gate' },
      { from: 'review', to: 'output', label: 'book artifact' },
    ],
  },
]

function toFlowNode(node: CreativeCanvasNode): Node {
  const previewUrl = node.source?.thumbnailUrl ?? node.source?.previewUrl ?? node.output?.thumbnailUrl ?? node.output?.url
  return {
    id: node.id,
    type: 'default',
    position: node.position,
    data: {
      label: (
        <div className="min-w-36">
          {previewUrl ? (
            <img
              src={previewUrl}
              alt={`Reference preview: ${node.source?.altText ?? node.title}`}
              className="mb-2 h-20 w-full rounded-md object-cover"
            />
          ) : null}
          <p className="text-[10px] font-semibold uppercase tracking-normal text-[var(--color-pib-text-muted)]">
            {nodeTypeLabels[node.type]}
          </p>
          <p className="text-sm font-semibold text-[var(--color-pib-text)]">{node.title}</p>
        </div>
      ),
      canvasNode: node,
    },
  }
}

function toCanvasNode(node: Node, orgId: string): CreativeCanvasNode {
  const canvasNode = node.data?.canvasNode as CreativeCanvasNode | undefined
  return {
    id: node.id,
    orgId,
    type: canvasNode?.type ?? 'source',
    title: canvasNode?.title ?? node.id,
    position: node.position,
    data: canvasNode?.data ?? {},
    source: canvasNode?.source,
    provider: canvasNode?.provider,
    edit: canvasNode?.edit,
    review: canvasNode?.review,
    output: canvasNode?.output,
  }
}

function toFlowEdge(edge: CreativeCanvasEdge): Edge {
  return {
    id: edge.id,
    source: edge.sourceNodeId,
    target: edge.targetNodeId,
    label: edge.label,
    data: edge.data,
  }
}

function toCanvasEdge(edge: Edge, orgId: string): CreativeCanvasEdge {
  return {
    id: edge.id,
    orgId,
    sourceNodeId: edge.source,
    targetNodeId: edge.target,
    label: typeof edge.label === 'string' ? edge.label : undefined,
    data: typeof edge.data === 'object' && edge.data ? edge.data : undefined,
  }
}

export function CreativeCanvasWorkspace({ mode, orgId }: CreativeCanvasWorkspaceProps) {
  const [canvases, setCanvases] = useState<CreativeCanvas[]>([])
  const [activeCanvasId, setActiveCanvasId] = useState<string>('')
  const [nodes, setNodes] = useState<Node[]>([])
  const [edges, setEdges] = useState<Edge[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState('')
  const [versions, setVersions] = useState<Array<CreativeCanvasVersion & { id?: string }>>([])
  const [commentBody, setCommentBody] = useState('')
  const [activityMessage, setActivityMessage] = useState('')
  const [exportTarget, setExportTarget] = useState<CreativeCanvasExport['target']>('campaign_asset')
  const [latestRun, setLatestRun] = useState<{ id: string; status: string; nodeId?: string } | null>(null)
  const [runOutputKind, setRunOutputKind] = useState('image')
  const [runAspectRatio, setRunAspectRatio] = useState('1:1')
  const [runDurationSeconds, setRunDurationSeconds] = useState(5)
  const [runVariantCount, setRunVariantCount] = useState(1)
  const [runStylePreset, setRunStylePreset] = useState('cinematic_product')
  const [runCameraMotion, setRunCameraMotion] = useState('none')
  const [runNegativePrompt, setRunNegativePrompt] = useState('')
  const [sourceLibrary, setSourceLibrary] = useState<CreativeCanvasSourceLibraryItem[]>([])
  const [maskRegion, setMaskRegion] = useState({ x: 0, y: 0, width: 50, height: 50, feather: 0 })
  const [runHistory, setRunHistory] = useState<Array<CreativeCanvasRun & { id: string }>>([])
  const [latestExecution, setLatestExecution] = useState<{ command?: string; dispatchPath?: string; callbackPath?: string; statusPath?: string } | null>(null)
  const [sourceQuery, setSourceQuery] = useState('')
  const [sourceKindFilter, setSourceKindFilter] = useState('')
  const [sourceRoleFilter, setSourceRoleFilter] = useState('')
  const [sourceMediaFilter, setSourceMediaFilter] = useState('')
  const [sourceUploadRole, setSourceUploadRole] = useState('product')
  const [sourceUploadAltText, setSourceUploadAltText] = useState('')
  const [sourceUploading, setSourceUploading] = useState(false)

  const activeCanvas = useMemo(
    () => canvases.find((canvas) => canvas.id === activeCanvasId) ?? canvases[0],
    [activeCanvasId, canvases]
  )

  const resolvedOrgId = orgId ?? activeCanvas?.orgId ?? ''
  const selectedCanvasNode = useMemo(() => {
    const flowNode = nodes[0]
    return flowNode?.data?.canvasNode as CreativeCanvasNode | undefined
  }, [nodes])

  const selectedNodeId = selectedCanvasNode?.id
  const orchestrationPlan = useMemo(() => buildCreativeCanvasOrchestrationPlan({
    id: activeCanvas?.id,
    orgId: resolvedOrgId || activeCanvas?.orgId || 'pending-org',
    nodes: nodes.map((node) => toCanvasNode(node, resolvedOrgId || activeCanvas?.orgId || 'pending-org')),
    edges: edges.map((edge) => toCanvasEdge(edge, resolvedOrgId || activeCanvas?.orgId || 'pending-org')),
  }), [activeCanvas?.id, activeCanvas?.orgId, edges, nodes, resolvedOrgId])

  const loadVersions = useCallback(async (canvasId: string, canvasOrgId: string) => {
    if (!canvasId || !canvasOrgId) {
      setVersions([])
      return
    }

    const response = await fetch(`/api/v1/creative-canvas/${canvasId}/versions?orgId=${encodeURIComponent(canvasOrgId)}`)
    const payload = (await response.json()) as CreativeCanvasVersionApiResponse
    setVersions(payload.data?.versions ?? [])
  }, [])

  const loadRuns = useCallback(async (canvasId: string, canvasOrgId: string) => {
    if (!canvasId || !canvasOrgId) {
      setRunHistory([])
      return
    }

    const response = await fetch(`/api/v1/creative-canvas/${canvasId}/runs?orgId=${encodeURIComponent(canvasOrgId)}`)
    const payload = (await response.json()) as CreativeCanvasRunApiResponse
    setRunHistory(payload.data?.runs ?? [])
  }, [])

  useEffect(() => {
    let cancelled = false
    const loadCanvases = async () => {
      setLoading(true)
      setError('')

      try {
        const query = orgId ? `?orgId=${encodeURIComponent(orgId)}` : ''
        const response = await fetch(`/api/v1/creative-canvas${query}`)
        const payload = (await response.json()) as CreativeCanvasApiListResponse
        const loadedCanvases = payload.data?.canvases ?? []

        if (cancelled) return

        setCanvases(loadedCanvases)
        const firstCanvas = loadedCanvases[0]
        setActiveCanvasId(firstCanvas?.id ?? '')
        setNodes((firstCanvas?.nodes ?? []).map(toFlowNode))
        setEdges((firstCanvas?.edges ?? []).map(toFlowEdge))
        if (firstCanvas?.id) {
          await loadVersions(firstCanvas.id, orgId ?? firstCanvas.orgId)
          await loadRuns(firstCanvas.id, orgId ?? firstCanvas.orgId)
        } else {
          setVersions([])
          setRunHistory([])
        }
      } catch {
        if (!cancelled) {
          setError('Creative Canvas could not load.')
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    loadCanvases()

    return () => {
      cancelled = true
    }
  }, [loadRuns, loadVersions, orgId])

  useEffect(() => {
    let cancelled = false
    const loadSourceLibrary = async () => {
      if (!resolvedOrgId) {
        setSourceLibrary([])
        return
      }
      try {
        const params = new URLSearchParams({ orgId: resolvedOrgId, limit: '24' })
        if (sourceQuery.trim()) params.set('q', sourceQuery.trim())
        if (sourceKindFilter) params.set('sourceKind', sourceKindFilter)
        if (sourceRoleFilter) params.set('referenceRole', sourceRoleFilter)
        if (sourceMediaFilter) params.set('mediaType', sourceMediaFilter)
        const response = await fetch(`/api/v1/creative-canvas/sources?${params.toString()}`)
        const payload = (await response.json()) as CreativeCanvasSourceLibraryApiResponse
        if (!cancelled) setSourceLibrary(payload.data?.sources ?? [])
      } catch {
        if (!cancelled) setSourceLibrary([])
      }
    }

    loadSourceLibrary()

    return () => {
      cancelled = true
    }
  }, [resolvedOrgId, sourceKindFilter, sourceMediaFilter, sourceQuery, sourceRoleFilter])

  const onConnect = useCallback((connection: Connection) => {
    setEdges((currentEdges) => addEdge(connection, currentEdges))
  }, [])

  const addCanvasNode = (type: CreativeCanvasNodeType) => {
    const nextNumber = nodes.length + 1
    const title = `${nodeTypeLabels[type]} node`
    const id = `${type}-node-${Date.now()}`
    const canvasNode: CreativeCanvasNode = {
      id,
      orgId: resolvedOrgId || 'pending-org',
      type,
      title,
      position: { x: 80 + nextNumber * 40, y: 90 + nextNumber * 28 },
      data: { createdFrom: 'creative_canvas_palette' },
      source: type === 'source'
        ? {
            kind: 'upload',
            referenceRole: 'general',
            weight: 1,
            altText: title,
          }
        : undefined,
      edit: type === 'edit'
        ? {
            operation: 'inpaint',
            prompt: 'Describe the edit',
            references: [],
            strength: 0.65,
            motion: { mode: 'none' },
            outputKind: 'image',
          }
        : undefined,
      review: type === 'review'
        ? {
            status: 'needed',
            syntheticMediaDisclosure: true,
            rightsStatus: 'needs_review',
            brandStatus: 'needs_review',
          }
        : undefined,
    }

    setNodes((currentNodes) => [...currentNodes, toFlowNode(canvasNode)])
    setSaveMessage('')
  }

  const applyWorkflowPreset = (preset: CreativeCanvasWorkflowPreset) => {
    const baseX = 80 + nodes.length * 18
    const baseY = 90 + nodes.length * 12
    const stamp = Date.now()
    const org = resolvedOrgId || 'pending-org'
    const idFor = (suffix: string) => `${preset.key}-${suffix}-${stamp}`
    const nextNodes = preset.nodes.map((template, index): CreativeCanvasNode => ({
      id: idFor(template.suffix),
      orgId: org,
      type: template.type,
      title: template.title,
      position: {
        x: baseX + (index % 3) * 260,
        y: baseY + Math.floor(index / 3) * 180,
      },
      data: {
        ...template.data,
        createdFrom: 'creative_canvas_workflow_preset',
        workflowPreset: preset.key,
      },
      source: template.source,
      provider: template.provider,
      edit: template.edit,
      review: template.review,
      output: template.output,
    }))
    const nextEdges: Edge[] = preset.edges.map((edge) => ({
      id: `${preset.key}-${edge.from}-${edge.to}-${stamp}`,
      source: idFor(edge.from),
      target: idFor(edge.to),
      label: edge.label,
      data: {
        createdFrom: 'creative_canvas_workflow_preset',
        workflowPreset: preset.key,
      },
    }))

    setNodes((currentNodes) => [...currentNodes, ...nextNodes.map(toFlowNode)])
    setEdges((currentEdges) => [...currentEdges, ...nextEdges])
    setRunOutputKind(preset.outputKind ?? 'image')
    setExportTarget(preset.exportTarget)
    setRunAspectRatio(preset.aspectRatio)
    setRunDurationSeconds(preset.durationSeconds)
    setRunStylePreset(preset.stylePreset)
    setRunCameraMotion(preset.cameraMotion)
    setRunNegativePrompt(preset.negativePrompt)
    setSaveMessage('')
    setActivityMessage(`${preset.label} workflow added`)
  }

  const openCanvas = async (canvas: CreativeCanvas) => {
    setActiveCanvasId(canvas.id ?? '')
    setNodes(canvas.nodes.map(toFlowNode))
    setEdges(canvas.edges.map(toFlowEdge))
    setLatestExecution(null)
    if (canvas.id) {
      await loadVersions(canvas.id, orgId ?? canvas.orgId)
      await loadRuns(canvas.id, orgId ?? canvas.orgId)
    }
  }

  const importSourceItem = (item: CreativeCanvasSourceLibraryItem) => {
    const nextNumber = nodes.length + 1
    const canvasNode: CreativeCanvasNode = {
      id: `source-${item.source.refId ?? Date.now()}-${Date.now()}`,
      orgId: resolvedOrgId || 'pending-org',
      type: 'source',
      title: item.title,
      position: { x: 80 + nextNumber * 40, y: 90 + nextNumber * 28 },
      data: {
        createdFrom: 'creative_canvas_source_library',
        sourceLibraryId: item.id,
        sourceCollection: item.sourceCollection,
      },
      source: item.source,
    }

    setNodes((currentNodes) => [...currentNodes, toFlowNode(canvasNode)])
    setSaveMessage('')
  }

  const uploadSourceFiles = async (files: FileList | null) => {
    if (!files?.length || !resolvedOrgId) return
    setSourceUploading(true)
    setActivityMessage('')
    try {
      const uploaded: CreativeCanvasSourceLibraryItem[] = []
      for (const file of Array.from(files)) {
        const form = new FormData()
        form.append('orgId', resolvedOrgId)
        if (activeCanvas?.id) form.append('canvasId', activeCanvas.id)
        form.append('referenceRole', sourceUploadRole)
        if (sourceUploadAltText.trim()) form.append('altText', sourceUploadAltText.trim())
        form.append('file', file)
        const response = await fetch('/api/v1/creative-canvas/sources/upload', { method: 'POST', body: form })
        const payload = await response.json().catch(() => null) as CreativeCanvasSourceLibraryApiResponse | null
        const source = payload?.data?.source
        if (!response.ok || !source) throw new Error('Source upload failed')
        uploaded.push(source)
      }
      uploaded.forEach(importSourceItem)
      setSourceLibrary((current) => [...uploaded, ...current.filter((item) => !uploaded.some((source) => source.id === item.id))])
      setActivityMessage(uploaded.length === 1 ? `Source uploaded: ${uploaded[0].title}` : `${uploaded.length} sources uploaded`)
      setSourceUploadAltText('')
    } catch {
      setActivityMessage('Source upload failed')
    } finally {
      setSourceUploading(false)
    }
  }

  const updateMaskRegionValue = (key: keyof typeof maskRegion, value: string) => {
    setMaskRegion((current) => ({
      ...current,
      [key]: Math.max(0, Number(value) || 0),
    }))
  }

  const applyMaskRegion = () => {
    if (!selectedCanvasNode?.edit) return

    const region = {
      x: Math.min(100, maskRegion.x),
      y: Math.min(100, maskRegion.y),
      width: Math.min(100, maskRegion.width),
      height: Math.min(100, maskRegion.height),
      unit: 'percent' as const,
      feather: Math.min(100, maskRegion.feather),
    }

    setNodes((currentNodes) => currentNodes.map((node) => {
      if (node.id !== selectedCanvasNode.id) return node
      const canvasNode = node.data?.canvasNode as CreativeCanvasNode | undefined
      if (!canvasNode?.edit) return node
      const nextCanvasNode: CreativeCanvasNode = {
        ...canvasNode,
        edit: {
          ...canvasNode.edit,
          mask: {
            ...canvasNode.edit.mask,
            region,
          },
        },
      }
      return toFlowNode(nextCanvasNode)
    }))
    setSaveMessage('')
  }

  const saveGraph = async () => {
    if (!activeCanvas?.id) return

    setSaving(true)
    setSaveMessage('')

    try {
      const query = resolvedOrgId ? `?orgId=${encodeURIComponent(resolvedOrgId)}` : ''
      const response = await fetch(`/api/v1/creative-canvas/${activeCanvas.id}/graph${query}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nodes: nodes.map((node) => toCanvasNode(node, resolvedOrgId || activeCanvas.orgId)),
          edges: edges.map((edge) => toCanvasEdge(edge, resolvedOrgId || activeCanvas.orgId)),
        }),
      })

      if (!response.ok) {
        throw new Error('Save failed')
      }

      setSaveMessage('Graph saved')
      await loadVersions(activeCanvas.id, resolvedOrgId || activeCanvas.orgId)
    } catch {
      setSaveMessage('Graph save failed')
    } finally {
      setSaving(false)
    }
  }

  const postComment = async () => {
    if (!activeCanvas?.id || !commentBody.trim()) return

    const query = resolvedOrgId ? `?orgId=${encodeURIComponent(resolvedOrgId)}` : ''
    const response = await fetch(`/api/v1/creative-canvas/${activeCanvas.id}/comments${query}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nodeId: selectedNodeId,
        body: commentBody,
        visibility: mode === 'portal' ? 'admin_agents_clients' : 'admin_agents',
      }),
    })

    if (response.ok) {
      setActivityMessage('Comment added')
      setCommentBody('')
    } else {
      setActivityMessage('Comment failed')
    }
  }

  const attachSampleOutput = async () => {
    if (!activeCanvas?.id || !selectedNodeId) return

    const query = resolvedOrgId ? `?orgId=${encodeURIComponent(resolvedOrgId)}` : ''
    const response = await fetch(`/api/v1/creative-canvas/${activeCanvas.id}/nodes/${selectedNodeId}/output${query}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'image',
        textPreview: 'Review-ready creative output',
        review: {
          status: 'needed',
          rightsStatus: 'needs_review',
          brandStatus: 'needs_review',
          syntheticMediaDisclosure: true,
        },
      }),
    })
    setActivityMessage(response.ok ? 'Output attached for review' : 'Output attach failed')
  }

  const markReviewPassed = async () => {
    if (!activeCanvas?.id || !selectedNodeId) return

    const query = resolvedOrgId ? `?orgId=${encodeURIComponent(resolvedOrgId)}` : ''
    const response = await fetch(`/api/v1/creative-canvas/${activeCanvas.id}/nodes/${selectedNodeId}/review${query}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'passed',
        rightsStatus: 'cleared',
        brandStatus: 'passed',
        syntheticMediaDisclosure: true,
      }),
    })
    setActivityMessage(response.ok ? 'Review gate passed' : 'Review update failed')
  }

  const queueRun = async () => {
    if (!activeCanvas?.id || !selectedNodeId) return

    const selectedEdit = selectedCanvasNode?.edit
    const query = resolvedOrgId ? `?orgId=${encodeURIComponent(resolvedOrgId)}` : ''
    const response = await fetch(`/api/v1/creative-canvas/${activeCanvas.id}/runs${query}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        canvasId: activeCanvas.id,
        nodeId: selectedNodeId,
        providerKey: 'higgsfield',
        model: selectedCanvasNode?.provider?.model,
        input: {
          promptSummary: 'Generate a reviewable creative asset from the active canvas node.',
          sourceNodeIds: selectedNodeId ? [selectedNodeId] : [],
          sourceArtifactIds: [],
          format: 'internal_draft',
          outputKind: selectedEdit?.outputKind ?? runOutputKind,
          operation: selectedEdit?.operation,
          aspectRatio: runAspectRatio,
          durationSeconds: runDurationSeconds,
          variantCount: runVariantCount,
          stylePreset: runStylePreset,
          cameraMotion: selectedEdit?.motion?.mode && selectedEdit.motion.mode !== 'none'
            ? selectedEdit.motion.mode
            : runCameraMotion,
          negativePrompt: runNegativePrompt,
        },
      }),
    })
    if (!response.ok) {
      setActivityMessage('Run queue failed')
      return
    }
    const payload = await response.json().catch(() => null) as CreativeCanvasRunApiResponse | null
    const run = payload?.data?.run
    if (run?.id) {
      setLatestRun({ id: run.id, status: run.status ?? 'queued', nodeId: run.nodeId })
      setRunHistory((currentRuns) => [run, ...currentRuns.filter((item) => item.id !== run.id)])
      const providerExecution = payload?.data?.agentTaskDraft?.agentInput?.providerExecution
      setLatestExecution({
        command: providerExecution?.cli?.display,
        dispatchPath: providerExecution?.dispatch?.path,
        callbackPath: providerExecution?.callback?.path,
        statusPath: providerExecution?.statusRefresh?.path,
      })
      setActivityMessage(`Run queued: ${run.id}`)
    } else {
      setActivityMessage('Run queued for agent review')
    }
  }

  const refreshLatestRunStatus = async () => {
    if (!activeCanvas?.id || !latestRun?.id) return

    const query = resolvedOrgId ? `?orgId=${encodeURIComponent(resolvedOrgId)}` : ''
    const response = await fetch(`/api/v1/creative-canvas/${activeCanvas.id}/runs/${latestRun.id}/provider-status${query}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'running',
        providerStatus: 'poll_requested',
        providerStatusMessage: 'Manual status refresh requested from Creative Canvas.',
      }),
    })
    if (response.ok) {
      const payload = await response.json().catch(() => null) as CreativeCanvasRunApiResponse | null
      const run = payload?.data?.run
      if (run?.id) {
        setLatestRun({ id: run.id, status: run.status ?? 'running', nodeId: run.nodeId })
        setRunHistory((currentRuns) => [run, ...currentRuns.filter((item) => item.id !== run.id)])
      } else {
        await loadRuns(activeCanvas.id, resolvedOrgId || activeCanvas.orgId)
      }
      setActivityMessage(`Run status refreshed: ${latestRun.id}`)
    } else {
      setActivityMessage('Run status refresh failed')
    }
  }

  const ingestRunOutput = async () => {
    if (!activeCanvas?.id || !latestRun?.id) return

    const query = resolvedOrgId ? `?orgId=${encodeURIComponent(resolvedOrgId)}` : ''
    const response = await fetch(`/api/v1/creative-canvas/${activeCanvas.id}/runs/${latestRun.id}/complete${query}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        outputNodeId: `${latestRun.nodeId ?? selectedNodeId ?? 'run'}-output`,
        output: {
          kind: 'image',
          textPreview: 'Provider output ready for review',
        },
        provenance: {
          costLabel: 'provider_reported',
        },
      }),
    })
    if (response.ok) {
      setLatestRun((current) => current ? { ...current, status: 'completed' } : current)
      await loadRuns(activeCanvas.id, resolvedOrgId || activeCanvas.orgId)
      setActivityMessage(`Run completed: ${latestRun.id}`)
    } else {
      setActivityMessage('Run output ingest failed')
    }
  }

  const exportDraft = async () => {
    if (!activeCanvas?.id || !selectedNodeId) return

    const query = resolvedOrgId ? `?orgId=${encodeURIComponent(resolvedOrgId)}` : ''
    const response = await fetch(`/api/v1/creative-canvas/${activeCanvas.id}/exports/draft${query}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nodeId: selectedNodeId,
        target: exportTarget,
      }),
    })
    setActivityMessage(response.ok ? 'Draft export prepared' : 'Draft export failed')
  }

  if (loading) {
    return (
      <main className="mx-auto max-w-7xl space-y-5 px-4 py-6">
        <div className="pib-skeleton h-[520px]" />
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-7xl space-y-5 px-4 py-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="eyebrow">{mode === 'admin' ? 'Agent creative command' : 'Creative review'}</p>
          <h1 className="text-3xl font-headline font-bold text-[var(--color-pib-text)]">Creative Canvas</h1>
          <p className="mt-2 max-w-3xl text-sm text-[var(--color-pib-text-muted)]">
            Plan, generate, review, and export social posts, blogs, videos, books, and campaign assets from one agent-aware graph.
          </p>
        </div>
        <button
          type="button"
          onClick={saveGraph}
          disabled={!activeCanvas?.id || saving}
          className="rounded-lg bg-[var(--color-pib-primary)] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? 'Saving graph' : 'Save graph'}
        </button>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : null}

      <section className="grid min-h-[620px] gap-4 lg:grid-cols-[260px_minmax(0,1fr)_280px]">
        <aside className="space-y-4 rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-card)] p-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-normal text-[var(--color-pib-text-muted)]">Canvases</p>
            <div className="mt-3 space-y-2">
              {canvases.map((canvas) => (
                <button
                  key={canvas.id}
                  type="button"
                  aria-label={`Open ${canvas.title}`}
                  onClick={() => { void openCanvas(canvas) }}
                  className="w-full rounded-lg border border-[var(--color-pib-line)] px-3 py-2 text-left text-sm text-[var(--color-pib-text)] transition hover:bg-[var(--color-pib-surface)]"
                >
                  <span className="block font-semibold">Canvas: {canvas.title}</span>
                  <span className="block text-xs text-[var(--color-pib-text-muted)]">{canvas.purpose}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-normal text-[var(--color-pib-text-muted)]">Palette</p>
            <div className="mt-3 space-y-2">
              {palette.map((item) => (
                <button
                  key={item.type}
                  type="button"
                  aria-label={`Add ${item.type} node`}
                  onClick={() => addCanvasNode(item.type)}
                  className="w-full rounded-lg border border-[var(--color-pib-line)] px-3 py-2 text-left transition hover:bg-[var(--color-pib-surface)]"
                >
                  <span className="block text-sm font-semibold text-[var(--color-pib-text)]">{item.label}</span>
                  <span className="block text-xs text-[var(--color-pib-text-muted)]">{item.description}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-normal text-[var(--color-pib-text-muted)]">Workflow presets</p>
            <div className="mt-3 space-y-2">
              {workflowPresets.map((preset) => (
                <button
                  key={preset.key}
                  type="button"
                  aria-label={`Apply ${preset.label} workflow`}
                  onClick={() => applyWorkflowPreset(preset)}
                  className="w-full rounded-lg border border-[var(--color-pib-line)] px-3 py-2 text-left transition hover:bg-[var(--color-pib-surface)]"
                >
                  <span className="block text-sm font-semibold text-[var(--color-pib-text)]">{preset.label}</span>
                  <span className="block text-xs text-[var(--color-pib-text-muted)]">{preset.description}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-normal text-[var(--color-pib-text-muted)]">Source library</p>
            <div className="mt-3 space-y-2">
              <label className="block text-xs font-medium text-[var(--color-pib-text-muted)]" htmlFor="creative-canvas-source-search">
                Search sources
                <input
                  id="creative-canvas-source-search"
                  value={sourceQuery}
                  onChange={(event) => setSourceQuery(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-white px-2 py-1.5 text-xs text-[var(--color-pib-text)]"
                  placeholder="Product, UGC, founder, cover..."
                />
              </label>
              <div className="grid grid-cols-1 gap-2">
                <label className="text-xs font-medium text-[var(--color-pib-text-muted)]" htmlFor="creative-canvas-source-kind">
                  Source kind
                  <select
                    id="creative-canvas-source-kind"
                    value={sourceKindFilter}
                    onChange={(event) => setSourceKindFilter(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-white px-2 py-1.5 text-xs text-[var(--color-pib-text)]"
                  >
                    <option value="">All sources</option>
                    <option value="upload">Uploads</option>
                    <option value="workspace_artifact">Workspace artifacts</option>
                    <option value="research_item">Research</option>
                    <option value="social_post">Social media/posts</option>
                    <option value="youtube_asset">YouTube assets</option>
                    <option value="book_studio_record">Book Studio</option>
                  </select>
                </label>
                <label className="text-xs font-medium text-[var(--color-pib-text-muted)]" htmlFor="creative-canvas-source-role">
                  Reference role
                  <select
                    id="creative-canvas-source-role"
                    value={sourceRoleFilter}
                    onChange={(event) => setSourceRoleFilter(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-white px-2 py-1.5 text-xs text-[var(--color-pib-text)]"
                  >
                    <option value="">All roles</option>
                    <option value="product">Product</option>
                    <option value="person">Person</option>
                    <option value="style">Style</option>
                    <option value="logo">Logo</option>
                    <option value="mask">Mask</option>
                    <option value="motion">Motion</option>
                    <option value="general">General</option>
                  </select>
                </label>
                <label className="text-xs font-medium text-[var(--color-pib-text-muted)]" htmlFor="creative-canvas-source-media">
                  Media type
                  <select
                    id="creative-canvas-source-media"
                    value={sourceMediaFilter}
                    onChange={(event) => setSourceMediaFilter(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-white px-2 py-1.5 text-xs text-[var(--color-pib-text)]"
                  >
                    <option value="">All media</option>
                    <option value="image">Images</option>
                    <option value="video">Videos</option>
                    <option value="audio">Audio</option>
                    <option value="document">Documents</option>
                  </select>
                </label>
              </div>
              <div className="rounded-lg border border-dashed border-[var(--color-pib-line)] bg-white p-3">
                <p className="text-xs font-semibold text-[var(--color-pib-text)]">Upload source</p>
                <div className="mt-2 space-y-2">
                  <label className="block text-xs font-medium text-[var(--color-pib-text-muted)]" htmlFor="creative-canvas-upload-role">
                    Upload role
                    <select
                      id="creative-canvas-upload-role"
                      value={sourceUploadRole}
                      onChange={(event) => setSourceUploadRole(event.target.value)}
                      className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-white px-2 py-1.5 text-xs text-[var(--color-pib-text)]"
                    >
                      <option value="product">Product</option>
                      <option value="person">Person</option>
                      <option value="style">Style</option>
                      <option value="logo">Logo</option>
                      <option value="mask">Mask</option>
                      <option value="motion">Motion</option>
                      <option value="general">General</option>
                    </select>
                  </label>
                  <label className="block text-xs font-medium text-[var(--color-pib-text-muted)]" htmlFor="creative-canvas-upload-alt">
                    Alt text
                    <input
                      id="creative-canvas-upload-alt"
                      value={sourceUploadAltText}
                      onChange={(event) => setSourceUploadAltText(event.target.value)}
                      className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-white px-2 py-1.5 text-xs text-[var(--color-pib-text)]"
                      placeholder="Product bottle front angle"
                    />
                  </label>
                  <label className="block cursor-pointer rounded-lg border border-[var(--color-pib-line)] px-3 py-2 text-xs font-semibold text-[var(--color-pib-text)]" htmlFor="creative-canvas-source-upload">
                    {sourceUploading ? 'Uploading source...' : 'Choose media or PDF'}
                    <input
                      id="creative-canvas-source-upload"
                      type="file"
                      accept="image/*,video/*,audio/*,application/pdf"
                      multiple
                      disabled={sourceUploading}
                      onChange={(event) => {
                        void uploadSourceFiles(event.target.files)
                        event.currentTarget.value = ''
                      }}
                      className="sr-only"
                    />
                  </label>
                </div>
              </div>
            </div>
            <div className="mt-3 space-y-2">
              {sourceLibrary.length ? sourceLibrary.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-label={`Import ${item.title}`}
                  onClick={() => importSourceItem(item)}
                  className="w-full rounded-lg border border-[var(--color-pib-line)] px-3 py-2 text-left transition hover:bg-[var(--color-pib-surface)]"
                >
                  <span className="block text-sm font-semibold text-[var(--color-pib-text)]">{item.title}</span>
                  <span className="block text-xs text-[var(--color-pib-text-muted)]">
                    {item.source.kind}{item.source.referenceRole ? ` / ${item.source.referenceRole}` : ''}
                  </span>
                </button>
              )) : (
                <p className="rounded-lg border border-dashed border-[var(--color-pib-line)] px-3 py-2 text-xs text-[var(--color-pib-text-muted)]">
                  Uploads, artifacts, research, social media, YouTube, and Book Studio sources will appear here.
                </p>
              )}
            </div>
          </div>
        </aside>

        <section className="overflow-hidden rounded-lg border border-[var(--color-pib-line)] bg-white">
          <div className="flex items-center justify-between border-b border-[var(--color-pib-line)] px-4 py-3">
            <div>
              <h2 className="text-lg font-semibold text-[var(--color-pib-text)]">{activeCanvas?.title ?? 'Untitled canvas'}</h2>
              <p className="text-xs text-[var(--color-pib-text-muted)]">
                {nodes.length} nodes / {edges.length} links / v{activeCanvas?.activeVersion ?? 1}
              </p>
            </div>
            {saveMessage ? <p className="text-xs font-medium text-[var(--color-pib-text-muted)]">{saveMessage}</p> : null}
          </div>
          <div className="h-[560px]">
            <ReactFlow nodes={nodes} edges={edges} onConnect={onConnect} fitView>
              <Background />
              <Controls />
              <MiniMap />
            </ReactFlow>
          </div>
        </section>

        <aside className="space-y-4 rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-card)] p-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-normal text-[var(--color-pib-text-muted)]">Inspector</p>
            <h2 className="mt-2 text-lg font-semibold text-[var(--color-pib-text)]">
              {activeCanvas ? `Selected: ${activeCanvas.title}` : 'No canvas selected'}
            </h2>
            <p className="mt-1 text-sm text-[var(--color-pib-text-muted)]">
              {activeCanvas?.purpose ?? 'Create a canvas to start an agent-assisted creative workflow.'}
            </p>
          </div>

          <div className="rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] p-3">
            <p className="text-sm font-semibold text-[var(--color-pib-text)]">Agent controls</p>
            <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">
              Queue Higgsfield, copy, document, and review work from prompt/model nodes while keeping approval gates intact.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <label className="text-xs font-medium text-[var(--color-pib-text-muted)]" htmlFor="creative-canvas-output-kind">
                Output kind
                <select
                  id="creative-canvas-output-kind"
                  value={runOutputKind}
                  onChange={(event) => setRunOutputKind(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-white px-2 py-1.5 text-xs text-[var(--color-pib-text)]"
                >
                  <option value="image">Image</option>
                  <option value="video">Video</option>
                  <option value="campaign_asset">Campaign asset</option>
                  <option value="social_post_draft">Social draft</option>
                  <option value="youtube_render">YouTube render</option>
                  <option value="book_artifact">Book artifact</option>
                </select>
              </label>
              <label className="text-xs font-medium text-[var(--color-pib-text-muted)]" htmlFor="creative-canvas-aspect-ratio">
                Aspect ratio
                <select
                  id="creative-canvas-aspect-ratio"
                  value={runAspectRatio}
                  onChange={(event) => setRunAspectRatio(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-white px-2 py-1.5 text-xs text-[var(--color-pib-text)]"
                >
                  <option value="1:1">1:1</option>
                  <option value="4:5">4:5</option>
                  <option value="9:16">9:16</option>
                  <option value="16:9">16:9</option>
                </select>
              </label>
              <label className="text-xs font-medium text-[var(--color-pib-text-muted)]" htmlFor="creative-canvas-duration">
                Duration seconds
                <input
                  id="creative-canvas-duration"
                  type="number"
                  min={0}
                  max={60}
                  value={runDurationSeconds}
                  onChange={(event) => setRunDurationSeconds(Math.max(0, Number(event.target.value) || 0))}
                  className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-white px-2 py-1.5 text-xs text-[var(--color-pib-text)]"
                />
              </label>
              <label className="text-xs font-medium text-[var(--color-pib-text-muted)]" htmlFor="creative-canvas-variants">
                Variants
                <input
                  id="creative-canvas-variants"
                  type="number"
                  min={1}
                  max={8}
                  value={runVariantCount}
                  onChange={(event) => setRunVariantCount(Math.min(8, Math.max(1, Number(event.target.value) || 1)))}
                  className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-white px-2 py-1.5 text-xs text-[var(--color-pib-text)]"
                />
              </label>
              <label className="text-xs font-medium text-[var(--color-pib-text-muted)]" htmlFor="creative-canvas-style-preset">
                Style preset
                <select
                  id="creative-canvas-style-preset"
                  value={runStylePreset}
                  onChange={(event) => setRunStylePreset(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-white px-2 py-1.5 text-xs text-[var(--color-pib-text)]"
                >
                  <option value="cinematic_product">Cinematic product</option>
                  <option value="ugc_social">UGC social</option>
                  <option value="editorial">Editorial</option>
                  <option value="clean_studio">Clean studio</option>
                  <option value="brand_realism">Brand realism</option>
                </select>
              </label>
              <label className="text-xs font-medium text-[var(--color-pib-text-muted)]" htmlFor="creative-canvas-camera-motion">
                Camera motion
                <select
                  id="creative-canvas-camera-motion"
                  value={runCameraMotion}
                  onChange={(event) => setRunCameraMotion(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-white px-2 py-1.5 text-xs text-[var(--color-pib-text)]"
                >
                  <option value="none">None</option>
                  <option value="camera_push">Camera push</option>
                  <option value="camera_pull">Camera pull</option>
                  <option value="pan">Pan</option>
                  <option value="orbit">Orbit</option>
                  <option value="dolly">Dolly</option>
                  <option value="handheld">Handheld</option>
                </select>
              </label>
              <label className="col-span-2 text-xs font-medium text-[var(--color-pib-text-muted)]" htmlFor="creative-canvas-negative-prompt">
                Negative prompt
                <input
                  id="creative-canvas-negative-prompt"
                  value={runNegativePrompt}
                  onChange={(event) => setRunNegativePrompt(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-white px-2 py-1.5 text-xs text-[var(--color-pib-text)]"
                  placeholder="Avoid blur, distortion, off-brand elements"
                />
              </label>
            </div>
            {mode === 'admin' ? (
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={queueRun}
                  disabled={!selectedNodeId}
                  className="rounded-lg border border-[var(--color-pib-line)] px-3 py-2 text-xs font-semibold text-[var(--color-pib-text)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Queue run
                </button>
                <button
                  type="button"
                  onClick={ingestRunOutput}
                  disabled={!latestRun?.id}
                  className="rounded-lg border border-[var(--color-pib-line)] px-3 py-2 text-xs font-semibold text-[var(--color-pib-text)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Ingest run output
                </button>
                <button
                  type="button"
                  onClick={refreshLatestRunStatus}
                  disabled={!latestRun?.id}
                  className="rounded-lg border border-[var(--color-pib-line)] px-3 py-2 text-xs font-semibold text-[var(--color-pib-text)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Refresh provider status
                </button>
              </div>
            ) : null}
          </div>

          <div>
            <h3 className="text-sm font-semibold text-[var(--color-pib-text)]">Agent orchestration</h3>
            <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">
              Graph-derived handoffs for source, strategy, prompt, generation, review, and export work.
            </p>
            <div className="mt-2 space-y-2">
              {orchestrationPlan.agents.length ? (
                <div className="rounded-lg border border-[var(--color-pib-line)] bg-white px-3 py-2 text-xs text-[var(--color-pib-text-muted)]">
                  <p className="font-semibold text-[var(--color-pib-text)]">Active agents</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {orchestrationPlan.agents.map((agent) => (
                      <span
                        key={agent.agentId}
                        className="rounded-full border border-[var(--color-pib-line)] px-2 py-0.5 text-[11px] font-semibold text-[var(--color-pib-text)]"
                      >
                        {agent.agentId} · {agent.stepCount}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
              {orchestrationPlan.steps.length ? (
                <div className="rounded-lg border border-[var(--color-pib-line)] bg-white px-3 py-2 text-xs text-[var(--color-pib-text-muted)]">
                  <p className="font-semibold text-[var(--color-pib-text)]">Handoff chain</p>
                  <p className="mt-1 break-words">{orchestrationPlan.handoffSummary}</p>
                  <div className="mt-2 space-y-1.5">
                    {orchestrationPlan.steps.slice(0, 6).map((step) => (
                      <div key={step.id} className="border-t border-[var(--color-pib-line)] pt-1.5 first:border-t-0 first:pt-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-[var(--color-pib-text)]">{step.title}</span>
                          <span className="rounded-full border border-[var(--color-pib-line)] px-2 py-0.5 uppercase tracking-normal">
                            {step.status}
                          </span>
                        </div>
                        <p>{step.agentId} · {step.role.replaceAll('_', ' ')}</p>
                        <p>{step.deliverables.slice(0, 3).join(', ')}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="rounded-lg border border-dashed border-[var(--color-pib-line)] px-3 py-2 text-xs text-[var(--color-pib-text-muted)]">
                  Add or apply a workflow to create an agent handoff chain.
                </p>
              )}
              {orchestrationPlan.approvalGates.length ? (
                <div className="rounded-lg border border-[var(--color-pib-line)] bg-white px-3 py-2 text-xs text-[var(--color-pib-text-muted)]">
                  <p className="font-semibold text-[var(--color-pib-text)]">Approval gates</p>
                  {orchestrationPlan.approvalGates.map((gate) => (
                    <p key={gate.nodeId} className="mt-1">
                      {gate.title}: {gate.reviewerAgentId} · rights {gate.rightsStatus} · brand {gate.brandStatus}
                    </p>
                  ))}
                </div>
              ) : null}
              {orchestrationPlan.blockers.length ? (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  <p className="font-semibold">Orchestration blockers</p>
                  {orchestrationPlan.blockers.map((blocker) => <p key={blocker}>{blocker}</p>)}
                </div>
              ) : null}
            </div>
          </div>

          {selectedCanvasNode?.edit ? (
            <div>
              <h3 className="text-sm font-semibold text-[var(--color-pib-text)]">Edit controls</h3>
              <div className="mt-2 space-y-2 rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] p-3 text-xs text-[var(--color-pib-text-muted)]">
                <p className="font-semibold text-[var(--color-pib-text)]">
                  {selectedCanvasNode.edit.operation} / {selectedCanvasNode.edit.outputKind ?? 'image'}
                </p>
                <p>
                  Mask: {selectedCanvasNode.edit.mask?.region
                    ? 'region attached'
                    : selectedCanvasNode.edit.mask?.url || selectedCanvasNode.edit.mask?.sourceNodeId
                      ? 'attached'
                      : 'not attached'}
                </p>
                <p>
                  Strength: {selectedCanvasNode.edit.strength ?? 0.65} / Motion: {selectedCanvasNode.edit.motion?.mode ?? 'none'}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-xs font-medium text-[var(--color-pib-text-muted)]" htmlFor="creative-canvas-mask-x">
                    Mask x
                    <input
                      id="creative-canvas-mask-x"
                      type="number"
                      min={0}
                      max={100}
                      value={maskRegion.x}
                      onChange={(event) => updateMaskRegionValue('x', event.target.value)}
                      className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-white px-2 py-1.5 text-xs text-[var(--color-pib-text)]"
                    />
                  </label>
                  <label className="text-xs font-medium text-[var(--color-pib-text-muted)]" htmlFor="creative-canvas-mask-y">
                    Mask y
                    <input
                      id="creative-canvas-mask-y"
                      type="number"
                      min={0}
                      max={100}
                      value={maskRegion.y}
                      onChange={(event) => updateMaskRegionValue('y', event.target.value)}
                      className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-white px-2 py-1.5 text-xs text-[var(--color-pib-text)]"
                    />
                  </label>
                  <label className="text-xs font-medium text-[var(--color-pib-text-muted)]" htmlFor="creative-canvas-mask-width">
                    Mask width
                    <input
                      id="creative-canvas-mask-width"
                      type="number"
                      min={0}
                      max={100}
                      value={maskRegion.width}
                      onChange={(event) => updateMaskRegionValue('width', event.target.value)}
                      className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-white px-2 py-1.5 text-xs text-[var(--color-pib-text)]"
                    />
                  </label>
                  <label className="text-xs font-medium text-[var(--color-pib-text-muted)]" htmlFor="creative-canvas-mask-height">
                    Mask height
                    <input
                      id="creative-canvas-mask-height"
                      type="number"
                      min={0}
                      max={100}
                      value={maskRegion.height}
                      onChange={(event) => updateMaskRegionValue('height', event.target.value)}
                      className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-white px-2 py-1.5 text-xs text-[var(--color-pib-text)]"
                    />
                  </label>
                  <label className="col-span-2 text-xs font-medium text-[var(--color-pib-text-muted)]" htmlFor="creative-canvas-mask-feather">
                    Mask feather
                    <input
                      id="creative-canvas-mask-feather"
                      type="number"
                      min={0}
                      max={100}
                      value={maskRegion.feather}
                      onChange={(event) => updateMaskRegionValue('feather', event.target.value)}
                      className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-white px-2 py-1.5 text-xs text-[var(--color-pib-text)]"
                    />
                  </label>
                </div>
                <button
                  type="button"
                  onClick={applyMaskRegion}
                  className="rounded-lg border border-[var(--color-pib-line)] px-3 py-2 text-xs font-semibold text-[var(--color-pib-text)]"
                >
                  Apply mask region
                </button>
                {selectedCanvasNode.edit.references?.length ? (
                  <p>{selectedCanvasNode.edit.references.length} reference inputs</p>
                ) : (
                  <p>No reference inputs linked yet</p>
                )}
              </div>
            </div>
          ) : null}

          <div>
            <h3 className="text-sm font-semibold text-[var(--color-pib-text)]">Run history</h3>
            <div className="mt-2 space-y-2">
              {latestExecution?.command ? (
                <div className="rounded-lg border border-[var(--color-pib-line)] bg-white p-3 text-xs">
                  <p className="font-semibold text-[var(--color-pib-text)]">Higgsfield execution</p>
                  <code className="mt-2 block break-words rounded-md bg-[var(--color-pib-surface)] p-2 text-[11px] text-[var(--color-pib-text)]">
                    {latestExecution.command}
                  </code>
                  {latestExecution.dispatchPath ? (
                    <p className="mt-2 text-[var(--color-pib-text-muted)]">Dispatch: {latestExecution.dispatchPath}</p>
                  ) : null}
                  {latestExecution.callbackPath ? (
                    <p className="mt-1 text-[var(--color-pib-text-muted)]">Callback: {latestExecution.callbackPath}</p>
                  ) : null}
                  {latestExecution.statusPath ? (
                    <p className="mt-1 text-[var(--color-pib-text-muted)]">Status: {latestExecution.statusPath}</p>
                  ) : null}
                </div>
              ) : null}
              {runHistory.length ? runHistory.map((run) => (
                <div
                  key={run.id}
                  className="rounded-lg border border-[var(--color-pib-line)] bg-white px-3 py-2 text-xs text-[var(--color-pib-text-muted)]"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-[var(--color-pib-text)]">{run.providerKey}</span>
                    <span className="rounded-full border border-[var(--color-pib-line)] px-2 py-0.5 uppercase tracking-normal">
                      {run.status}
                    </span>
                  </div>
                  <p className="mt-1">Run: {run.id}</p>
                  {run.provenance.providerJobId ? <p>Provider job: {run.provenance.providerJobId}</p> : null}
                  {run.providerStatusMessage ? <p>Provider status: {run.providerStatusMessage}</p> : null}
                  {run.error?.message ? <p>Error: {run.error.message}</p> : null}
                  {run.output?.outputNodeId ? <p>Output: {run.output.outputNodeId}</p> : null}
                </div>
              )) : (
                <p className="rounded-lg border border-dashed border-[var(--color-pib-line)] p-3 text-xs text-[var(--color-pib-text-muted)]">
                  Runs will appear here after an agent or provider job is queued.
                </p>
              )}
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-[var(--color-pib-text)]">Versions</h3>
            <div className="mt-2 space-y-2">
              {versions.length ? versions.map((version) => (
                <div
                  key={version.id ?? version.version}
                  className="rounded-lg border border-[var(--color-pib-line)] px-3 py-2 text-xs text-[var(--color-pib-text-muted)]"
                >
                  <span className="font-semibold text-[var(--color-pib-text)]">Version {version.version}</span>
                  <span className="block">{version.reason ?? 'graph snapshot'}</span>
                </div>
              )) : (
                <p className="rounded-lg border border-dashed border-[var(--color-pib-line)] px-3 py-2 text-xs text-[var(--color-pib-text-muted)]">
                  Saved graph snapshots will appear here.
                </p>
              )}
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-[var(--color-pib-text)]">Comments</h3>
            <label className="mt-2 block text-xs font-medium text-[var(--color-pib-text-muted)]" htmlFor="creative-canvas-comment">
              Comment body
            </label>
            <textarea
              id="creative-canvas-comment"
              value={commentBody}
              onChange={(event) => setCommentBody(event.target.value)}
              rows={3}
              className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-white px-3 py-2 text-sm text-[var(--color-pib-text)]"
              placeholder="Add a note for agents, reviewers, or the client"
            />
            <button
              type="button"
              onClick={postComment}
              disabled={!activeCanvas?.id || !commentBody.trim()}
              className="mt-2 rounded-lg border border-[var(--color-pib-line)] px-3 py-2 text-xs font-semibold text-[var(--color-pib-text)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Add comment
            </button>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-[var(--color-pib-text)]">Output attachment</h3>
            <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">
              Attach generated media, copy, blog blocks, book artifacts, or campaign assets back onto the selected node.
            </p>
            <button
              type="button"
              onClick={attachSampleOutput}
              disabled={!selectedNodeId}
              className="mt-2 rounded-lg border border-[var(--color-pib-line)] px-3 py-2 text-xs font-semibold text-[var(--color-pib-text)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Attach output
            </button>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-[var(--color-pib-text)]">Review gate</h3>
            <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">
              Rights, brand, and synthetic-media disclosure must pass before client-visible or downstream export use.
            </p>
            <button
              type="button"
              onClick={markReviewPassed}
              disabled={!selectedNodeId}
              className="mt-2 rounded-lg border border-[var(--color-pib-line)] px-3 py-2 text-xs font-semibold text-[var(--color-pib-text)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Mark review passed
            </button>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-[var(--color-pib-text)]">Exports</h3>
            <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">
              Draft adapters route reviewed outputs into social, documents, campaigns, YouTube Studio, Book Studio, and artifacts.
            </p>
            <label className="mt-2 block text-xs font-medium text-[var(--color-pib-text-muted)]" htmlFor="creative-canvas-export-target">
              Export target
            </label>
            <select
              id="creative-canvas-export-target"
              value={exportTarget}
              onChange={(event) => setExportTarget(event.target.value as CreativeCanvasExport['target'])}
              className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-white px-3 py-2 text-xs text-[var(--color-pib-text)]"
            >
              <option value="campaign_asset">Campaign asset</option>
              <option value="social_draft">Social draft</option>
              <option value="client_document">Client document / blog</option>
              <option value="research">Research</option>
              <option value="youtube_studio">YouTube Studio</option>
              <option value="book_studio">Book Studio</option>
              <option value="workspace_artifact">Workspace artifact</option>
            </select>
            <button
              type="button"
              onClick={exportDraft}
              disabled={!selectedNodeId}
              className="mt-2 rounded-lg border border-[var(--color-pib-line)] px-3 py-2 text-xs font-semibold text-[var(--color-pib-text)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Prepare draft export
            </button>
          </div>

          {activityMessage ? (
            <p className="rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] px-3 py-2 text-xs text-[var(--color-pib-text-muted)]">
              {activityMessage}
            </p>
          ) : null}

          <div>
            <h3 className="text-sm font-semibold text-[var(--color-pib-text)]">Nodes</h3>
            <div className="mt-2 space-y-2">
              {nodes.length ? nodes.map((node) => {
                const canvasNode = node.data?.canvasNode as CreativeCanvasNode | undefined

                return (
                  <div
                    key={node.id}
                    className="rounded-lg border border-[var(--color-pib-line)] px-3 py-2 text-xs text-[var(--color-pib-text-muted)]"
                  >
                    <span className="block font-semibold text-[var(--color-pib-text)]">
                      {canvasNode?.title ?? node.id}
                    </span>
                    <span>{canvasNode?.type ?? 'source'}</span>
                    {canvasNode?.source?.referenceRole ? (
                      <span className="ml-2">
                        {canvasNode.source.referenceRole} / {canvasNode.source.weight ?? 1}
                      </span>
                    ) : null}
                    {canvasNode?.edit ? (
                      <span className="ml-2">
                        {canvasNode.edit.operation} / {canvasNode.edit.outputKind ?? 'image'}
                      </span>
                    ) : null}
                    {canvasNode?.edit?.mask ? (
                      <span className="ml-2">mask attached</span>
                    ) : null}
                    {canvasNode?.source?.thumbnailUrl || canvasNode?.source?.previewUrl ? (
                      <img
                        src={canvasNode.source.thumbnailUrl ?? canvasNode.source.previewUrl}
                        alt={`Reference preview: ${canvasNode.source.altText ?? canvasNode.title}`}
                        className="mt-2 h-24 w-full rounded-md object-cover"
                      />
                    ) : null}
                  </div>
                )
              }) : (
                <p className="rounded-lg border border-dashed border-[var(--color-pib-line)] px-3 py-2 text-xs text-[var(--color-pib-text-muted)]">
                  Add source material, prompts, models, reviews, and outputs from the palette.
                </p>
              )}
            </div>
          </div>
        </aside>
      </section>
    </main>
  )
}
