import { fireEvent, render, screen } from '@testing-library/react'
import {
  Avatar,
  Button,
  Checkbox,
  Choice,
  Crumbs,
  DataItem,
  DataList,
  Field,
  Icon,
  Input,
  Menu,
  Notice,
  Pagination,
  RadioGroup,
  Skeleton,
  Status,
  Steps,
  Switch,
  Table,
  TD,
  TH,
  THead,
  TR,
} from '@/components/studio'

describe('Studio UI primitives', () => {
  it('Field links its label to the control so the design-audit gate passes', () => {
    render(
      <Field id="email" label="Email" hint="Optional" help="We never share it.">
        <Input id="email" type="email" />
      </Field>,
    )
    const input = screen.getByLabelText(/email/i)
    expect(input).toHaveAttribute('id', 'email')
    expect(screen.getByText('We never share it.')).toHaveClass('st-help')
  })

  it('Field renders an error as an alert and drops the help text', () => {
    render(
      <Field id="name" label="Name" help="Full name" error="Required">
        <Input id="name" invalid />
      </Field>,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('Required')
    expect(screen.queryByText('Full name')).toBeNull()
    expect(screen.getByLabelText('Name')).toHaveAttribute('aria-invalid', 'true')
  })

  it('Button is disabled and busy while loading, defaults to type=button', () => {
    render(<Button loading>Save</Button>)
    const button = screen.getByRole('button', { name: /save/i })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
    expect(button).toHaveAttribute('type', 'button')
    expect(button).toHaveClass('st-btn', 'st-btn--primary')
  })

  it('Choice exposes selection through aria-pressed', () => {
    render(<Choice selected>09:00</Choice>)
    expect(screen.getByRole('button', { name: '09:00' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('Steps marks the current step', () => {
    render(<Steps steps={['Date', 'Time', 'Details']} current={1} />)
    const current = screen.getByText(/02 Time/)
    expect(current).toHaveAttribute('aria-current', 'step')
    expect(screen.getByText(/01 Date/)).toHaveClass('st-steps__item--done')
  })

  it('Notice with a danger tone is an alert; Status carries its tone class', () => {
    render(
      <>
        <Notice tone="danger">Failed</Notice>
        <Status tone="success">Live</Status>
      </>,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('Failed')
    expect(screen.getByText('Live')).toHaveClass('st-status--success')
  })

  it('Checkbox and Switch are labelled; RadioGroup selects one value', () => {
    const onChange = jest.fn()
    render(
      <>
        <Checkbox label="Send receipts" defaultChecked />
        <Switch label="Quiet hours" />
        <RadioGroup
          name="plan"
          label="Plan"
          value="starter"
          onChange={onChange}
          options={[
            { value: 'starter', label: 'Starter' },
            { value: 'growth', label: 'Growth' },
          ]}
        />
      </>,
    )
    expect(screen.getByLabelText('Send receipts')).toBeChecked()
    expect(screen.getByRole('switch', { name: 'Quiet hours' })).toHaveAttribute('type', 'checkbox')
    fireEvent.click(screen.getByLabelText('Growth'))
    expect(onChange).toHaveBeenCalledWith('growth')
  })

  it('Menu opens items and closes on select', () => {
    const onSelect = jest.fn()
    render(
      <Menu
        label="Actions"
        trigger="Actions"
        items={[{ id: 'edit', label: 'Edit', onSelect }]}
      />,
    )
    expect(screen.queryByRole('menuitem', { name: 'Edit' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Actions' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }))
    expect(onSelect).toHaveBeenCalled()
    expect(screen.queryByRole('menuitem', { name: 'Edit' })).toBeNull()
  })

  it('Table, DataList, Avatar, Crumbs, Pagination, Skeleton and Icon render stable classes', () => {
    render(
      <>
        <Table>
          <THead>
            <TR>
              <TH>Name</TH>
            </TR>
          </THead>
          <tbody>
            <TR>
              <TD>Acme</TD>
            </TR>
          </tbody>
        </Table>
        <DataList>
          <DataItem label="Status">Open</DataItem>
        </DataList>
        <Avatar initials="PS" />
        <Crumbs items={[{ href: '/portal', label: 'Portal' }, { label: 'Companies' }]} />
        <Pagination from={1} to={20} total={118} prevDisabled nextDisabled={false} />
        <Skeleton width={120} height={16} />
        <Icon name="search" />
        <Icon name="settings" label="Settings" />
      </>,
    )
    expect(screen.getByRole('table')).toHaveClass('st-table')
    expect(screen.getByText('Name')).toHaveClass('sc-tiny')
    expect(screen.getByText('Status')).toHaveClass('sc-tiny')
    expect(screen.getByText('PS')).toHaveClass('st-avatar')
    expect(screen.getByLabelText('Breadcrumb')).toBeInTheDocument()
    expect(screen.getByText(/Showing 1 to 20 of 118/)).toBeInTheDocument()
    expect(document.querySelector('.st-skeleton')).toBeTruthy()
    expect(screen.getByText('search')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByLabelText('Settings')).toHaveTextContent('settings')
  })
})
