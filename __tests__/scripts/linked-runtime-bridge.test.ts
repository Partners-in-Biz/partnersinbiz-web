import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  MappingRegistry,
  authorizeRun,
  deepRedact,
  resolveMappedWorkingDirectory,
  sanitizeMappedRelativePath,
} from '../../runtime-installers/runtime/bridge'

describe('runtime bridge boundary', () => {
  it('resolves only contained non-symlink mappings', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'map-'))
    const root = path.join(d, 'root')
    fs.mkdirSync(root)
    const r = new MappingRegistry(path.join(d, 'maps.json'))
    r.map('m', root)
    expect(r.resolve('m')).toBe(fs.realpathSync(root))
    fs.symlinkSync(os.tmpdir(), path.join(root, 'escape'))
    expect(() => r.resolve('m', 'escape')).toThrow(/containment/)
  })

  it('rewrites portable ~/Cowork paths against a Cowork mapping root', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'cowork-map-'))
    const cowork = path.join(d, 'Cowork')
    const project = path.join(cowork, 'AHS Law', 'projects', 'project-1')
    fs.mkdirSync(project, { recursive: true })
    expect(resolveMappedWorkingDirectory(cowork, 'projects/project-1', '~/Cowork/AHS Law/projects/project-1')).toBe(fs.realpathSync(project))
  })

  it('resolves nested partners company folders from a partners org mapping', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'cowork-partners-map-'))
    const partnersRoot = path.join(d, 'Cowork', 'partners', 'Partners in Biz')
    const hunt = path.join(d, 'Cowork', 'partners', 'Hunt and Gun')
    fs.mkdirSync(partnersRoot, { recursive: true })
    fs.mkdirSync(path.join(hunt, 'projects', 'project-1'), { recursive: true })
    expect(resolveMappedWorkingDirectory(
      partnersRoot,
      '',
      '~/Cowork/partners/Hunt and Gun',
    )).toBe(fs.realpathSync(hunt))
    expect(resolveMappedWorkingDirectory(
      partnersRoot,
      '',
      '~/Cowork/partners/Hunt and Gun/projects/project-1',
    )).toBe(fs.realpathSync(path.join(hunt, 'projects', 'project-1')))
  })

  it('auto-creates a missing project relative folder under the mapping root', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'project-autocreate-'))
    const root = path.join(d, 'workspace')
    fs.mkdirSync(root)
    const projectId = 'HRCSWl1cNnh6fYEGziAb'
    const relative = `projects/${projectId}`
    const resolved = resolveMappedWorkingDirectory(root, relative)
    const expected = fs.realpathSync(path.join(root, relative))
    expect(resolved).toBe(expected)
    expect(fs.statSync(resolved).isDirectory()).toBe(true)
    expect(fs.existsSync(path.join(resolved, 'docs'))).toBe(true)
    expect(fs.existsSync(path.join(resolved, 'AGENTS.md'))).toBe(true)
    // Idempotent: second resolve must not throw or replace content
    fs.writeFileSync(path.join(resolved, 'docs', 'keep.md'), 'keep')
    expect(resolveMappedWorkingDirectory(root, relative)).toBe(expected)
    expect(fs.readFileSync(path.join(resolved, 'docs', 'keep.md'), 'utf8')).toBe('keep')
  })

  it('rejects relative path traversal before create', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'project-traverse-'))
    const root = path.join(d, 'workspace')
    fs.mkdirSync(root)
    expect(() => sanitizeMappedRelativePath('../escape')).toThrow(/invalid/)
    expect(() => resolveMappedWorkingDirectory(root, '../escape')).toThrow(/invalid/)
  })

  it('requires exact bearer and bound logical dispatch', () => {
    const x = {
      requestId: 'r', runId: 'run', deviceId: 'd', targetId: 't', credentialVersion: 1,
      mappingId: 'm', orgId: 'o', workspaceId: 'w', projectId: 'p', capability: 'workspace.execute',
    }
    expect(authorizeRun(x, x, 'Bearer token', 'token')).toEqual(x)
    expect(() => authorizeRun(x, { ...x, runId: 'other' }, 'Bearer token', 'token')).toThrow()
    expect(() => authorizeRun(x, x, '', 'token')).toThrow(/authentication/)
  })

  it('deeply redacts auth json pem and nested errors', () => {
    expect(JSON.stringify(deepRedact({
      authorization: 'Bearer abc',
      nested: { transportToken: 'xyz', error: new Error('credential=q') },
      pem: '-----BEGIN PRIVATE KEY----- hi',
    }))).not.toMatch(/abc|xyz|PRIVATE KEY|credential=q/)
  })
})
