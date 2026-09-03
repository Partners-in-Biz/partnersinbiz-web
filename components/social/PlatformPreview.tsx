'use client'

interface PlatformPreviewProps {
  platform: string
  content: string
  mediaItems: Array<{ id: string; url: string; type: string }>
  charLimit: number
  userName?: string
  userHandle?: string
  userAvatar?: string
}

// Helper: Detect hashtags and mentions in text
const parseTextWithFormatting = (text: string) => {
  const parts: Array<{ text: string; type: 'text' | 'hashtag' | 'mention' }> = []
  const regex = /(#\w+|@\w+)/g
  let lastIndex = 0

  text.replace(regex, (match, offset) => {
    if (offset > lastIndex) {
      parts.push({ text: text.slice(lastIndex, offset), type: 'text' })
    }
    if (match.startsWith('#')) {
      parts.push({ text: match, type: 'hashtag' })
    } else if (match.startsWith('@')) {
      parts.push({ text: match, type: 'mention' })
    }
    lastIndex = offset + match.length
    return match
  })

  if (lastIndex < text.length) {
    parts.push({ text: text.slice(lastIndex), type: 'text' })
  }

  return parts
}

// Helper: Render text with formatted hashtags/mentions
const renderFormattedText = (text: string, className = '') => {
  const parts = parseTextWithFormatting(text)
  return parts.map((part, i) => {
    if (part.type === 'hashtag') {
      return <span key={i} className="text-blue-400">{part.text}</span>
    }
    if (part.type === 'mention') {
      return <span key={i} className="text-blue-400">{part.text}</span>
    }
    return <span key={i}>{part.text}</span>
  })
}

// Twitter/X Preview
const TwitterPreview = ({ content, mediaItems, charLimit, userName = 'Your Name', userHandle = '@yourhandle', userAvatar }: any) => {
  const isOverLimit = content.length > charLimit
  const charPercent = (content.length / charLimit) * 100

  return (
    <div className="bg-black rounded-[6px] p-4 text-white w-full max-w-sm border border-gray-700">
      {/* Header */}
      <div className="flex items-start gap-3 mb-3">
        <div className="w-10 h-10 rounded bg-gray-700 flex items-center justify-center text-xs flex-shrink-0">
          {userAvatar ? <img src={userAvatar} alt="avatar" className="w-full h-full rounded object-cover" /> : (userName[0]?.toUpperCase() || 'Y')}
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-1">
            <span className="text-sm">{userName}</span>
            <span className="text-gray-500 text-sm">{userHandle}</span>
          </div>
          <span className="text-gray-500 text-xs">· now</span>
        </div>
        <span className="text-gray-500 text-lg">𝕏</span>
      </div>

      {/* Content */}
      <div className="mb-3 text-sm text-white leading-normal">
        {content.length > 0 ? (
          <>
            {renderFormattedText(content.slice(0, charLimit))}
            {isOverLimit && <span className="text-gray-500">…</span>}
          </>
        ) : (
          <span className="text-gray-500">Your post will appear here</span>
        )}
      </div>

      {/* Character count */}
      {content.length > 0 && (
        <div className="mb-3 flex items-center gap-2">
          <div className="flex-1 h-1 bg-gray-700 rounded overflow-hidden">
            <div
              className={`h-full transition-colors ${
                isOverLimit ? 'bg-red-500' : charPercent > 80 ? 'bg-[var(--sc-surface)]' : 'bg-gray-600'
              }`}
              style={{ width: `${Math.min(charPercent, 100)}%` }}
            />
          </div>
          <span className={`text-xs font-medium ${isOverLimit ? 'text-[var(--st-danger)]' : charPercent > 80 ? 'text-[var(--sc-ink-soft)]' : 'text-gray-500'}`}>
            {content.length}/{charLimit}
          </span>
        </div>
      )}

      {/* Media */}
      {mediaItems.length > 0 && (
        <div className="mb-3 rounded-[6px] overflow-hidden border border-gray-700">
          {mediaItems.length === 1 && (
            <img src={mediaItems[0].url} alt="media" className="w-full h-48 object-cover" />
          )}
          {mediaItems.length === 2 && (
            <div className="flex gap-0.5">
              {mediaItems.map((m: { id: string; url: string }) => (
                <img key={m.id} src={m.url} alt="media" className="flex-1 h-24 object-cover" />
              ))}
            </div>
          )}
          {mediaItems.length === 3 && (
            <div className="flex gap-0.5">
              <img src={mediaItems[0].url} alt="media" className="flex-1 h-32 object-cover" />
              <div className="flex flex-col gap-0.5 flex-1">
                {[1, 2].map(i => (
                  <img key={mediaItems[i]?.id} src={mediaItems[i]?.url} alt="media" className="w-full h-15 object-cover" />
                ))}
              </div>
            </div>
          )}
          {mediaItems.length >= 4 && (
            <div className="grid grid-cols-2 gap-0.5">
              {mediaItems.slice(0, 4).map((m: { id: string; url: string }) => (
                <img key={m.id} src={m.url} alt="media" className="w-full h-24 object-cover" />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Engagement bar */}
      <div className="flex justify-between text-gray-500 text-sm border-t border-gray-700 pt-3 px-2">
        <span>💬</span>
        <span>🔁</span>
        <span>❤️</span>
        <span>📊</span>
      </div>

      {/* Badge */}
      <div className="absolute top-2 right-2 bg-black border border-gray-700 rounded w-6 h-6 flex items-center justify-center text-xs text-white">
        𝕏
      </div>
    </div>
  )
}

// LinkedIn Preview
const LinkedInPreview = ({ content, mediaItems, charLimit, userName = 'Your Name', userHandle = '@yourhandle', userAvatar }: any) => {
  const isOverLimit = content.length > charLimit
  const truncateAt = 210

  return (
    <div className="bg-[var(--color-pib-surface)] rounded-[6px] p-4 text-[var(--color-pib-text)] w-full max-w-sm border border-[var(--color-pib-line)]/20">
      {/* Header */}
      <div className="flex items-start gap-3 mb-3">
        <div className="w-10 h-10 rounded bg-gray-600 flex items-center justify-center text-xs flex-shrink-0">
          {userAvatar ? <img src={userAvatar} alt="avatar" className="w-full h-full rounded object-cover" /> : (userName[0]?.toUpperCase() || 'Y')}
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-sm">{userName}</span>
            <span className="bg-[var(--sc-surface)] text-[var(--sc-ink-soft)] text-[10px] px-1.5 py-0.5 rounded">1st</span>
          </div>
          <p className="text-[var(--color-pib-text-muted)] text-xs">Professional Title (placeholder)</p>
          <span className="text-[var(--color-pib-text-muted)] text-xs">now · 🌐</span>
        </div>
      </div>

      {/* Content */}
      <div className="text-sm text-[var(--color-pib-text)] leading-relaxed mb-3">
        {content.length > 0 ? (
          <>
            {renderFormattedText(isOverLimit ? content.slice(0, truncateAt) : content)}
            {isOverLimit && <span className="text-[var(--color-pib-text-muted)]">...see more</span>}
          </>
        ) : (
          <span className="text-[var(--color-pib-text-muted)]">Your post will appear here</span>
        )}
      </div>

      {/* Media */}
      {mediaItems.length > 0 && (
        <div className="mb-3 rounded-[6px] overflow-hidden">
          <img src={mediaItems[0].url} alt="media" className="w-full h-40 object-cover" />
        </div>
      )}

      {/* Engagement */}
      <div className="flex justify-around text-[var(--color-pib-text-muted)] text-sm border-t border-[var(--color-pib-line)]/20 pt-3">
        <span>👍 Like</span>
        <span>💬 Comment</span>
        <span>🔁 Repost</span>
        <span>📤 Send</span>
      </div>

      {/* Badge */}
      <div className="absolute top-2 right-2 bg-blue-700 rounded w-6 h-6 flex items-center justify-center text-xs text-white">
        in
      </div>
    </div>
  )
}

// Instagram Preview
const InstagramPreview = ({ content, mediaItems, charLimit, userName = 'yourname', userHandle = '@yourname', userAvatar }: any) => {
  return (
    <div className="bg-black rounded-[6px] overflow-hidden text-white w-full max-w-sm">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-gray-700">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded -br flex items-center justify-center text-xs flex-shrink-0">
            {userAvatar ? <img src={userAvatar} alt="avatar" className="w-full h-full rounded object-cover" /> : (userName[0]?.toUpperCase() || 'Y')}
          </div>
          <span className="text-sm">{userName}</span>
        </div>
        <span className="text-xl">•••</span>
      </div>

      {/* Image */}
      <div className="bg-[var(--color-pib-surface)] w-full h-96 flex items-center justify-center">
        {mediaItems.length > 0 ? (
          <img src={mediaItems[0].url} alt="media" className="w-full h-full object-cover" />
        ) : (
          <div className="border-2 border-dashed border-amber-500 rounded-lg p-8 text-center">
            <p className="text-[var(--sc-ink-soft)] text-sm font-medium">Add an image</p>
          </div>
        )}
      </div>

      {/* Caption */}
      <div className="p-3 border-b border-gray-700">
        <div className="text-sm text-white mb-2">
          <span>{userName} </span>
          {content.length > 0 ? (
            <>
              {renderFormattedText(content.slice(0, 300))}
              {content.length > 300 && <span className="text-gray-500">…</span>}
            </>
          ) : (
            <span className="text-gray-500">No caption</span>
          )}
        </div>
      </div>

      {/* Engagement */}
      <div className="p-3 space-y-2 border-b border-gray-700">
        <div className="flex justify-between text-xl">
          <span>❤️</span>
          <span>💬</span>
          <span>✈️</span>
          <span className="ml-auto">🔖</span>
        </div>
      </div>

      {/* Badge */}
      <div className="absolute top-2 right-2 -br rounded w-6 h-6 flex items-center justify-center text-xs text-white">
        Ig
      </div>
    </div>
  )
}

// Facebook Preview
const FacebookPreview = ({ content, mediaItems, charLimit, userName = 'Your Name', userHandle = '@yourhandle', userAvatar }: any) => {
  return (
    <div className="bg-[var(--color-pib-surface)] rounded-[6px] p-4 text-[var(--color-pib-text)] w-full max-w-sm border border-[var(--color-pib-line)]/20">
      {/* Header */}
      <div className="flex items-start gap-3 mb-3">
        <div className="w-10 h-10 rounded bg-gray-600 flex items-center justify-center text-xs flex-shrink-0">
          {userAvatar ? <img src={userAvatar} alt="avatar" className="w-full h-full rounded object-cover" /> : (userName[0]?.toUpperCase() || 'Y')}
        </div>
        <div className="flex-1">
          <div className="text-sm">{userName}</div>
          <span className="text-[var(--color-pib-text-muted)] text-xs">Just now · 🌐</span>
        </div>
      </div>

      {/* Content */}
      <div className="text-sm text-[var(--color-pib-text)] leading-relaxed mb-3">
        {content.length > 0 ? (
          renderFormattedText(content)
        ) : (
          <span className="text-[var(--color-pib-text-muted)]">Your post will appear here</span>
        )}
      </div>

      {/* Media */}
      {mediaItems.length > 0 && (
        <div className="mb-3 rounded-[6px] overflow-hidden">
          <img src={mediaItems[0].url} alt="media" className="w-full h-48 object-cover" />
        </div>
      )}

      {/* Engagement */}
      <div className="flex justify-around text-[var(--color-pib-text-muted)] text-sm border-t border-[var(--color-pib-line)]/20 pt-3">
        <span>👍 Like</span>
        <span>💬 Comment</span>
        <span>↗ Share</span>
      </div>

      {/* Badge */}
      <div className="absolute top-2 right-2 bg-blue-600 rounded w-6 h-6 flex items-center justify-center text-xs text-white">
        f
      </div>
    </div>
  )
}

// YouTube Preview
const YouTubePreview = ({ content, mediaItems, charLimit, userName = 'Your Channel', userHandle = '@yourchannel', userAvatar }: any) => {
  const title = content.split('\n')[0] || 'Your video title'
  const description = content.split('\n').slice(1).join('\n') || ''

  return (
    <div className="bg-black rounded-[6px] overflow-hidden text-white w-full max-w-sm">
      {/* Thumbnail */}
      <div className="bg-gray-800 w-full h-48 flex items-center justify-center relative">
        {mediaItems.length > 0 ? (
          <img src={mediaItems[0].url} alt="thumbnail" className="w-full h-full object-cover" />
        ) : (
          <div className="text-center">
            <div className="text-4xl">▶</div>
          </div>
        )}
        <div className="absolute bottom-2 right-2 bg-red-600 px-1.5 py-0.5 rounded text-xs">HD</div>
      </div>

      {/* Title & Description */}
      <div className="p-3 space-y-2">
        <h3 className="text-sm">{title}</h3>
        {description && (
          <p className="text-gray-400 text-xs leading-relaxed">{description.slice(0, 100)}{description.length > 100 ? '...' : ''}</p>
        )}
        <div className="text-xs text-gray-500 mt-2">
          <div>{userName}</div>
          <div>1.2K views · 2 days ago</div>
        </div>
      </div>

      {/* Badge */}
      <div className="absolute top-2 right-2 bg-red-600 rounded w-6 h-6 flex items-center justify-center text-xs text-white">
        YT
      </div>
    </div>
  )
}

// Generic/Fallback Preview
const GenericPreview = ({ platform, content, mediaItems, charLimit, userName = 'Your Name', userHandle = '@yourhandle', userAvatar }: any) => {
  const platformColors: Record<string, string> = {
    reddit: 'bg-orange-600',
    tiktok: 'bg-gray-800',
    pinterest: 'bg-red-700',
    bluesky: 'bg-sky-500',
    threads: 'bg-gray-700',
    mastodon: 'bg-purple-600',
    dribbble: 'bg-pink-500',
  }

  const platformLabels: Record<string, string> = {
    reddit: 'RD',
    tiktok: 'TT',
    pinterest: 'PI',
    bluesky: 'BS',
    threads: 'TH',
    mastodon: 'MA',
    dribbble: 'DR',
  }

  const bgColor = platformColors[platform] || 'bg-gray-600'
  const charPercent = (content.length / charLimit) * 100

  return (
    <div className="bg-[var(--color-pib-surface)] rounded-[6px] p-4 text-[var(--color-pib-text)] w-full max-w-sm border border-[var(--color-pib-line)]/20">
      {/* Header */}
      <div className="flex items-start gap-3 mb-3">
        <div className="w-10 h-10 rounded bg-gray-600 flex items-center justify-center text-xs flex-shrink-0 text-white">
          {userAvatar ? <img src={userAvatar} alt="avatar" className="w-full h-full rounded object-cover" /> : (userName[0]?.toUpperCase() || 'Y')}
        </div>
        <div className="flex-1">
          <span className="text-sm">{userName}</span>
          <p className="text-[var(--color-pib-text-muted)] text-xs capitalize">{platform}</p>
        </div>
      </div>

      {/* Content */}
      <div className="text-sm text-[var(--color-pib-text)] leading-relaxed mb-3">
        {content.length > 0 ? (
          renderFormattedText(content.slice(0, charLimit))
        ) : (
          <span className="text-[var(--color-pib-text-muted)]">Your post will appear here</span>
        )}
      </div>

      {/* Character count bar */}
      {content.length > 0 && (
        <div className="mb-3 flex items-center gap-2">
          <div className="flex-1 h-1.5 bg-[var(--color-pib-surface)] rounded overflow-hidden">
            <div
              className={`h-full transition-colors ${
                content.length > charLimit ? 'bg-red-500' : charPercent > 80 ? 'bg-[var(--sc-surface)]' : 'bg-gray-500'
              }`}
              style={{ width: `${Math.min(charPercent, 100)}%` }}
            />
          </div>
          <span className={`text-xs font-medium ${
            content.length > charLimit ? 'text-[var(--st-danger)]' : charPercent > 80 ? 'text-[var(--sc-ink-soft)]' : 'text-[var(--color-pib-text-muted)]'
          }`}>
            {content.length}/{charLimit}
          </span>
        </div>
      )}

      {/* Media thumbnail */}
      {mediaItems.length > 0 && (
        <div className="mb-3 rounded-lg overflow-hidden">
          <img src={mediaItems[0].url} alt="media" className="w-full h-24 object-cover" />
        </div>
      )}

      {/* Badge */}
      <div className={`absolute top-2 right-2 ${bgColor} rounded w-6 h-6 flex items-center justify-center text-xs  text-white`}>
        {platformLabels[platform] || '?'}
      </div>
    </div>
  )
}

export default function PlatformPreview(props: PlatformPreviewProps) {
  const { platform, content, mediaItems, charLimit, userName, userHandle, userAvatar } = props

  const previewProps = {
    content,
    mediaItems,
    charLimit,
    userName,
    userHandle,
    userAvatar,
  }

  return (
    <div className="relative">
      {platform === 'twitter' && <TwitterPreview {...previewProps} />}
      {platform === 'linkedin' && <LinkedInPreview {...previewProps} />}
      {platform === 'instagram' && <InstagramPreview {...previewProps} />}
      {platform === 'facebook' && <FacebookPreview {...previewProps} />}
      {platform === 'youtube' && <YouTubePreview {...previewProps} />}
      {!['twitter', 'linkedin', 'instagram', 'facebook', 'youtube'].includes(platform) && (
        <GenericPreview {...previewProps} platform={platform} />
      )}
    </div>
  )
}
