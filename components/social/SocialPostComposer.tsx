'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import PlatformPreview from '@/components/social/PlatformPreview'
import { appendQueryParams } from '@/lib/portal/scoped-routing'

type SocialScope = 'org' | 'personal'
type ComposeMode = 'single' | 'thread'
type SocialPostCategory = 'work' | 'personal' | 'ai' | 'sport' | 'sa' | 'other'
type ImageProvider = 'xai' | 'gemini'
type ImageSize = '1024x1024' | '1024x1536' | '1536x1024'

interface PlatformConfig {
  label: string
  bg: string
  short: string
  charLimit: number
  supportsThreads: boolean
}

interface Account {
  id: string
  platform: string
  displayName?: string
  name?: string
  username?: string
  status?: string
}

interface MediaItem {
  id: string
  url: string
  type: 'image'
  altText?: string
}

interface ImageTemplate {
  id: string
  name: string
  description: string
  promptTemplate: string
  suggestedSize: ImageSize
  category: string
}

interface AiCaption {
  text: string
  hashtags: string[]
}

interface AiHashtag {
  tag: string
  relevance: number
}

interface PostTemplate {
  id: string
  name: string
  body: string
  variables: string[]
  description?: string
}

interface HashtagSet {
  id: string
  name: string
  hashtags: string[]
}

type AiTone = 'professional' | 'casual' | 'friendly' | 'witty' | 'inspirational' | 'bold' | 'informative'
type LinkedInShareType = 'profile' | 'organization'

const AI_TONES: AiTone[] = ['professional', 'casual', 'friendly', 'witty', 'inspirational', 'bold', 'informative']

interface SocialPostComposerProps {
  scope?: SocialScope
  title?: string
  description?: string
  accountsHref?: string
  afterSaveHref?: string
  afterPublishHref?: string
  previewFallbackName?: string
  previewFallbackHandle?: string
  orgId?: string | null
  advanced?: boolean
  queryPrefill?: boolean
  accountFilter?: 'active' | 'connected'
  previewMode?: 'sidebar' | 'toggle'
}

const PLATFORM_CONFIG: Record<string, PlatformConfig> = {
  twitter: { label: 'X (Twitter)', bg: 'bg-black', short: 'X', charLimit: 280, supportsThreads: true },
  linkedin: { label: 'LinkedIn', bg: 'bg-blue-700', short: 'LI', charLimit: 3000, supportsThreads: false },
  facebook: { label: 'Facebook', bg: 'bg-blue-600', short: 'FB', charLimit: 63206, supportsThreads: false },
  instagram: { label: 'Instagram', bg: 'bg-pink-600', short: 'IG', charLimit: 2200, supportsThreads: false },
  reddit: { label: 'Reddit', bg: 'bg-orange-600', short: 'RD', charLimit: 40000, supportsThreads: false },
  tiktok: { label: 'TikTok', bg: 'bg-gray-800', short: 'TT', charLimit: 2200, supportsThreads: false },
  pinterest: { label: 'Pinterest', bg: 'bg-red-700', short: 'PI', charLimit: 500, supportsThreads: false },
  bluesky: { label: 'Bluesky', bg: 'bg-sky-500', short: 'BS', charLimit: 300, supportsThreads: true },
  threads: { label: 'Threads', bg: 'bg-gray-700', short: 'TH', charLimit: 500, supportsThreads: true },
  youtube: { label: 'YouTube', bg: 'bg-red-600', short: 'YT', charLimit: 5000, supportsThreads: false },
  mastodon: { label: 'Mastodon', bg: 'bg-purple-600', short: 'MA', charLimit: 500, supportsThreads: true },
  dribbble: { label: 'Dribbble', bg: 'bg-pink-500', short: 'DR', charLimit: 500, supportsThreads: false },
}

const CATEGORIES: SocialPostCategory[] = ['work', 'personal', 'ai', 'sport', 'sa', 'other']

function accountLabel(account: Account): string {
  return account.displayName || account.name || account.username || account.id
}

function accountHandle(account?: Account, fallback = '@yourbrand'): string {
  if (!account?.username) return fallback
  return `@${account.username.replace(/^@/, '')}`
}

function normaliseHashtag(value: string): string {
  const clean = value.trim().replace(/^[#,]+|[,]+$/g, '')
  return clean ? `#${clean.replace(/^#/, '')}` : ''
}

function addChip(
  raw: string,
  current: string[],
  setItems: (updater: (prev: string[]) => string[]) => void,
  transform: (value: string) => string = (value) => value.trim().replace(/^,|,$/g, ''),
) {
  const value = transform(raw)
  if (value && !current.includes(value)) setItems((prev) => [...prev, value])
}

export default function SocialPostComposer({
  scope = 'org',
  title = 'Compose Post',
  description = 'Create and schedule social media content',
  accountsHref = '/portal/social/accounts',
  afterSaveHref = '/portal/social',
  afterPublishHref,
  previewFallbackName = 'Your Brand',
  previewFallbackHandle = '@yourbrand',
  orgId,
  advanced = false,
  queryPrefill = false,
  accountFilter = 'active',
  previewMode = advanced ? 'toggle' : 'sidebar',
}: SocialPostComposerProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [accounts, setAccounts] = useState<Account[]>([])
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([])
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([])
  const [mode, setMode] = useState<ComposeMode>('single')
  const [content, setContent] = useState('')
  const [threadParts, setThreadParts] = useState<string[]>([''])
  const [scheduledFor, setScheduledFor] = useState('')
  const [category, setCategory] = useState<SocialPostCategory>('work')
  const [tagInput, setTagInput] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [hashtagInput, setHashtagInput] = useState('')
  const [hashtags, setHashtags] = useState<string[]>([])
  const [labelInput, setLabelInput] = useState('')
  const [labels, setLabels] = useState<string[]>([])
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([])
  const [uploadingImage, setUploadingImage] = useState(false)
  const [showPreview, setShowPreview] = useState(previewMode === 'sidebar')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [successMsg, setSuccessMsg] = useState('')

  const [showAi, setShowAi] = useState(false)
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiTone, setAiTone] = useState<AiTone>('professional')
  const [aiCount, setAiCount] = useState(3)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiCaptions, setAiCaptions] = useState<AiCaption[]>([])
  const [aiHashtags, setAiHashtags] = useState<AiHashtag[]>([])
  const [bestTimeLoading, setBestTimeLoading] = useState(false)

  // US-090 first-comment automation
  const [firstComment, setFirstComment] = useState('')

  // US-079 LinkedIn share-type selector
  const [linkedinShareType, setLinkedinShareType] = useState<LinkedInShareType>('profile')

  // US-071 post-text templates
  const [templates, setTemplates] = useState<PostTemplate[]>([])
  const [showTemplatePicker, setShowTemplatePicker] = useState(false)
  const [activeTemplate, setActiveTemplate] = useState<PostTemplate | null>(null)
  const [templateVars, setTemplateVars] = useState<Record<string, string>>({})

  // US-084 saved hashtag sets
  const [hashtagSets, setHashtagSets] = useState<HashtagSet[]>([])
  const [showHashtagSets, setShowHashtagSets] = useState(false)

  const [showImageModal, setShowImageModal] = useState(false)
  const [imagePrompt, setImagePrompt] = useState('')
  const [imageProvider, setImageProvider] = useState<ImageProvider>('xai')
  const [imageSize, setImageSize] = useState<ImageSize>('1024x1024')
  const [imageTemplates, setImageTemplates] = useState<ImageTemplate[]>([])
  const [selectedTemplate, setSelectedTemplate] = useState('')
  const [generatedImageUrl, setGeneratedImageUrl] = useState('')
  const [generatedPrompt, setGeneratedPrompt] = useState('')
  const [imageLoading, setImageLoading] = useState(false)
  const [imageError, setImageError] = useState('')
  const [templatesLoading, setTemplatesLoading] = useState(false)

  const socialApiPath = useCallback((path: string) => appendQueryParams(path, {
    scope: scope === 'personal' ? 'personal' : undefined,
    orgId,
  }), [orgId, scope])

  useEffect(() => {
    fetch(socialApiPath('/api/v1/social/accounts'))
      .then((response) => response.json())
      .then((body) => {
        const loaded = Array.isArray(body.data) ? body.data : []
        setAccounts(loaded.filter((account: Account) => {
          if (accountFilter === 'connected') return account.status !== 'disconnected'
          return account.status === 'active'
        }))
      })
      .catch(() => setAccounts([]))
  }, [accountFilter, socialApiPath])

  useEffect(() => {
    if (!advanced) return
    setTemplatesLoading(true)
    fetch('/api/v1/social/ai/image-templates')
      .then((response) => response.json())
      .then((body) => {
        if (Array.isArray(body.data)) setImageTemplates(body.data)
      })
      .catch(() => {})
      .finally(() => setTemplatesLoading(false))
  }, [advanced])

  useEffect(() => {
    fetch('/api/v1/social/templates')
      .then((response) => response.json())
      .then((body) => {
        if (Array.isArray(body.data)) setTemplates(body.data)
      })
      .catch(() => {})

    fetch('/api/v1/social/hashtag-sets')
      .then((response) => response.json())
      .then((body) => {
        if (Array.isArray(body.data)) setHashtagSets(body.data)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!queryPrefill) return
    const draft = searchParams.get('draft')
    if (draft) setContent(decodeURIComponent(draft))
    const topic = searchParams.get('topic')
    if (topic) setTags([decodeURIComponent(topic)])
    const scheduledAt = searchParams.get('scheduledAt')
    if (scheduledAt) setScheduledFor(scheduledAt)
  }, [queryPrefill, searchParams])

  const availablePlatforms = useMemo(() => {
    return Array.from(new Set(accounts.map((account) => account.platform))).filter((platform) => PLATFORM_CONFIG[platform])
  }, [accounts])

  const showThreadToggle = advanced && selectedPlatforms.some((platform) => PLATFORM_CONFIG[platform]?.supportsThreads)
  const isThread = showThreadToggle && mode === 'thread'

  const charLimit = selectedPlatforms.length > 0
    ? Math.min(...selectedPlatforms.map((platform) => PLATFORM_CONFIG[platform]?.charLimit ?? 5000))
    : advanced ? 280 : 5000

  useEffect(() => {
    if (!showThreadToggle && mode === 'thread') setMode('single')
  }, [mode, showThreadToggle])

  useEffect(() => {
    const matching = accounts
      .filter((account) => selectedPlatforms.includes(account.platform))
      .map((account) => account.id)

    setSelectedAccounts((prev) => {
      const retained = advanced ? prev.filter((id) => matching.includes(id)) : []
      return Array.from(new Set([...retained, ...matching]))
    })
  }, [accounts, advanced, selectedPlatforms])

  const selectedAccountObjects = accounts.filter((account) => selectedAccounts.includes(account.id))
  const filteredAccounts = accounts.filter((account) => selectedPlatforms.includes(account.platform))
  const selectedAccountPlatforms = useMemo(() => {
    return new Set(selectedAccountObjects.map((account) => account.platform))
  }, [selectedAccountObjects])

  const togglePlatform = (platform: string) => {
    setSelectedPlatforms((prev) => prev.includes(platform) ? prev.filter((item) => item !== platform) : [...prev, platform])
  }

  const toggleAccount = (accountId: string) => {
    setSelectedAccounts((prev) => prev.includes(accountId) ? prev.filter((item) => item !== accountId) : [...prev, accountId])
  }

  const updateThreadPart = (index: number, value: string) => {
    setThreadParts((prev) => prev.map((part, i) => i === index ? value : part))
  }

  const addThreadPart = () => setThreadParts((prev) => [...prev, ''])
  const removeThreadPart = (index: number) => setThreadParts((prev) => prev.filter((_, i) => i !== index))

  const validate = useCallback(() => {
    const nextErrors: Record<string, string> = {}
    if (selectedPlatforms.length === 0) nextErrors.platforms = 'Select at least one platform.'
    if (selectedAccounts.length === 0) nextErrors.accounts = 'Select at least one account.'

    if (isThread) {
      threadParts.forEach((part, index) => {
        if (!part.trim()) nextErrors[`thread_${index}`] = 'Post cannot be empty.'
        if (part.length > charLimit) nextErrors[`thread_${index}_len`] = `Part ${index + 1} exceeds ${charLimit} characters.`
      })
    } else {
      if (!content.trim()) nextErrors.content = 'Content cannot be empty.'
      if (content.length > charLimit) nextErrors.content = `Content exceeds ${charLimit} character limit.`
    }

    setErrors(nextErrors)
    return Object.keys(nextErrors).length === 0
  }, [charLimit, content, isThread, selectedAccounts.length, selectedPlatforms.length, threadParts])

  const publishReadinessErrors = useMemo(() => {
    const issues: string[] = []
    if (selectedPlatforms.length === 0) issues.push('Select a platform.')
    if (selectedAccounts.length === 0) issues.push('Select an account.')
    for (const platform of selectedPlatforms) {
      if (!selectedAccountPlatforms.has(platform)) {
        issues.push(`Select a ${PLATFORM_CONFIG[platform]?.label ?? platform} account.`)
      }
    }
    if (isThread) {
      threadParts.forEach((part, index) => {
        if (!part.trim()) issues.push(`Write thread part ${index + 1}.`)
        if (part.length > charLimit) issues.push(`Thread part ${index + 1} exceeds ${charLimit} characters.`)
      })
    } else {
      if (!content.trim()) issues.push('Write post content.')
      if (content.length > charLimit) issues.push(`Content exceeds ${charLimit} characters.`)
    }
    if (uploadingImage) issues.push('Wait for image upload to finish.')
    return issues
  }, [charLimit, content, isThread, selectedAccountPlatforms, selectedAccounts.length, selectedPlatforms, threadParts, uploadingImage])

  const canPublishNow = publishReadinessErrors.length === 0 && !submitting

  const chipKeyDown = (
    value: string,
    items: string[],
    setInput: (value: string) => void,
    setItems: (updater: (prev: string[]) => string[]) => void,
    transform?: (value: string) => string,
  ) => (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault()
      addChip(value, items, setItems, transform)
      setInput('')
    }
  }

  const removeChip = (item: string, setItems: (updater: (prev: string[]) => string[]) => void) => {
    setItems((prev) => prev.filter((value) => value !== item))
  }

  const buildBody = (status: 'draft' | 'scheduled') => {
    const body: Record<string, unknown> = {
      content: {
        text: isThread ? (threadParts[0] ?? '') : content,
        platformOverrides: {},
        ...(isThread ? { threadParts } : {}),
      },
      platforms: selectedPlatforms,
      accountIds: selectedAccounts,
      status,
      scheduledAt: scheduledFor ? new Date(scheduledFor).toISOString() : undefined,
      media: mediaItems.map((item, index) => ({
        mediaId: item.id,
        type: item.type,
        url: item.url,
        thumbnailUrl: item.url,
        width: 0,
        height: 0,
        duration: null,
        altText: item.altText ?? '',
        order: index,
      })),
      hashtags,
      labels: advanced ? labels : [],
      source: 'ui',
    }

    if (firstComment.trim()) {
      body.firstComment = firstComment.trim()
    }

    if (linkedinSelected) {
      body.linkedinShareType = linkedinShareType
    }

    if (advanced) {
      body.category = category
      body.tags = tags
    }

    return body
  }

  const handleImageUpload = async (file: File | null) => {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setErrors({ upload: 'Only image uploads are supported here.' })
      return
    }

    setUploadingImage(true)
    setErrors((prev) => {
      const next = { ...prev }
      delete next.upload
      return next
    })

    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('altText', file.name.replace(/\.[^.]+$/, ''))

      const res = await fetch(socialApiPath('/api/v1/social/media/upload'), { method: 'POST', body: formData })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? 'Image upload failed')

      setMediaItems((prev) => [...prev, {
        id: body.data.id,
        url: body.data.url,
        type: 'image',
        altText: file.name.replace(/\.[^.]+$/, ''),
      }])
    } catch (err: unknown) {
      setErrors({ upload: err instanceof Error ? err.message : 'Image upload failed' })
    } finally {
      setUploadingImage(false)
    }
  }

  const handleGenerateImage = async () => {
    if (!imagePrompt.trim()) {
      setImageError('Please enter an image prompt')
      return
    }

    setImageLoading(true)
    setImageError('')
    setGeneratedImageUrl('')
    setGeneratedPrompt('')

    try {
      const res = await fetch('/api/v1/social/ai/image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: imagePrompt, provider: imageProvider, size: imageSize }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? 'Failed to generate image')
      if (body.data?.url) {
        setGeneratedImageUrl(body.data.url)
        setGeneratedPrompt(body.data.revisedPrompt ?? '')
      }
    } catch (err: unknown) {
      setImageError(err instanceof Error ? err.message : 'Error generating image')
    } finally {
      setImageLoading(false)
    }
  }

  const useGeneratedImage = () => {
    if (!generatedImageUrl) return
    setMediaItems((prev) => [...prev, {
      id: `generated-${Date.now()}`,
      url: generatedImageUrl,
      type: 'image',
      altText: imagePrompt || 'Generated social image',
    }])
    setGeneratedImageUrl('')
    setGeneratedPrompt('')
    setImagePrompt('')
    setSelectedTemplate('')
    setShowImageModal(false)
  }

  const handleSubmit = async (action: 'draft' | 'schedule' | 'publish') => {
    if (!validate()) return
    if (action === 'publish' && publishReadinessErrors.length > 0) {
      setErrors({ submit: publishReadinessErrors[0] })
      return
    }
    if (action === 'schedule' && !scheduledFor) {
      setErrors({ submit: 'Set a schedule date/time first.' })
      return
    }

    setSubmitting(true)
    try {
      const status = action === 'schedule' ? 'scheduled' : 'draft'
      const res = await fetch(socialApiPath('/api/v1/social/posts'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildBody(status)),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? 'Failed to create post')
      const postId = body.data?.id
      if (!postId) throw new Error('No post ID returned')

      if (action === 'publish') {
        const pubRes = await fetch(socialApiPath(`/api/v1/social/posts/${postId}/publish`), { method: 'POST' })
        const pubBody = await pubRes.json()
        if (!pubRes.ok) throw new Error(pubBody.error ?? 'Failed to publish')
        setSuccessMsg('Published successfully!')
        setTimeout(() => router.push(afterPublishHref ?? afterSaveHref), 1200)
      } else if (action === 'draft') {
        const readback = await fetch(socialApiPath(`/api/v1/social/posts/${postId}`))
        const readbackBody = await readback.json()
        if (!readback.ok || readbackBody.data?.id !== postId) throw new Error('Draft saved, but readback failed')
        setSuccessMsg(`Draft saved and verified: ${postId}`)
      } else {
        setSuccessMsg('Post scheduled!')
        setTimeout(() => router.push(afterSaveHref), 1200)
      }
    } catch (err: unknown) {
      setErrors({ submit: err instanceof Error ? err.message : 'Something went wrong' })
    } finally {
      setSubmitting(false)
    }
  }

  const handleBestTime = async () => {
    setBestTimeLoading(true)
    try {
      const platform = selectedPlatforms[0] ?? 'twitter'
      const res = await fetch(`/api/v1/social/ai/best-time?platform=${encodeURIComponent(platform)}`)
      const body = await res.json()
      const bestSlot = body.data?.slots?.[0]
      if (!res.ok || !bestSlot) return

      const now = new Date()
      const targetDate = new Date(now)
      const dayDiff = (bestSlot.dayOfWeek - now.getDay() + 7) % 7
      if (dayDiff === 0 && now.getHours() >= bestSlot.hour) targetDate.setDate(targetDate.getDate() + 7)
      if (dayDiff > 0) targetDate.setDate(targetDate.getDate() + dayDiff)
      targetDate.setHours(bestSlot.hour, 0, 0, 0)
      setScheduledFor(new Date(targetDate.getTime() - targetDate.getTimezoneOffset() * 60000).toISOString().slice(0, 16))
    } finally {
      setBestTimeLoading(false)
    }
  }

  const handleAiGenerate = async () => {
    if (!aiPrompt.trim()) return
    setAiLoading(true)
    setAiCaptions([])
    try {
      const res = await fetch('/api/v1/social/ai/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: aiPrompt,
          platform: selectedPlatforms[0] ?? 'twitter',
          tone: aiTone,
          count: aiCount,
          includeHashtags: true,
        }),
      })
      const body = await res.json()
      if (Array.isArray(body.data?.captions)) setAiCaptions(body.data.captions)
    } finally {
      setAiLoading(false)
    }
  }

  const handleAiHashtags = async () => {
    const text = isThread ? threadParts.join('\n\n') : content
    if (!text.trim()) return
    setAiLoading(true)
    setAiHashtags([])
    try {
      const res = await fetch('/api/v1/social/ai/hashtags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, platform: selectedPlatforms[0] ?? 'twitter', count: 10 }),
      })
      const body = await res.json()
      if (Array.isArray(body.data?.hashtags)) setAiHashtags(body.data.hashtags)
    } finally {
      setAiLoading(false)
    }
  }

  const applyCaption = (caption: AiCaption) => {
    setContent(caption.text)
    setMode('single')
    if (caption.hashtags?.length) setHashtags((prev) => [...new Set([...prev, ...caption.hashtags])])
    setAiCaptions([])
  }

  const applyHashtag = (tag: string) => {
    if (!hashtags.includes(tag)) setHashtags((prev) => [...prev, tag])
  }

  const linkedinSelected = selectedPlatforms.includes('linkedin')

  // --- US-071 template helpers ---
  const openTemplate = (template: PostTemplate) => {
    setActiveTemplate(template)
    setTemplateVars(Object.fromEntries(template.variables.map((v) => [v, ''])))
    setShowTemplatePicker(false)
  }

  const renderTemplate = (template: PostTemplate, vars: Record<string, string>): string => {
    return template.body.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (match, key: string) => {
      const value = vars[key]
      return value && value.trim() ? value : match
    })
  }

  const insertTemplate = () => {
    if (!activeTemplate) return
    const rendered = renderTemplate(activeTemplate, templateVars)
    setContent((prev) => (prev.trim() ? `${prev}\n\n${rendered}` : rendered))
    setMode('single')
    setActiveTemplate(null)
    setTemplateVars({})
  }

  // --- US-084 hashtag-set helpers ---
  const applyHashtagSet = (set: HashtagSet) => {
    setHashtags((prev) => [...new Set([...prev, ...set.hashtags])])
    setShowHashtagSets(false)
  }

  const minDateTime = new Date().toISOString().slice(0, 16)
  const previewContent = isThread ? threadParts.join('\n\n') : content

  const renderPreview = () => {
    if (selectedPlatforms.length === 0) {
      return (
        <div className="pib-card p-4 text-sm text-[var(--color-on-surface-variant)]">
          Select a connected platform to see its preview.
        </div>
      )
    }

    return (
      <div className={previewMode === 'toggle' ? 'flex gap-4 overflow-x-auto pb-4' : 'space-y-4'}>
        {selectedPlatforms.map((platform) => {
          const account = selectedAccountObjects.find((item) => item.platform === platform)
            ?? accounts.find((item) => item.platform === platform)
          return (
            <div key={platform} className={previewMode === 'toggle' ? 'flex-shrink-0' : 'space-y-2'}>
              <div className="flex items-center gap-2 text-xs font-label font-bold uppercase tracking-widest text-[var(--color-on-surface-variant)]">
                <span className={`${PLATFORM_CONFIG[platform]?.bg ?? 'bg-gray-600'} text-white text-[10px] px-2 py-0.5 rounded font-bold`}>
                  {PLATFORM_CONFIG[platform]?.short ?? platform.slice(0, 2).toUpperCase()}
                </span>
                {PLATFORM_CONFIG[platform]?.label ?? platform}
              </div>
              <PlatformPreview
                platform={platform}
                content={previewContent}
                mediaItems={mediaItems}
                charLimit={PLATFORM_CONFIG[platform]?.charLimit ?? 5000}
                userName={account ? accountLabel(account) : previewFallbackName}
                userHandle={accountHandle(account, previewFallbackHandle)}
              />
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div className={previewMode === 'sidebar' ? 'grid gap-6 xl:grid-cols-[minmax(0,42rem)_minmax(22rem,1fr)]' : 'p-6 max-w-2xl mx-auto space-y-6'}>
      <div className="space-y-6 max-w-2xl">
        <div>
          <h1 className={advanced ? 'text-2xl font-semibold text-on-surface' : 'font-headline text-2xl font-bold tracking-tighter'}>
            {title}
          </h1>
          <p className={advanced ? 'text-sm text-on-surface-variant mt-1' : 'text-sm text-[var(--color-on-surface-variant)] mt-1'}>
            {description}
          </p>
        </div>

        {successMsg && <div className="border border-green-400/40 p-4 text-green-300 text-sm">{successMsg}</div>}
        {errors.submit && <div className="border border-red-400/40 p-4 text-red-300 text-sm">{errors.submit}</div>}

        <section className="pib-card space-y-3">
          <h2 className="text-sm font-label uppercase tracking-widest text-on-surface-variant">Platforms</h2>
          {availablePlatforms.length === 0 ? (
            <p className="text-[var(--color-on-surface-variant)] text-sm">
              No accounts connected. <Link href={accountsHref} className="text-[var(--color-accent-v2)] underline">Connect an account</Link> first.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {availablePlatforms.map((platform) => {
                const config = PLATFORM_CONFIG[platform]
                const selected = selectedPlatforms.includes(platform)
                return (
                  <button
                    key={platform}
                    onClick={() => togglePlatform(platform)}
                    className={`px-4 py-2 text-sm font-label font-bold uppercase tracking-widest border transition-colors ${
                      selected ? 'pib-btn-primary' : 'pib-btn-secondary'
                    }`}
                  >
                    <span className={`${config.bg} inline-block w-5 h-5 rounded text-[10px] font-bold leading-5 text-center text-white mr-1.5 align-middle`}>
                      {config.short}
                    </span>
                    {config.label}
                  </button>
                )
              })}
            </div>
          )}
          {errors.platforms && <p className="text-red-300 text-xs mt-1">{errors.platforms}</p>}
        </section>

        {selectedPlatforms.length > 0 && (
          <section className="pib-card space-y-3">
            <h2 className="text-sm font-label uppercase tracking-widest text-on-surface-variant">Accounts</h2>
            <div className="space-y-2">
              {selectedPlatforms.map((platform) => {
                const platformAccounts = filteredAccounts.filter((account) => account.platform === platform)
                if (platformAccounts.length === 0) return null
                return (
                  <div key={platform}>
                    <p className="text-xs text-on-surface-variant font-medium mb-1">{PLATFORM_CONFIG[platform]?.label ?? platform}</p>
                    {platformAccounts.map((account) => (
                      <label key={account.id} className="pib-card pib-card-hover p-3 cursor-pointer flex items-center gap-3 transition-colors">
                        <input
                          type="checkbox"
                          checked={selectedAccounts.includes(account.id)}
                          onChange={() => toggleAccount(account.id)}
                          className="accent-[var(--color-accent-v2)]"
                        />
                        <span className={`${PLATFORM_CONFIG[account.platform]?.bg ?? 'bg-gray-600'} text-white text-[10px] px-2 py-0.5 rounded font-bold`}>
                          {PLATFORM_CONFIG[account.platform]?.short ?? account.platform.slice(0, 2).toUpperCase()}
                        </span>
                        <span className="text-sm text-[var(--color-on-surface)]">{accountLabel(account)}</span>
                        <span className="text-xs text-[var(--color-on-surface-variant)]">{accountHandle(account, '')}</span>
                      </label>
                    ))}
                  </div>
                )
              })}
            </div>
            {errors.accounts && <p className="text-red-300 text-xs mt-1">{errors.accounts}</p>}
          </section>
        )}

        {linkedinSelected && (
          <section className="pib-card space-y-3">
            <h2 className="text-sm font-label uppercase tracking-widest text-on-surface-variant">LinkedIn — Share As</h2>
            <div className="flex gap-2">
              {([
                { value: 'profile', label: 'Profile' },
                { value: 'organization', label: 'Company Page' },
              ] as { value: LinkedInShareType; label: string }[]).map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setLinkedinShareType(option.value)}
                  className={`px-4 py-2 text-sm font-label font-bold uppercase tracking-widest border transition-colors ${
                    linkedinShareType === option.value ? 'pib-btn-primary' : 'pib-btn-secondary'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-on-surface-variant">
              Share as your personal Profile or as a connected Company Page. The LinkedIn account you publish with must match the chosen type.
            </p>
          </section>
        )}

        {advanced && showThreadToggle && (
          <section className="pib-card space-y-3">
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="flex-1">
                <label className="block text-xs font-medium text-on-surface-variant uppercase tracking-wide mb-2">Mode</label>
                <div className="flex gap-2">
                  {(['single', 'thread'] as ComposeMode[]).map((item) => (
                    <button
                      key={item}
                      onClick={() => setMode(item)}
                      className={`px-4 py-2 rounded-lg font-label text-sm font-medium transition-colors capitalize ${
                        mode === item ? 'bg-white text-black' : 'bg-surface-container text-on-surface hover:bg-surface-container-high'
                      }`}
                    >
                      {item === 'single' ? 'Single Post' : 'Thread'}
                    </button>
                  ))}
                </div>
              </div>
              {previewMode === 'toggle' && (
                <div className="flex-1">
                  <label className="block text-xs font-medium text-on-surface-variant uppercase tracking-wide mb-2">Preview</label>
                  <button
                    onClick={() => setShowPreview((value) => !value)}
                    className={`w-full px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                      showPreview ? 'bg-amber-500 text-black font-label' : 'bg-surface-container text-on-surface hover:bg-surface-container-high font-label'
                    }`}
                  >
                    {showPreview ? 'Hide Preview' : 'Show Preview'}
                  </button>
                </div>
              )}
            </div>
          </section>
        )}

        {isThread ? (
          <section className="pib-card space-y-3">
            <h2 className="text-sm font-label uppercase tracking-widest text-on-surface-variant">Thread Parts</h2>
            {threadParts.map((part, index) => (
              <div key={index} className="rounded-xl bg-surface-container p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-on-surface-variant">Part {index + 1}</span>
                  {threadParts.length > 1 && (
                    <button onClick={() => removeThreadPart(index)} className="text-xs text-red-400 hover:text-red-300 transition-colors">
                      Remove
                    </button>
                  )}
                </div>
                <textarea
                  rows={3}
                  value={part}
                  onChange={(event) => updateThreadPart(index, event.target.value)}
                  placeholder={`Part ${index + 1}...`}
                  className="w-full bg-transparent text-sm text-on-surface placeholder:text-on-surface-variant/50 resize-none outline-none"
                />
                <div className="flex justify-end">
                  <span className={`text-xs ${part.length > charLimit ? 'text-red-400' : 'text-on-surface-variant'}`}>
                    {part.length} / {charLimit}
                  </span>
                </div>
                {(errors[`thread_${index}`] || errors[`thread_${index}_len`]) && (
                  <p className="text-xs text-red-400">{errors[`thread_${index}`] || errors[`thread_${index}_len`]}</p>
                )}
              </div>
            ))}
            <button onClick={addThreadPart} className="pib-btn-secondary !py-2 !text-sm">+ Add Part</button>
          </section>
        ) : (
          <section>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-xs font-label uppercase tracking-widest text-[var(--color-on-surface-variant)]">Content</label>
              {templates.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowTemplatePicker(true)}
                  className="text-[11px] font-label font-bold uppercase tracking-widest text-[var(--color-accent-v2)] hover:underline"
                >
                  Use template
                </button>
              )}
            </div>
            <div className="pib-card p-3">
              <textarea
                rows={6}
                value={content}
                onChange={(event) => setContent(event.target.value)}
                placeholder="Write your post…"
                className="w-full bg-transparent text-sm text-[var(--color-on-surface)] placeholder:text-[var(--color-on-surface-variant)] resize-none outline-none"
              />
              <div className="flex justify-end mt-1">
                <span className={`text-xs ${content.length > charLimit ? 'text-red-400' : 'text-[var(--color-on-surface-variant)]'}`}>
                  {content.length} / {charLimit}
                </span>
              </div>
            </div>
            {errors.content && <p className="text-red-300 text-xs mt-1">{errors.content}</p>}
          </section>
        )}

        {previewMode === 'toggle' && showPreview && (
          <section className="pib-card p-6">
            <h3 className="text-sm font-semibold text-on-surface mb-4">Platform Preview</h3>
            {renderPreview()}
          </section>
        )}

        <section className="pib-card p-3 space-y-3">
          <label className="block text-xs font-label uppercase tracking-widest text-[var(--color-on-surface-variant)]">Images</label>
          {mediaItems.length > 0 && (
            <div className="grid grid-cols-2 gap-2">
              {mediaItems.map((media) => (
                <div key={media.id} className="relative overflow-hidden border border-[var(--color-outline-variant)] bg-black/20">
                  <img src={media.url} alt={media.altText || 'Uploaded media'} className="h-32 w-full object-cover" />
                  <button
                    type="button"
                    onClick={() => setMediaItems((prev) => prev.filter((item) => item.id !== media.id))}
                    className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center bg-black/70 text-sm font-bold text-white transition-colors hover:bg-red-600"
                    aria-label="Remove image"
                  >
                    x
                  </button>
                </div>
              ))}
            </div>
          )}
          {advanced ? (
            <button
              onClick={() => setShowImageModal(true)}
              className="w-full px-4 py-3 text-sm font-label font-bold uppercase tracking-widest border border-dashed border-[var(--color-outline-variant)] text-[var(--color-on-surface-variant)] transition-colors hover:border-[var(--color-on-surface-variant)] hover:text-[var(--color-on-surface)]"
            >
              + Generate Image with AI
            </button>
          ) : (
            <label className="flex cursor-pointer items-center justify-center border border-dashed border-[var(--color-outline-variant)] px-4 py-3 text-sm font-label font-bold uppercase tracking-widest text-[var(--color-on-surface-variant)] transition-colors hover:border-[var(--color-on-surface-variant)] hover:text-[var(--color-on-surface)]">
              {uploadingImage ? 'Uploading...' : '+ Upload Image'}
              <input
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp"
                disabled={uploadingImage}
                onChange={(event) => {
                  handleImageUpload(event.target.files?.[0] ?? null)
                  event.currentTarget.value = ''
                }}
                className="sr-only"
              />
            </label>
          )}
          {errors.upload && <p className="text-red-300 text-xs mt-1">{errors.upload}</p>}
        </section>

        {advanced && (
          <section className="pib-card p-4 space-y-3">
            <button
              onClick={() => setShowAi((value) => !value)}
              className="flex items-center gap-2 text-sm font-medium text-on-surface hover:text-white transition-colors"
            >
              <span className="text-base">*</span>
              AI Assist
              <span className="text-[10px] text-on-surface-variant">{showAi ? 'Hide' : 'Show'}</span>
            </button>

            {showAi && (
              <div className="space-y-3 pt-1">
                <div className="space-y-2">
                  <label className="text-xs font-medium text-on-surface-variant uppercase tracking-wide">Generate Caption</label>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="space-y-1 text-[10px] font-medium text-on-surface-variant uppercase tracking-wide">
                      Tone
                      <select
                        value={aiTone}
                        onChange={(event) => setAiTone(event.target.value as AiTone)}
                        className="w-full rounded-lg bg-surface px-3 py-2 text-sm text-on-surface outline-none border border-transparent focus:border-outline-variant transition-colors capitalize"
                      >
                        {AI_TONES.map((tone) => (
                          <option key={tone} value={tone}>{tone}</option>
                        ))}
                      </select>
                    </label>
                    <label className="space-y-1 text-[10px] font-medium text-on-surface-variant uppercase tracking-wide">
                      Variations
                      <select
                        value={aiCount}
                        onChange={(event) => setAiCount(Number(event.target.value))}
                        className="w-full rounded-lg bg-surface px-3 py-2 text-sm text-on-surface outline-none border border-transparent focus:border-outline-variant transition-colors"
                      >
                        {[1, 2, 3, 4, 5].map((n) => (
                          <option key={n} value={n}>{n} {n === 1 ? 'variation' : 'variations'}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={aiPrompt}
                      onChange={(event) => setAiPrompt(event.target.value)}
                      onKeyDown={(event) => event.key === 'Enter' && handleAiGenerate()}
                      placeholder="Topic or prompt"
                      className="flex-1 rounded-lg bg-surface px-3 py-2 text-sm text-on-surface placeholder:text-on-surface-variant/50 outline-none border border-transparent focus:border-outline-variant transition-colors"
                    />
                    <button onClick={handleAiGenerate} disabled={aiLoading || !aiPrompt.trim()} className="pib-btn-primary !py-2 !px-3 !text-xs disabled:opacity-50">
                      {aiLoading ? 'Generating...' : 'Generate'}
                    </button>
                  </div>
                  {aiCaptions.map((caption, index) => (
                    <div key={index} className="rounded-lg bg-surface p-2.5">
                      <p className="text-xs text-on-surface leading-relaxed">{caption.text}</p>
                      {caption.hashtags?.length > 0 && <p className="text-[10px] text-on-surface-variant mt-1">{caption.hashtags.join(' ')}</p>}
                      <button onClick={() => applyCaption(caption)} className="mt-1.5 text-[10px] text-blue-400 hover:text-blue-300 font-medium">
                        Use this caption
                      </button>
                    </div>
                  ))}
                </div>

                {previewContent.trim() && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <label className="text-xs font-medium text-on-surface-variant uppercase tracking-wide">Suggest Hashtags</label>
                      <button onClick={handleAiHashtags} disabled={aiLoading} className="pib-btn-secondary !py-1 !px-2 !text-[10px] disabled:opacity-50">
                        {aiLoading ? 'Loading...' : 'Suggest'}
                      </button>
                    </div>
                    {aiHashtags.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {aiHashtags.map((item, index) => (
                          <button
                            key={index}
                            onClick={() => applyHashtag(item.tag)}
                            disabled={hashtags.includes(item.tag)}
                            className={`text-[10px] px-2 py-0.5 rounded-full font-medium transition-colors ${
                              hashtags.includes(item.tag) ? 'bg-surface-container-high text-on-surface-variant/40' : 'bg-surface text-on-surface hover:bg-surface-container-high'
                            }`}
                          >
                            {item.tag} <span className="text-on-surface-variant/60">{Math.round(item.relevance * 100)}%</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        <section className="pib-card space-y-3">
          <h2 className="text-sm font-label uppercase tracking-widest text-on-surface-variant">Schedule</h2>
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label className="block text-xs font-medium text-on-surface-variant uppercase tracking-wide mb-2">Schedule For</label>
              <input
                type="datetime-local"
                value={scheduledFor}
                min={minDateTime}
                onChange={(event) => setScheduledFor(event.target.value)}
                className="w-full rounded-xl bg-surface-container px-4 py-2.5 text-sm text-on-surface outline-none border border-transparent focus:border-outline-variant transition-colors"
              />
            </div>
            {advanced && (
              <button onClick={handleBestTime} disabled={bestTimeLoading} className="pib-btn-secondary !py-2.5 !px-3 !text-xs disabled:opacity-50">
                {bestTimeLoading ? 'Finding...' : 'Best time'}
              </button>
            )}
          </div>
          <p className="text-xs text-on-surface-variant">Leave empty to save as draft.</p>
        </section>

        {advanced && (
          <>
            <section className="pib-card space-y-3">
              <h2 className="text-sm font-label uppercase tracking-widest text-on-surface-variant">Category</h2>
              <select
                value={category}
                onChange={(event) => setCategory(event.target.value as SocialPostCategory)}
                className="rounded-xl bg-surface-container px-4 py-2.5 text-sm text-on-surface outline-none border border-transparent focus:border-outline-variant transition-colors capitalize"
              >
                {CATEGORIES.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </section>

            <ChipSection
              title="Labels"
              value={labelInput}
              items={labels}
              placeholder="Type a label and press Enter or comma..."
              onChange={setLabelInput}
              onKeyDown={chipKeyDown(labelInput, labels, setLabelInput, setLabels)}
              onRemove={(item) => removeChip(item, setLabels)}
            />

            <ChipSection
              title="Tags"
              value={tagInput}
              items={tags}
              placeholder="Type a tag and press Enter or comma..."
              onChange={setTagInput}
              onKeyDown={chipKeyDown(tagInput, tags, setTagInput, setTags)}
              onRemove={(item) => removeChip(item, setTags)}
            />
          </>
        )}

        <section className="pib-card space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-label uppercase tracking-widest text-on-surface-variant">First Comment</h2>
            <span className="text-[10px] text-on-surface-variant uppercase tracking-wide">Posted automatically after publish</span>
          </div>
          <textarea
            rows={2}
            value={firstComment}
            onChange={(event) => setFirstComment(event.target.value)}
            placeholder="Optional — e.g. drop your link or extra hashtags as the first comment…"
            className="w-full rounded-xl bg-surface-container px-4 py-2.5 text-sm text-on-surface placeholder:text-on-surface-variant/50 outline-none border border-transparent focus:border-outline-variant transition-colors resize-none"
          />
          <p className="text-xs text-on-surface-variant">
            Leave empty to skip. The comment is posted on the published post by the same account; a comment failure never blocks the post.
          </p>
        </section>

        {hashtagSets.length > 0 && (
          <section className="pib-card space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-label uppercase tracking-widest text-on-surface-variant">Saved Hashtag Sets</h2>
              <button
                type="button"
                onClick={() => setShowHashtagSets((value) => !value)}
                className="text-[11px] font-label font-bold uppercase tracking-widest text-[var(--color-accent-v2)] hover:underline"
              >
                {showHashtagSets ? 'Hide' : 'Browse sets'}
              </button>
            </div>
            {showHashtagSets && (
              <div className="space-y-2">
                {hashtagSets.map((set) => (
                  <div key={set.id} className="flex items-center justify-between gap-3 rounded-lg bg-surface-container-high p-2.5">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-on-surface truncate">{set.name}</p>
                      <p className="text-[11px] text-on-surface-variant truncate">{set.hashtags.join(' ')}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => applyHashtagSet(set)}
                      className="shrink-0 px-3 py-1.5 rounded bg-[var(--color-accent-v2)] text-black text-xs font-label font-bold uppercase tracking-widest hover:opacity-90 transition-opacity"
                    >
                      Insert
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        <ChipSection
          title="Hashtags"
          value={hashtagInput}
          items={hashtags}
          placeholder="Type a hashtag and press Enter or comma..."
          onChange={setHashtagInput}
          onKeyDown={chipKeyDown(hashtagInput, hashtags, setHashtagInput, setHashtags, normaliseHashtag)}
          onRemove={(item) => removeChip(item, setHashtags)}
        />

        <section className="pib-card">
          <div className="flex flex-wrap gap-3">
            <button onClick={() => handleSubmit('draft')} disabled={submitting} className="pib-btn-secondary disabled:opacity-50">
              Save Draft
            </button>
            <button onClick={() => handleSubmit('schedule')} disabled={submitting || !scheduledFor} className="pib-btn-primary disabled:opacity-50">
              Schedule
            </button>
            <button
              onClick={() => handleSubmit('publish')}
              disabled={!canPublishNow}
              title={publishReadinessErrors[0] ?? 'Ready to publish now'}
              className="pib-btn-secondary disabled:opacity-50"
            >
              Publish Now
            </button>
          </div>
        </section>
      </div>

      {previewMode === 'sidebar' && (
        <aside className="space-y-4 xl:sticky xl:top-6 xl:self-start">
          <div>
            <h2 className="font-headline text-xl font-bold tracking-tighter">Preview</h2>
            <p className="text-sm text-[var(--color-on-surface-variant)] mt-1">Selected platforms render here as you compose.</p>
          </div>
          {renderPreview()}
        </aside>
      )}

      {advanced && showImageModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-surface rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto space-y-4 p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-on-surface">AI Image Generation</h2>
              <button onClick={() => setShowImageModal(false)} className="text-on-surface-variant hover:text-on-surface text-xl">x</button>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium text-on-surface-variant uppercase tracking-wide">Template (Optional)</label>
              <select
                value={selectedTemplate}
                disabled={templatesLoading}
                onChange={(event) => {
                  const templateId = event.target.value
                  setSelectedTemplate(templateId)
                  const template = imageTemplates.find((item) => item.id === templateId)
                  if (template) {
                    setImagePrompt(template.promptTemplate)
                    setImageSize(template.suggestedSize)
                  }
                }}
                className="w-full rounded-xl bg-surface-container px-4 py-2.5 text-sm text-on-surface outline-none border border-transparent focus:border-outline-variant transition-colors"
              >
                <option value="">Choose a template...</option>
                {imageTemplates.map((template) => (
                  <option key={template.id} value={template.id}>{template.name} - {template.description}</option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium text-on-surface-variant uppercase tracking-wide">Image Prompt</label>
              <textarea
                rows={4}
                value={imagePrompt}
                onChange={(event) => setImagePrompt(event.target.value)}
                placeholder="Describe the image you want to generate..."
                className="w-full rounded-xl bg-surface-container px-4 py-2.5 text-sm text-on-surface placeholder:text-on-surface-variant/50 outline-none border border-transparent focus:border-outline-variant transition-colors resize-none"
              />
              <p className="text-[10px] text-on-surface-variant">{imagePrompt.length} / 4000 characters</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-2 text-xs font-medium text-on-surface-variant uppercase tracking-wide">
                Provider
                <select value={imageProvider} onChange={(event) => setImageProvider(event.target.value as ImageProvider)} className="w-full rounded-xl bg-surface-container px-4 py-2.5 text-sm text-on-surface">
                  <option value="xai">xAI (Grok)</option>
                  <option value="gemini">Google Gemini</option>
                </select>
              </label>
              <label className="space-y-2 text-xs font-medium text-on-surface-variant uppercase tracking-wide">
                Size
                <select value={imageSize} onChange={(event) => setImageSize(event.target.value as ImageSize)} className="w-full rounded-xl bg-surface-container px-4 py-2.5 text-sm text-on-surface">
                  <option value="1024x1024">Square (1024x1024)</option>
                  <option value="1024x1536">Portrait (1024x1536)</option>
                  <option value="1536x1024">Landscape (1536x1024)</option>
                </select>
              </label>
            </div>

            {imageError && <div className="px-4 py-3 rounded-xl bg-red-900/30 text-red-400 text-sm">{imageError}</div>}

            <button onClick={handleGenerateImage} disabled={imageLoading || !imagePrompt.trim()} className="w-full pib-btn-primary disabled:opacity-50">
              {imageLoading ? 'Generating...' : 'Generate Image'}
            </button>

            {generatedImageUrl && (
              <div className="space-y-2">
                <div className="rounded-xl bg-surface-container overflow-hidden">
                  <img src={generatedImageUrl} alt="generated" className="w-full" />
                </div>
                {generatedPrompt && (
                  <div className="rounded-lg bg-surface p-2.5">
                    <p className="text-[10px] text-on-surface-variant font-medium mb-1">Revised Prompt:</p>
                    <p className="text-xs text-on-surface leading-relaxed">{generatedPrompt}</p>
                  </div>
                )}
                <button onClick={useGeneratedImage} className="w-full pib-btn-secondary">Use This Image</button>
              </div>
            )}
          </div>
        </div>
      )}

      {showTemplatePicker && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-surface rounded-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto space-y-4 p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-on-surface">Use a Post Template</h2>
              <button onClick={() => setShowTemplatePicker(false)} className="text-on-surface-variant hover:text-on-surface text-xl">x</button>
            </div>
            {templates.length === 0 ? (
              <p className="text-sm text-on-surface-variant">No templates yet. Create reusable post-text templates under Social → Templates.</p>
            ) : (
              <div className="space-y-2">
                {templates.map((template) => (
                  <button
                    key={template.id}
                    type="button"
                    onClick={() => openTemplate(template)}
                    className="w-full text-left rounded-lg bg-surface-container hover:bg-surface-container-high p-3 transition-colors"
                  >
                    <p className="text-sm font-medium text-on-surface">{template.name}</p>
                    {template.description && <p className="text-[11px] text-on-surface-variant mt-0.5">{template.description}</p>}
                    <p className="text-xs text-on-surface-variant mt-1 line-clamp-2">{template.body}</p>
                    {template.variables.length > 0 && (
                      <p className="text-[10px] text-[var(--color-accent-v2)] mt-1">{template.variables.map((v) => `{{${v}}}`).join(' ')}</p>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTemplate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-surface rounded-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto space-y-4 p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-on-surface">{activeTemplate.name}</h2>
              <button onClick={() => { setActiveTemplate(null); setTemplateVars({}) }} className="text-on-surface-variant hover:text-on-surface text-xl">x</button>
            </div>

            {activeTemplate.variables.length > 0 && (
              <div className="space-y-2">
                <label className="text-xs font-medium text-on-surface-variant uppercase tracking-wide">Fill in placeholders</label>
                {activeTemplate.variables.map((variable) => (
                  <div key={variable}>
                    <label className="block text-[11px] text-on-surface-variant mb-1">{`{{${variable}}}`}</label>
                    <input
                      type="text"
                      value={templateVars[variable] ?? ''}
                      onChange={(event) => setTemplateVars((prev) => ({ ...prev, [variable]: event.target.value }))}
                      placeholder={variable}
                      className="w-full rounded-lg bg-surface-container px-3 py-2 text-sm text-on-surface placeholder:text-on-surface-variant/50 outline-none border border-transparent focus:border-outline-variant transition-colors"
                    />
                  </div>
                ))}
              </div>
            )}

            <div className="space-y-1">
              <label className="text-xs font-medium text-on-surface-variant uppercase tracking-wide">Preview</label>
              <div className="rounded-lg bg-surface-container p-3 text-sm text-on-surface whitespace-pre-wrap">
                {renderTemplate(activeTemplate, templateVars)}
              </div>
            </div>

            <div className="flex gap-2">
              <button onClick={insertTemplate} className="flex-1 pib-btn-primary">Insert into post</button>
              <button onClick={() => { setActiveTemplate(null); setTemplateVars({}) }} className="pib-btn-secondary">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ChipSection({
  title,
  value,
  items,
  placeholder,
  onChange,
  onKeyDown,
  onRemove,
}: {
  title: string
  value: string
  items: string[]
  placeholder: string
  onChange: (value: string) => void
  onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void
  onRemove: (item: string) => void
}) {
  return (
    <section className="pib-card space-y-3">
      <h2 className="text-sm font-label uppercase tracking-widest text-on-surface-variant">{title}</h2>
      <input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        className="w-full rounded-xl bg-surface-container px-4 py-2.5 text-sm text-on-surface placeholder:text-on-surface-variant/50 outline-none border border-transparent focus:border-outline-variant transition-colors"
      />
      {items.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {items.map((item) => (
            <span key={item} className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-surface-container-high text-on-surface text-xs font-medium">
              {item}
              <button onClick={() => onRemove(item)} className="text-on-surface-variant hover:text-on-surface transition-colors ml-0.5">x</button>
            </span>
          ))}
        </div>
      )}
    </section>
  )
}
