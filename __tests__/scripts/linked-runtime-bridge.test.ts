import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import { MappingRegistry,authorizeRun,deepRedact,resolveMappedWorkingDirectory } from '../../runtime-installers/runtime/bridge'
describe('runtime bridge boundary',()=>{it('resolves only contained non-symlink mappings',()=>{const d=fs.mkdtempSync(path.join(os.tmpdir(),'map-')),root=path.join(d,'root');fs.mkdirSync(root);const r=new MappingRegistry(path.join(d,'maps.json'));r.map('m',root);expect(r.resolve('m')).toBe(fs.realpathSync(root));fs.symlinkSync(os.tmpdir(),path.join(root,'escape'));expect(()=>r.resolve('m','escape')).toThrow(/containment/)})
it('rewrites portable ~/Cowork paths against a Cowork mapping root',()=>{
  const d=fs.mkdtempSync(path.join(os.tmpdir(),'cowork-map-'))
  const cowork=path.join(d,'Cowork')
  const project=path.join(cowork,'AHS Law','projects','project-1')
  fs.mkdirSync(project,{recursive:true})
  expect(resolveMappedWorkingDirectory(cowork,'projects/project-1','~/Cowork/AHS Law/projects/project-1')).toBe(fs.realpathSync(project))
})
it('requires exact bearer and bound logical dispatch',()=>{const x={requestId:'r',runId:'run',deviceId:'d',targetId:'t',credentialVersion:1,mappingId:'m',orgId:'o',workspaceId:'w',projectId:'p',capability:'workspace.execute'};expect(authorizeRun(x,x,'Bearer token','token')).toEqual(x);expect(()=>authorizeRun(x,{...x,runId:'other'},'Bearer token','token')).toThrow();expect(()=>authorizeRun(x,x,'','token')).toThrow(/authentication/)})
it('deeply redacts auth json pem and nested errors',()=>{expect(JSON.stringify(deepRedact({authorization:'Bearer abc',nested:{transportToken:'xyz',error:new Error('credential=q')},pem:'-----BEGIN PRIVATE KEY----- hi'}))).not.toMatch(/abc|xyz|PRIVATE KEY|credential=q/)})})
