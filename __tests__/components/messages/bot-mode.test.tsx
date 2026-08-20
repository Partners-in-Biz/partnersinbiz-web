import { fireEvent, render, screen } from '@testing-library/react'
import { MessagesExperienceSwitch } from '@/components/messages/bot-mode/MessagesExperienceSwitch'
import { BotRoster } from '@/components/messages/bot-mode/BotRoster'
import { BotComputerStrip } from '@/components/messages/bot-mode/BotComputerStrip'
import { BotModeLanding } from '@/components/messages/bot-mode/BotModeLanding'

const bots = [
  { id: 'theo', name: 'Theo', role: 'Engineering', channelCount: 2, lastChannelTitle: 'Preview builds', onlineComputerCount: 1, iconKey: 'terminal', colorKey: 'sky' },
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
    expect(screen.getByTestId('bot-roster-card-theo')).toHaveTextContent('Engineering')
    expect(screen.getByTestId('bot-roster-card-theo')).toHaveTextContent('2 channels')
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
})
