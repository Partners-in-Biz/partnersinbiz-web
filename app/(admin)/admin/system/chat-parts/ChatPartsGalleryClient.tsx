'use client'

import { useCallback, useState } from 'react'
import MessageBubble, { type ConversationMessage } from '@/components/chat/MessageBubble'
import { PageHeader } from '@/components/ui/AppFoundation'
import { Button, Panel, Title, Toolbar } from '@/components/studio'
import { CHAT_PART_PREVIEW_FIXTURES } from '@/lib/chat/preview-fixtures'
import type { ChatUiAction, RichMessagePart } from '@/lib/hermes/types'

type WidthPreset = 1280 | 390
type PropMode = 'portal' | 'admin'

function assistantMessage(part: RichMessagePart, fixtureId: string): ConversationMessage {
  return {
    id: `preview-${fixtureId}`,
    conversationId: 'preview-fixtures',
    role: 'assistant',
    content: '',
    authorKind: 'agent',
    authorId: 'pip',
    authorDisplayName: 'Pip',
    status: 'completed',
    richParts: [part],
  }
}

export default function ChatPartsGalleryClient() {
  const [width, setWidth] = useState<WidthPreset>(1280)
  const [propMode, setPropMode] = useState<PropMode>('portal')
  const [lastArtifact, setLastArtifact] = useState<string | null>(null)

  const handleOpenArtifact = useCallback((part: RichMessagePart) => {
    setLastArtifact(typeof part.title === 'string' && part.title.trim() ? part.title : part.type)
  }, [])

  const handleUiAction = useCallback((_message: ConversationMessage, _action: ChatUiAction) => {
    return undefined
  }, [])

  const handleStopRun = useCallback(() => {
    return undefined
  }, [])

  const adminProps = {
    onOpenArtifact: handleOpenArtifact,
    onUiAction: handleUiAction,
    onStopRun: handleStopRun,
  }

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <PageHeader
        eyebrow="System"
        title="Chat part fixtures."
        description="Golden MessageBubble fixtures at 1280 and 390. Paper and Ink use the admin topbar theme toggle. No live Hermes data."
      />

      <Toolbar>
        <div>
          <p className="sc-tiny">Width</p>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Preview width">
            <Button
              variant={width === 1280 ? 'primary' : 'secondary'}
              size="sm"
              aria-pressed={width === 1280}
              aria-label="1280 pixel preview width"
              onClick={() => setWidth(1280)}
            >
              1280
            </Button>
            <Button
              variant={width === 390 ? 'primary' : 'secondary'}
              size="sm"
              aria-pressed={width === 390}
              aria-label="390 pixel preview width"
              onClick={() => setWidth(390)}
            >
              390
            </Button>
          </div>
        </div>
        <div>
          <p className="sc-tiny">Props</p>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="MessageBubble props">
            <Button
              variant={propMode === 'portal' ? 'primary' : 'secondary'}
              size="sm"
              aria-pressed={propMode === 'portal'}
              aria-label="Portal MessageBubble props"
              onClick={() => setPropMode('portal')}
            >
              Portal
            </Button>
            <Button
              variant={propMode === 'admin' ? 'primary' : 'secondary'}
              size="sm"
              aria-pressed={propMode === 'admin'}
              aria-label="Admin MessageBubble props"
              onClick={() => setPropMode('admin')}
            >
              Admin
            </Button>
          </div>
        </div>
      </Toolbar>

      {propMode === 'admin' && lastArtifact ? (
        <p className="sc-tiny text-[var(--sc-ink-soft)]">Last opened artifact: {lastArtifact}</p>
      ) : null}

      <div
        data-testid="chat-parts-gallery-frame"
        className="mx-auto w-full space-y-6"
        style={{ maxWidth: width }}
      >
        {CHAT_PART_PREVIEW_FIXTURES.map((fixture) => (
          <Panel key={fixture.id} as="section" className="space-y-4 p-4">
            <Title as="h2">{fixture.title}</Title>
            <MessageBubble
              currentUserUid="user-1"
              message={assistantMessage(fixture.part, fixture.id)}
              {...(propMode === 'admin' ? adminProps : {})}
            />
          </Panel>
        ))}
      </div>
    </div>
  )
}
