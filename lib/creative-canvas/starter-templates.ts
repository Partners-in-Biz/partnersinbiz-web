import type { CreativeCanvasEdge, CreativeCanvasNode, CreativeCanvasTemplate } from '@/lib/creative-canvas/types'

// Curated, ready-made workflow templates shown to every org in the Creative
// Canvas "Templates" tab, above the org's own saved templates. These are
// pure data (no Firestore doc) — `id` is namespaced `starter-<slug>` so the
// workspace can tell a starter apart from a saved template and re-apply the
// same id-rewrite / orgId-rewrite flow used for saved templates
// (`applySavedTemplate` in CreativeCanvasWorkspace.tsx).
//
// `orgId: 'starter'` is a placeholder — the applier always rewrites node/edge
// ids and orgId to the active org when the template is applied, so this
// value is never persisted or shown to the user.

const STARTER_ORG_ID = 'starter'

type StarterNodeInput = Omit<CreativeCanvasNode, 'id' | 'orgId'> & { id: string }
type StarterEdgeInput = Omit<CreativeCanvasEdge, 'id' | 'orgId'> & { id: string }

function buildStarterTemplate(
  base: Pick<CreativeCanvasTemplate, 'id' | 'title' | 'description' | 'category'>,
  nodeInputs: StarterNodeInput[],
  edgeInputs: StarterEdgeInput[]
): CreativeCanvasTemplate {
  const nodes: CreativeCanvasNode[] = nodeInputs.map((node) => ({
    ...node,
    orgId: STARTER_ORG_ID,
  }))
  const edges: CreativeCanvasEdge[] = edgeInputs.map((edge) => ({
    ...edge,
    orgId: STARTER_ORG_ID,
  }))
  return {
    orgId: STARTER_ORG_ID,
    title: base.title,
    description: base.description,
    category: base.category ?? 'starter',
    id: base.id,
    nodes,
    edges,
    createdBy: 'system',
    createdByType: 'system',
    updatedBy: 'system',
    updatedByType: 'system',
    deleted: false,
  }
}

// ---------------------------------------------------------------------------
// a. UGC product ad
// ---------------------------------------------------------------------------
const ugcProductAd = buildStarterTemplate(
  { id: 'starter-ugc-product-ad', title: 'UGC product ad', description: 'Hook script into a product hero image, then a vertical motion render for Reels/TikTok/Shorts.', category: 'starter' },
  [
    {
      id: 'ugc-prompt',
      type: 'prompt',
      title: 'UGC hook script',
      position: { x: 0, y: 0 },
      data: { workflowRole: 'prompt', agentId: 'maya', promptType: 'ugc_social_launch', prompt: 'Write a 3-second scroll-stopping hook and 15-second UGC script selling the product benefit, in a native creator voice.' },
    },
    {
      id: 'ugc-hero-image',
      type: 'model',
      title: 'Product hero image',
      position: { x: 320, y: 0 },
      data: { workflowRole: 'generation', ownerAgentId: 'maya' },
      provider: { key: 'higgsfield', model: 'text2image_soul_v2', mode: 'product_hero' },
    },
    {
      id: 'ugc-vertical-video',
      type: 'model',
      title: 'Vertical motion render',
      position: { x: 640, y: 0 },
      data: { workflowRole: 'generation', ownerAgentId: 'maya' },
      provider: { key: 'higgsfield', model: 'seedance_2_0', mode: 'vertical_social' },
      edit: {
        operation: 'video_motion',
        outputKind: 'social_post_draft',
        strength: 0.65,
        motion: { mode: 'camera_push', durationSeconds: 8 },
        references: [{ sourceNodeId: 'ugc-hero-image', role: 'product', weight: 1 }],
      },
    },
  ],
  [
    { id: 'ugc-edge-1', sourceNodeId: 'ugc-prompt', targetNodeId: 'ugc-hero-image', label: 'generate hero' },
    { id: 'ugc-edge-2', sourceNodeId: 'ugc-hero-image', targetNodeId: 'ugc-vertical-video', label: 'animate' },
  ]
)

// ---------------------------------------------------------------------------
// b. Product hero shot
// ---------------------------------------------------------------------------
const productHeroShot = buildStarterTemplate(
  { id: 'starter-product-hero-shot', title: 'Product hero shot', description: 'Product reference plus a styling prompt into a single studio-grade hero image.', category: 'starter' },
  [
    {
      id: 'hero-reference',
      type: 'source',
      title: 'Product reference',
      position: { x: 0, y: 0 },
      data: { workflowRole: 'source', requiredInputs: ['product_image'] },
      source: { kind: 'upload', referenceRole: 'product', weight: 1, altText: 'Product reference photo' },
    },
    {
      id: 'hero-prompt',
      type: 'prompt',
      title: 'Hero shot styling brief',
      position: { x: 320, y: 0 },
      data: { workflowRole: 'prompt', agentId: 'maya', promptType: 'product_hero', prompt: 'Studio-lit hero shot on a clean brand-color backdrop, soft reflections, editorial composition.' },
    },
    {
      id: 'hero-image',
      type: 'model',
      title: 'Hero image generation',
      position: { x: 640, y: 0 },
      data: { workflowRole: 'generation', ownerAgentId: 'maya' },
      provider: { key: 'higgsfield', model: 'cinematic_studio_image', mode: 'product_hero' },
      edit: {
        operation: 'style_transfer',
        outputKind: 'image',
        strength: 0.55,
        references: [{ sourceNodeId: 'hero-reference', role: 'product', weight: 1 }],
      },
    },
  ],
  [
    { id: 'hero-edge-1', sourceNodeId: 'hero-reference', targetNodeId: 'hero-prompt', label: 'reference' },
    { id: 'hero-edge-2', sourceNodeId: 'hero-prompt', targetNodeId: 'hero-image', label: 'generate' },
  ]
)

// ---------------------------------------------------------------------------
// c. Blog + social pack
// ---------------------------------------------------------------------------
const blogSocialPack = buildStarterTemplate(
  { id: 'starter-blog-social-pack', title: 'Blog + social pack', description: 'One topic brief fans out into a blog draft, social caption variants, and a header image.', category: 'starter' },
  [
    {
      id: 'pack-brief',
      type: 'prompt',
      title: 'Topic brief',
      position: { x: 0, y: 0 },
      data: { workflowRole: 'prompt', agentId: 'pip', promptType: 'blog_article', prompt: 'Outline the article topic, target keyword, audience pain point, and the single takeaway to repurpose into social.' },
    },
    {
      id: 'pack-blog-draft',
      type: 'model',
      title: 'Blog draft',
      position: { x: 320, y: -60 },
      data: { workflowRole: 'generation', ownerAgentId: 'pip' },
      provider: { key: 'agent_task', model: 'agent-llm', mode: 'blog_draft' },
    },
    {
      id: 'pack-caption-variants',
      type: 'edit',
      title: 'Caption variants',
      position: { x: 640, y: -60 },
      data: { workflowRole: 'edit', ownerAgentId: 'pip' },
      edit: {
        operation: 'variation',
        intent: 'reference_blend',
        outputKind: 'caption',
        prompt: 'Repurpose the blog takeaway into 3 platform-native caption variants (LinkedIn, Instagram, X).',
        references: [{ sourceNodeId: 'pack-blog-draft', role: 'general', weight: 1 }],
      },
    },
    {
      id: 'pack-header-image',
      type: 'model',
      title: 'Header image',
      position: { x: 320, y: 100 },
      data: { workflowRole: 'generation', ownerAgentId: 'maya' },
      provider: { key: 'higgsfield', model: 'text2image_soul_v2', mode: 'blog_header' },
    },
  ],
  [
    { id: 'pack-edge-1', sourceNodeId: 'pack-brief', targetNodeId: 'pack-blog-draft', label: 'draft' },
    { id: 'pack-edge-2', sourceNodeId: 'pack-blog-draft', targetNodeId: 'pack-caption-variants', label: 'repurpose' },
    { id: 'pack-edge-3', sourceNodeId: 'pack-brief', targetNodeId: 'pack-header-image', label: 'header brief' },
  ]
)

// ---------------------------------------------------------------------------
// d. YouTube short pipeline
// ---------------------------------------------------------------------------
const youtubeShortPipeline = buildStarterTemplate(
  { id: 'starter-youtube-short-pipeline', title: 'YouTube short pipeline', description: 'Script into a voiceover track, then a vertical short-form render.', category: 'starter' },
  [
    {
      id: 'short-script',
      type: 'prompt',
      title: 'Short script',
      position: { x: 0, y: 0 },
      data: { workflowRole: 'prompt', agentId: 'maya', promptType: 'video_storyboard', prompt: '30-45 second short-form script with a hook, 3 beats, and a CTA.' },
    },
    {
      id: 'short-voiceover',
      type: 'model',
      title: 'Voiceover',
      position: { x: 320, y: 0 },
      data: { workflowRole: 'generation', ownerAgentId: 'maya' },
      provider: { key: 'higgsfield', model: 'mirelo_text_to_audio', mode: 'voiceover' },
    },
    {
      id: 'short-render',
      type: 'model',
      title: 'Short-form render',
      position: { x: 640, y: 0 },
      data: { workflowRole: 'generation', ownerAgentId: 'maya' },
      provider: { key: 'higgsfield', model: 'seedance_2_0', mode: 'video_render' },
      edit: {
        operation: 'video_motion',
        outputKind: 'youtube_render',
        strength: 0.7,
        motion: { mode: 'camera_push', durationSeconds: 15 },
        references: [{ sourceNodeId: 'short-voiceover', role: 'general', weight: 1 }],
      },
    },
  ],
  [
    { id: 'short-edge-1', sourceNodeId: 'short-script', targetNodeId: 'short-voiceover', label: 'voice' },
    { id: 'short-edge-2', sourceNodeId: 'short-voiceover', targetNodeId: 'short-render', label: 'render' },
  ]
)

// ---------------------------------------------------------------------------
// e. Brand carousel
// ---------------------------------------------------------------------------
const brandCarousel = buildStarterTemplate(
  { id: 'starter-brand-carousel', title: 'Brand carousel', description: 'One creative brief wired to three on-brand carousel slides.', category: 'starter' },
  [
    {
      id: 'carousel-brief',
      type: 'prompt',
      title: 'Carousel brief',
      position: { x: 0, y: 60 },
      data: { workflowRole: 'prompt', agentId: 'maya', promptType: 'ugc_social_launch', prompt: 'Three-slide carousel: slide 1 hook/problem, slide 2 solution/proof, slide 3 CTA. Consistent brand palette and type.' },
    },
    {
      id: 'carousel-slide-1',
      type: 'model',
      title: 'Slide 1 — hook',
      position: { x: 320, y: -80 },
      data: { workflowRole: 'generation', ownerAgentId: 'maya', slide: 1 },
      provider: { key: 'higgsfield', model: 'text2image_soul_v2', mode: 'carousel_slide' },
    },
    {
      id: 'carousel-slide-2',
      type: 'model',
      title: 'Slide 2 — proof',
      position: { x: 320, y: 60 },
      data: { workflowRole: 'generation', ownerAgentId: 'maya', slide: 2 },
      provider: { key: 'higgsfield', model: 'text2image_soul_v2', mode: 'carousel_slide' },
    },
    {
      id: 'carousel-slide-3',
      type: 'model',
      title: 'Slide 3 — CTA',
      position: { x: 320, y: 200 },
      data: { workflowRole: 'generation', ownerAgentId: 'maya', slide: 3 },
      provider: { key: 'higgsfield', model: 'text2image_soul_v2', mode: 'carousel_slide' },
    },
  ],
  [
    { id: 'carousel-edge-1', sourceNodeId: 'carousel-brief', targetNodeId: 'carousel-slide-1', label: 'slide 1' },
    { id: 'carousel-edge-2', sourceNodeId: 'carousel-brief', targetNodeId: 'carousel-slide-2', label: 'slide 2' },
    { id: 'carousel-edge-3', sourceNodeId: 'carousel-brief', targetNodeId: 'carousel-slide-3', label: 'slide 3' },
  ]
)

// ---------------------------------------------------------------------------
// f. Podcast audiogram
// ---------------------------------------------------------------------------
const podcastAudiogram = buildStarterTemplate(
  { id: 'starter-podcast-audiogram', title: 'Podcast audiogram', description: 'Raw episode audio into a clean audio cut and a matching cover/audiogram image.', category: 'starter' },
  [
    {
      id: 'podcast-source-audio',
      type: 'source',
      title: 'Episode audio',
      position: { x: 0, y: 0 },
      data: { workflowRole: 'source', requiredInputs: ['episode_audio'] },
      source: { kind: 'upload', referenceRole: 'general', weight: 1, altText: 'Raw podcast episode audio' },
    },
    {
      id: 'podcast-audio-cut',
      type: 'model',
      title: 'Audio highlight cut',
      position: { x: 320, y: -60 },
      data: { workflowRole: 'generation', ownerAgentId: 'maya' },
      provider: { key: 'higgsfield', model: 'mirelo_text_to_audio', mode: 'audio_highlight' },
      edit: {
        operation: 'variation',
        outputKind: 'audio',
        strength: 0.4,
        references: [{ sourceNodeId: 'podcast-source-audio', role: 'general', weight: 1 }],
      },
    },
    {
      id: 'podcast-cover-image',
      type: 'model',
      title: 'Audiogram cover',
      position: { x: 320, y: 100 },
      data: { workflowRole: 'generation', ownerAgentId: 'maya' },
      provider: { key: 'higgsfield', model: 'text2image_soul_v2', mode: 'podcast_cover' },
    },
  ],
  [
    { id: 'podcast-edge-1', sourceNodeId: 'podcast-source-audio', targetNodeId: 'podcast-audio-cut', label: 'cut highlight' },
    { id: 'podcast-edge-2', sourceNodeId: 'podcast-source-audio', targetNodeId: 'podcast-cover-image', label: 'cover brief' },
  ]
)

// ---------------------------------------------------------------------------
// g. Email hero banner
// ---------------------------------------------------------------------------
const emailHeroBanner = buildStarterTemplate(
  { id: 'starter-email-hero-banner', title: 'Email hero banner', description: 'Campaign brief into subject-line copy plus an on-brand hero banner image for the send.', category: 'starter' },
  [
    {
      id: 'email-brief',
      type: 'prompt',
      title: 'Campaign brief',
      position: { x: 0, y: 0 },
      data: { workflowRole: 'prompt', agentId: 'pip', promptType: 'blog_article', prompt: 'Offer, audience segment, and single CTA for this email send.' },
    },
    {
      id: 'email-subject-copy',
      type: 'model',
      title: 'Subject line + preheader',
      position: { x: 320, y: -60 },
      data: { workflowRole: 'generation', ownerAgentId: 'pip' },
      provider: { key: 'agent_task', model: 'agent-llm', mode: 'subject_line' },
    },
    {
      id: 'email-hero-image',
      type: 'model',
      title: 'Hero banner image',
      position: { x: 320, y: 100 },
      data: { workflowRole: 'generation', ownerAgentId: 'maya' },
      provider: { key: 'higgsfield', model: 'recraft_v4_1', mode: 'email_banner' },
    },
  ],
  [
    { id: 'email-edge-1', sourceNodeId: 'email-brief', targetNodeId: 'email-subject-copy', label: 'copy' },
    { id: 'email-edge-2', sourceNodeId: 'email-brief', targetNodeId: 'email-hero-image', label: 'banner brief' },
  ]
)

// ---------------------------------------------------------------------------
// h. Character consistency board
// ---------------------------------------------------------------------------
const characterConsistencyBoard = buildStarterTemplate(
  { id: 'starter-character-consistency-board', title: 'Character consistency board', description: 'Lock a character reference, then generate two on-model variations for a campaign.', category: 'starter' },
  [
    {
      id: 'character-reference',
      type: 'source',
      title: 'Character reference',
      position: { x: 0, y: 60 },
      data: { workflowRole: 'source', requiredInputs: ['character_reference'] },
      source: { kind: 'upload', referenceRole: 'character', weight: 1, altText: 'Locked character reference' },
    },
    {
      id: 'character-variation-a',
      type: 'model',
      title: 'Variation A — lifestyle scene',
      position: { x: 320, y: -60 },
      data: { workflowRole: 'generation', ownerAgentId: 'maya' },
      provider: { key: 'higgsfield', model: 'nano_banana_flash', mode: 'character_variation' },
      edit: {
        operation: 'variation',
        outputKind: 'image',
        strength: 0.5,
        references: [{ sourceNodeId: 'character-reference', role: 'character', weight: 1 }],
      },
    },
    {
      id: 'character-variation-b',
      type: 'model',
      title: 'Variation B — product interaction',
      position: { x: 320, y: 180 },
      data: { workflowRole: 'generation', ownerAgentId: 'maya' },
      provider: { key: 'higgsfield', model: 'nano_banana_flash', mode: 'character_variation' },
      edit: {
        operation: 'variation',
        outputKind: 'image',
        strength: 0.5,
        references: [{ sourceNodeId: 'character-reference', role: 'character', weight: 1 }],
      },
    },
  ],
  [
    { id: 'character-edge-1', sourceNodeId: 'character-reference', targetNodeId: 'character-variation-a', label: 'lock identity' },
    { id: 'character-edge-2', sourceNodeId: 'character-reference', targetNodeId: 'character-variation-b', label: 'lock identity' },
  ]
)

export const starterCanvasTemplates: CreativeCanvasTemplate[] = [
  ugcProductAd,
  productHeroShot,
  blogSocialPack,
  youtubeShortPipeline,
  brandCarousel,
  podcastAudiogram,
  emailHeroBanner,
  characterConsistencyBoard,
]

export function getStarterCanvasTemplate(id: string): CreativeCanvasTemplate | undefined {
  return starterCanvasTemplates.find((template) => template.id === id)
}
