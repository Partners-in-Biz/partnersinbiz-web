import { existsSync, readFileSync } from 'fs'
import path from 'path'
import {
  FINANCE_OPERATOR_TABLE_SHORTCUTS,
  FINANCE_TABLE_DENSITY_STORAGE_KEY,
  FINANCE_TABLE_REQUIRED_CSS_TOKENS,
  financeTableRowTabIndex,
  moveFinanceTableFocus,
  nextFinanceTableDensity,
  parseFinanceTableDensity,
  resolveFinanceTableKeyboardAction,
} from '@/lib/finance/operator-table-a11y'

const root = process.cwd()

function read(rel: string) {
  return readFileSync(path.join(root, rel), 'utf8')
}

describe('finance operator table a11y helpers', () => {
  test('parses and toggles density safely', () => {
    expect(parseFinanceTableDensity('dense')).toBe('dense')
    expect(parseFinanceTableDensity('comfortable')).toBe('comfortable')
    expect(parseFinanceTableDensity('nope')).toBe('comfortable')
    expect(parseFinanceTableDensity(null)).toBe('comfortable')
    expect(nextFinanceTableDensity('comfortable')).toBe('dense')
    expect(nextFinanceTableDensity('dense')).toBe('comfortable')
    expect(FINANCE_TABLE_DENSITY_STORAGE_KEY).toMatch(/finance.*density/i)
  })

  test('roving focus stays in range', () => {
    expect(moveFinanceTableFocus(0, 5, -1)).toBe(0)
    expect(moveFinanceTableFocus(0, 5, 1)).toBe(1)
    expect(moveFinanceTableFocus(4, 5, 1)).toBe(4)
    expect(moveFinanceTableFocus(2, 5, 10)).toBe(4)
    expect(moveFinanceTableFocus(0, 0, 1)).toBe(0)
    expect(financeTableRowTabIndex(0, 0)).toBe(0)
    expect(financeTableRowTabIndex(1, 0)).toBe(-1)
  })

  test('keyboard map covers power-user close-week actions', () => {
    expect(FINANCE_OPERATOR_TABLE_SHORTCUTS.length).toBeGreaterThanOrEqual(5)
    expect(resolveFinanceTableKeyboardAction({ key: 'ArrowDown' })).toBe('next')
    expect(resolveFinanceTableKeyboardAction({ key: 'j' })).toBe('next')
    expect(resolveFinanceTableKeyboardAction({ key: 'ArrowUp' })).toBe('prev')
    expect(resolveFinanceTableKeyboardAction({ key: 'k' })).toBe('prev')
    expect(resolveFinanceTableKeyboardAction({ key: 'Home' })).toBe('first')
    expect(resolveFinanceTableKeyboardAction({ key: 'End' })).toBe('last')
    expect(resolveFinanceTableKeyboardAction({ key: ' ' })).toBe('toggle')
    expect(resolveFinanceTableKeyboardAction({ key: 'Enter' })).toBe('toggle')
    expect(resolveFinanceTableKeyboardAction({ key: 'd' })).toBe('density')
    expect(resolveFinanceTableKeyboardAction({ key: '?' })).toBe('help')
    expect(resolveFinanceTableKeyboardAction({ key: 'a', metaKey: true })).toBe(null)
  })

  test('contrast contract uses design-system tokens only', () => {
    expect(FINANCE_TABLE_REQUIRED_CSS_TOKENS).toEqual(
      expect.arrayContaining([
        '--color-pib-text',
        '--color-pib-text-muted',
        '--color-pib-line',
        '--color-pib-surface',
      ]),
    )
  })
})

describe('finance operator table a11y surfaces', () => {
  test('shared components ship density, keyboard, WCAG empty/error states', () => {
    const table = read('components/finance/FinanceResponsiveTable.tsx')
    expect(table).toMatch(/density/)
    expect(table).toMatch(/aria-label|ariaLabel/)
    expect(table).toMatch(/role=\"alert\"|aria-live/)
    expect(table).toMatch(/finance-table-loading/)
    expect(table).toMatch(/finance-table-error/)
    expect(table).toMatch(/finance-table-empty/)
    expect(table).toMatch(/data-density/)
    expect(table).toMatch(/tabIndex/)
    expect(table).toMatch(/onKeyDown/)
    expect(table).toMatch(/focus-visible|focusVisible|outline/)
    expect(table).toMatch(/md:hidden/)
    expect(table).toMatch(/finance-table-desktop/)

    const chrome = read('components/finance/FinanceOperatorTableChrome.tsx')
    expect(chrome).toMatch(/Dense|density/)
    expect(chrome).toMatch(/Keyboard|shortcut/i)
    expect(chrome).toMatch(/aria-pressed|aria-expanded/)
    expect(chrome).toMatch(/FINANCE_OPERATOR_TABLE_SHORTCUTS/)

    const helpers = read('lib/finance/operator-table-a11y.ts')
    for (const token of FINANCE_TABLE_REQUIRED_CSS_TOKENS) {
      expect(helpers).toContain(token)
    }

    const css = read('app/globals.css')
    expect(css).toMatch(/\.pib-finance-table\[data-density=\"dense\"\]|pib-finance-table/)
    expect(css).toMatch(/pib-finance-table/)
  })

  test('documents, ledger, and bank-feeds (recon) mount shared table a11y chrome', () => {
    for (const rel of [
      'app/(portal)/portal/finance/documents/page.tsx',
      'app/(portal)/portal/finance/ledger/page.tsx',
      'app/(portal)/portal/finance/bank-feeds/page.tsx',
    ]) {
      expect(existsSync(path.join(root, rel))).toBe(true)
      const src = read(rel)
      expect(src).toMatch(/FinanceResponsiveTable/)
      expect(src).toMatch(/FinanceOperatorTableChrome|useFinanceTableDensity/)
      expect(src).toMatch(/density/)
    }

    const bank = read('app/(portal)/portal/finance/bank-feeds/page.tsx')
    expect(bank).toMatch(/bank-feed-recon-centre/)
    expect(bank).toMatch(/FinanceResponsiveTable/)
    expect(bank).toMatch(/FinanceOperatorTableChrome/)
    expect(bank).toMatch(/onToggle/)
    expect(bank).toMatch(/suggestion\.accept|bank-feed\.suggestion\.accept/)

    const table = read('components/finance/FinanceResponsiveTable.tsx')
    expect(table).toMatch(/aria-label=\{`Select \$\{label\}`\}/)

    const docs = read('app/(portal)/portal/finance/documents/page.tsx')
    expect(docs).toMatch(/ariaLabel=.*[Ii]nvoice|Customer invoices|Invoices/)
    expect(docs).toMatch(/emptyTitle/)

    const ledger = read('app/(portal)/portal/finance/ledger/page.tsx')
    expect(ledger).toMatch(/Recent journals|journals/)
    expect(ledger).toMatch(/Chart of accounts|accounts/)
  })

  test('phase 6 acceptance pack includes manual a11y checklist', () => {
    const pack = read('docs/operations/finance/phase6-acceptance-pack-2026-08-03.md')
    expect(pack).toMatch(/A11y|a11y|keyboard/)
    expect(pack).toMatch(/dense|Dense/)
    expect(pack).toMatch(/focus order|Focus order|keyboard path/i)
    expect(pack).toMatch(/operator-table-a11y|verify:finance:a11y|FinanceResponsiveTable/)
    expect(pack).toMatch(/manual checklist|Manual a11y|WCAG/i)
  })
})
