import { readFileSync } from 'node:fs'
import path from 'node:path'

function readPublicMaterialSymbolNames() {
  const layoutSource = readFileSync(
    path.join(process.cwd(), 'app/(public)/layout.tsx'),
    'utf8'
  )
  const iconListMatch = layoutSource.match(/PUBLIC_MATERIAL_SYMBOL_NAMES\s*=\s*\[([\s\S]*?)\]\s*as const/)

  expect(iconListMatch).not.toBeNull()

  return new Set(
    Array.from(iconListMatch![1].matchAll(/'([^']+)'/g), match => match[1])
  )
}

function readLiteralMaterialSymbols(source: string) {
  return Array.from(
    source.matchAll(/className="[^"]*material-symbols-outlined[^"]*"[^>]*>\s*([a-z0-9_]+)\s*<\/span>/g),
    match => match[1]
  )
}

describe('public layout icon subset', () => {
  it('loads the Material Symbols used by the Gauteng audit page', () => {
    const materialSymbolNames = readPublicMaterialSymbolNames()

    for (const iconName of [
      'arrow_downward',
      'arrow_upward',
      'campaign',
      'language',
      'search',
      'warning',
    ]) {
      expect(materialSymbolNames).toContain(iconName)
    }
  })

  it('loads every Material Symbol used by public tool cards', () => {
    const materialSymbolNames = readPublicMaterialSymbolNames()
    const toolCatalogSource = readFileSync(
      path.join(process.cwd(), 'lib/tools/catalog.ts'),
      'utf8'
    )
    const toolIcons = Array.from(
      toolCatalogSource.matchAll(/icon:\s*'([^']+)'/g),
      match => match[1]
    )

    expect(toolIcons.length).toBeGreaterThan(0)
    for (const iconName of toolIcons) {
      expect(materialSymbolNames).toContain(iconName)
    }
  })

  it('loads every Material Symbol used by the start-project form options', () => {
    const materialSymbolNames = readPublicMaterialSymbolNames()
    const startProjectFormSource = readFileSync(
      path.join(process.cwd(), 'app/(public)/start-a-project/StartProjectForm.tsx'),
      'utf8'
    )
    const formOptionIcons = Array.from(
      startProjectFormSource.matchAll(/icon:\s*'([^']+)'/g),
      match => match[1]
    )

    expect(formOptionIcons.length).toBeGreaterThan(0)
    for (const iconName of formOptionIcons) {
      expect(materialSymbolNames).toContain(iconName)
    }
  })

  it('loads every literal Material Symbol used by the start-project page shell', () => {
    const materialSymbolNames = readPublicMaterialSymbolNames()
    const startProjectPageSource = readFileSync(
      path.join(process.cwd(), 'app/(public)/start-a-project/page.tsx'),
      'utf8'
    )
    const pageShellIcons = readLiteralMaterialSymbols(startProjectPageSource)

    expect(pageShellIcons.length).toBeGreaterThan(0)
    for (const iconName of pageShellIcons) {
      expect(materialSymbolNames).toContain(iconName)
    }
  })
})
