import type { PluginRecord } from './types'

export const DEFAULT_PLUGIN_CATALOG: PluginRecord[] = [
  {
    id: 'gateway-logger',
    name: 'Gateway Logger',
    kind: 'general',
    version: '1.0.0',
    installed: false,
    contributes: ['hooks'],
  },
  {
    id: 'tool-guardrails',
    name: 'Tool Guardrails',
    kind: 'general',
    version: '1.0.0',
    installed: false,
    contributes: ['tools', 'hooks'],
  },
  {
    id: 'mem0-bridge',
    name: 'Mem0 Bridge',
    kind: 'memory',
    version: '0.9.0',
    installed: false,
    contributes: ['memory'],
  },
  {
    id: 'context-compress',
    name: 'Context Compress',
    kind: 'context_engine',
    version: '1.1.0',
    installed: false,
    contributes: ['context'],
  },
]

export function listPlugins(installed: PluginRecord[] = []): PluginRecord[] {
  const map = new Map<string, PluginRecord>()
  for (const p of DEFAULT_PLUGIN_CATALOG) map.set(p.id, { ...p, contributes: [...p.contributes] })
  for (const p of installed) map.set(p.id, { ...p, contributes: [...p.contributes] })
  return [...map.values()]
}

export function installPlugin(
  catalog: PluginRecord[],
  pluginId: string,
): PluginRecord[] {
  const found = catalog.find((p) => p.id === pluginId) || DEFAULT_PLUGIN_CATALOG.find((p) => p.id === pluginId)
  if (!found) throw new Error(`Unknown plugin: ${pluginId}`)
  const others = catalog.filter((p) => p.id !== pluginId)
  return [...others, { ...found, installed: true, contributes: [...found.contributes] }]
}

export function uninstallPlugin(catalog: PluginRecord[], pluginId: string): PluginRecord[] {
  return catalog.map((p) => (p.id === pluginId ? { ...p, installed: false } : p))
}
