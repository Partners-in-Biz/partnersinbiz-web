import { fireEvent, render, screen } from '@testing-library/react'
import { MessagesExperienceSwitch } from '@/components/messages/bot-mode/MessagesExperienceSwitch'
import { BotRoster } from '@/components/messages/bot-mode/BotRoster'
import { BotComputerStrip } from '@/components/messages/bot-mode/BotComputerStrip'
import { BotDeskPanel } from '@/components/messages/bot-mode/BotDeskPanel'
import { BotModeLanding } from '@/components/messages/bot-mode/BotModeLanding'
import { BotInboxRail } from '@/components/messages/bot-mode/BotInboxRail'
import { BotRailDock } from '@/components/messages/bot-mode/BotRailDock'
import { BotRailSwitcher } from '@/components/messages/bot-mode/BotRailSwitcher'
import { BotModeImmersiveShell } from '@/components/messages/bot-mode/BotModeImmersiveShell'
import { shouldHideSiteChrome } from '@/lib/messages/bot-mode-chrome'

const bots = [
  {
    id: 'theo',
    name: 'Theo',
    role: 'Engineering',
    channelCount: 2,
    lastChannelTitle: 'Preview builds',
    lastPreview: 'Ship the preview',
    lastAt: { seconds: Math.floor(Date.now() / 1000) - 120 },
    onlineComputerCount: 1,
    iconKey: 'terminal',
    colorKey: 'sky',
  },
  { id: 'maya', name: 'Maya', role: 'Content', channelCount: 0, onlineComputerCount: 0, iconKey: 'palette', colorKey: 'amber' },
]

const computers = [
  { id: 'mac', label: 'Peet Mac', kind: 'computer' as const, online: true, availableAgentIds: ['theo'] },
  { id: 'vps', label: 'Canonical VPS', kind: 'vps' as const, online: false, availableAgentIds: ['pip'] },
]

describe('bot mode surfaces', () => {
  it('switches between messages and bot mode', () => {
    const onChange = jest.fn()
    render(<MessagesExperienceSwitch value="messages" onChange={onChange} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Bot mode' }))
    expect(onChange).toHaveBeenCalledWith('bot')
  })

  it('lists named bots and starts a channel', () => {
    const onSelectBot = jest.fn()
    const onStartChannel = jest.fn()
    render(<BotRoster bots={bots} activeBotId="theo" onSelectBot={onSelectBot} onStartChannel={onStartChannel} />)
    expect(screen.getByTestId('bot-roster-card-theo')).toHaveTextContent('Ship the preview')
    expect(screen.getByTestId('bot-roster-card-theo')).not.toHaveTextContent('2 channels')
    fireEvent.click(screen.getByRole('button', { name: 'Start channel with Maya' }))
    expect(onStartChannel).toHaveBeenCalledWith('maya')
  })

  it('shows computers and workbench controls', () => {
    const onOpenWorkbench = jest.fn()
    render(
      <BotComputerStrip
        computers={computers}
        activeComputerId="mac"
        onOpenWorkbench={onOpenWorkbench}
        onToggleWorkbench={jest.fn()}
      />,
    )
    expect(screen.getByTestId('bot-computer-mac')).toHaveTextContent('Computer · Peet Mac')
    expect(screen.getByTestId('bot-computer-vps')).toHaveTextContent('VPS · Canonical VPS')
    fireEvent.click(screen.getByRole('button', { name: 'Open Browser on the computer' }))
    expect(onOpenWorkbench).toHaveBeenCalledWith('browser')
    expect(screen.getByRole('link', { name: '1/2 online' })).toHaveAttribute('href', '/portal/settings/linked-computers')
  })

  it('renders a canvas-aware landing with bots and computers', () => {
    const onStartChannel = jest.fn()
    render(<BotModeLanding bots={bots} computers={computers} onStartChannel={onStartChannel} />)
    fireEvent.click(screen.getByTestId('bot-landing-card-theo'))
    expect(onStartChannel).toHaveBeenCalledWith('theo')
    expect(screen.getByText(/Intelligent canvas/i)).toBeInTheDocument()
    expect(screen.getByText(/1 online · 2 paired/)).toBeInTheDocument()
    expect(screen.getByText(/Email · Invoice · Quote/)).toBeInTheDocument()
  })

  it('lists Bot-to-Bot inbox threads and sends work to another Bot', () => {
    const onCreateThread = jest.fn()
    render(
      <BotInboxRail
        threads={[{ id: 'inbox-1', title: 'Inbox · Theo → Maya', fromAgentId: 'theo', toAgentId: 'maya', status: 'open', preview: 'Draft the changelog' }]}
        bots={[{ id: 'theo', name: 'Theo' }, { id: 'maya', name: 'Maya' }]}
        onOpenThread={jest.fn()}
        onCreateThread={onCreateThread}
      />,
    )
    expect(screen.getByTestId('bot-inbox-thread-inbox-1')).toHaveTextContent('Draft the changelog')
    expect(screen.queryByRole('button', { name: 'Send to inbox' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'New inbox thread' }))
    fireEvent.submit(screen.getByRole('button', { name: 'Send to inbox' }).closest('form')!)
    expect(onCreateThread).toHaveBeenCalled()
  })

  it('switches the bot rail between bots, inbox, and channels', () => {
    const onChange = jest.fn()
    render(<BotRailSwitcher value="bots" onChange={onChange} botsCount={12} inboxCount={8} channelsCount={3} />)
    expect(screen.getByTestId('bot-rail-bots')).toHaveAttribute('aria-selected', 'true')
    fireEvent.click(screen.getByTestId('bot-rail-inbox'))
    expect(onChange).toHaveBeenCalledWith('inbox')
    fireEvent.click(screen.getByTestId('bot-rail-channels'))
    expect(onChange).toHaveBeenCalledWith('channels')
  })

  it('shows the isolated folder on the computer strip', () => {
    render(
      <BotComputerStrip
        computers={computers}
        activeComputerId="mac"
        isolatedFolder="bots/theo"
        browserProfileId="bot-theo"
        onOpenWorkbench={jest.fn()}
        onToggleWorkbench={jest.fn()}
      />,
    )
    expect(screen.getByTestId('bot-isolated-folder')).toHaveTextContent('bots/theo')
    expect(screen.getByTestId('bot-isolated-folder')).toHaveTextContent('bot-theo')
  })

  it('creates and imports custom GrokBots from landing', () => {
    const onCreateBot = jest.fn()
    const onImportBot = jest.fn()
    render(
      <BotModeLanding
        bots={bots}
        computers={computers}
        studioDevices={[{ deviceId: 'mac', label: 'Peet Mac', deviceKind: 'computer', supportsCustomAgents: true }]}
        canCreateBot
        onCreateBot={onCreateBot}
        onImportBot={onImportBot}
      />,
    )
    expect(screen.getByTestId('bot-studio-panel')).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('Name'), { target: { value: 'Research' } })
    fireEvent.change(screen.getByPlaceholderText('Role'), { target: { value: 'Analyst' } })
    fireEvent.change(screen.getByPlaceholderText('Purpose and behaviour'), { target: { value: 'Cite sources.' } })
    fireEvent.submit(screen.getByRole('button', { name: 'Create Bot' }).closest('form')!)
    expect(onCreateBot).toHaveBeenCalledWith(expect.objectContaining({ name: 'Research', role: 'Analyst', deviceId: 'mac' }))
  })

  it('hides site chrome until Show navigation is clicked', () => {
    expect(shouldHideSiteChrome({ pathname: '/portal/messages', mode: 'bot', chromeRevealed: false })).toBe(true)
    expect(shouldHideSiteChrome({ pathname: '/portal/messages', mode: 'bot', chromeRevealed: true })).toBe(false)
    expect(shouldHideSiteChrome({ pathname: '/portal/messages', mode: null, chromeRevealed: false })).toBe(false)
    const onShowChrome = jest.fn()
    render(<BotModeImmersiveShell onShowChrome={onShowChrome}><p>Desk</p></BotModeImmersiveShell>)
    expect(screen.getByTestId('bot-mode-immersive-shell')).toHaveTextContent('Desk')
    fireEvent.click(screen.getByRole('button', { name: 'Show navigation' }))
    expect(onShowChrome).toHaveBeenCalled()
  })

  it('shows the bot screen, routines, plugins, and skills', () => {
    const onOpenScreen = jest.fn()
    const onInsertSkill = jest.fn()
    const onOpenInbox = jest.fn()
    render(
      <>
        <BotDeskPanel botName="Theo" computers={computers} standingGoal="Ship leftover uploads" onOpenScreen={onOpenScreen} onNewRoutine={onOpenScreen} />
        <BotRailDock
          userName="Peet Stander"
          pluginsOpen
          onTogglePlugins={jest.fn()}
          inboxCount={2}
          channelsCount={4}
          skills={[{ token: '/goal', label: 'Goal', icon: 'flag' }]}
          computersHref="/portal/settings/linked-computers"
          approvalsHref="/portal/projects"
          onOpenInbox={onOpenInbox}
          onOpenChannels={jest.fn()}
          onOpenCanvas={jest.fn()}
          onInsertSkill={onInsertSkill}
        />
      </>,
    )
    expect(screen.getByTestId('bot-desk-panel')).toHaveTextContent("Theo's screen")
    expect(screen.getByTestId('bot-desk-panel')).toHaveTextContent('Routines')
    expect(screen.getByTestId('bot-routine-standing-goal')).toHaveTextContent('Ship leftover uploads')
    fireEvent.click(screen.getByTestId('bot-desk-open-screen'))
    expect(onOpenScreen).toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('bot-desk-new-routine'))
    expect(onOpenScreen).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByTestId('bot-plugin-skill-goal'))
    expect(onInsertSkill).toHaveBeenCalledWith('/goal')
    fireEvent.click(screen.getByTestId('bot-plugin-inbox'))
    expect(onOpenInbox).toHaveBeenCalled()
    expect(screen.getByTestId('bot-plugin-approvals')).toHaveAttribute('href', '/portal/projects')
    expect(screen.getByTestId('bot-rail-user')).toHaveTextContent('PS')
  })
})
