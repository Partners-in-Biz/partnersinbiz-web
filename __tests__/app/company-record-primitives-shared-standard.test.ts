import fs from 'fs'
import path from 'path'

const root = process.cwd()

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

describe('company record primitives shared standard', () => {
  it('keeps company record empty states, tables, and status chips in the shared CRM namespace', () => {
    const sharedPath = 'components/crm/CompanyRecordPrimitives.tsx'
    const rowsPanelPath = 'components/crm/CompanyRowsPanel.tsx'
    const portalCompanyPath = 'app/(portal)/portal/companies/[id]/page.tsx'

    expect(fs.existsSync(path.join(root, sharedPath))).toBe(true)

    const shared = read(sharedPath)
    const rowsPanel = read(rowsPanelPath)
    const portalCompany = read(portalCompanyPath)

    expect(shared).toContain('export function CompanyRecordEmptyPanel')
    expect(shared).toContain('export function CompanyRecordTableShell')
    expect(shared).toContain('export function CompanyRecordStatusChip')
    expect(shared).toContain('export function readableCompanyStatusLabel')

    expect(rowsPanel).toContain("from '@/components/crm/CompanyRecordPrimitives'")
    expect(rowsPanel).not.toContain('function CompanyStatusChip')
    expect(rowsPanel).not.toContain('function EmptyRowsPanel')
    expect(rowsPanel).not.toContain('function readableStatusLabel')

    expect(portalCompany).toContain("from '@/components/crm/CompanyRecordPrimitives'")
    expect(portalCompany).not.toContain('function EmptyPanel')
    expect(portalCompany).not.toContain('function TableShell')
    expect(portalCompany).not.toContain('function StatusChip')
    expect(portalCompany).not.toContain('function readableStatusLabel')
  })
})
