import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto'
function expandHome(value:string,mappingRoot?:string){
  // Portable ~/Cowork/... paths must resolve against the mapped Cowork root on
  // VPS (often /var/lib/hermes/Cowork), not the service account home (/root).
  if(mappingRoot&&(value==='~/Cowork'||value.startsWith('~/Cowork/')||value.startsWith('~/Cowork'+path.sep))){
    const rootName=path.basename(mappingRoot)
    if(rootName==='Cowork'){
      const suffix=value.slice('~/Cowork'.length).replace(/^[/\\]+/,'')
      return suffix?path.join(mappingRoot,suffix):mappingRoot
    }
    const parent=path.dirname(mappingRoot)
    if(path.basename(parent)==='Cowork'){
      const suffix=value.slice('~/Cowork'.length).replace(/^[/\\]+/,'')
      return suffix?path.join(parent,suffix):parent
    }
  }
  if(value==='~')return os.homedir()
  if(value.startsWith('~/')||value.startsWith('~'+path.sep))return path.join(os.homedir(),value.slice(2))
  return value
}
function isContained(root:string,candidate:string){return candidate===root||candidate.startsWith(root+path.sep)}
/**
 * Resolve a company Cowork working directory. Org Workspace mappings usually point
 * at one folder (e.g. Partners in Biz). Company folders are siblings under the
 * Cowork parent, so absolute/portable working directories are allowed when they
 * stay inside that parent.
 */
export function resolveMappedWorkingDirectory(mappingRoot:string,relative='',workingDirectory?:string){
  if(workingDirectory&&workingDirectory.trim()){
    const requested=path.resolve(expandHome(workingDirectory.trim(),mappingRoot))
    const mappingParent=fs.realpathSync(path.dirname(mappingRoot))
    if(!fs.existsSync(requested)){
      const requestedParent=path.dirname(requested)
      const requestedParentReal=fs.existsSync(requestedParent)?fs.realpathSync(requestedParent):requestedParent
      if(isContained(mappingParent,requestedParentReal)||isContained(mappingRoot,requestedParentReal)){
        fs.mkdirSync(requested,{recursive:true,mode:0o755})
        for(const sub of ['projects','docs','briefs','assets','marketing','research','operations','deliverables','inbox','archive']){
          fs.mkdirSync(path.join(requested,sub),{recursive:true,mode:0o755})
        }
        const agents=path.join(requested,'AGENTS.md')
        if(!fs.existsSync(agents))fs.writeFileSync(agents,`# ${path.basename(requested)}\n\nCompany Cowork folder created by Partners in Biz linked runtime.\n`,{mode:0o644})
      }
    }
    const candidate=fs.realpathSync(requested)
    if(!fs.statSync(candidate).isDirectory())throw new Error('working directory must be a directory')
    if(isContained(mappingRoot,candidate))return candidate
    if(isContained(mappingParent,candidate))return candidate
    throw new Error('mapping containment violation')
  }
  const candidate=fs.realpathSync(path.join(mappingRoot,relative))
  if(!isContained(mappingRoot,candidate))throw new Error('mapping containment violation')
  return candidate
}
export class MappingRegistry{constructor(private file:string){}private rows():Record<string,string>{try{return JSON.parse(fs.readFileSync(this.file,'utf8'))}catch{return{}}}private save(rows:Record<string,string>){fs.mkdirSync(path.dirname(this.file),{recursive:true,mode:0o700});fs.chmodSync(path.dirname(this.file),0o700);const tmp=this.file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(rows),{mode:0o600});fs.chmodSync(tmp,0o600);fs.renameSync(tmp,this.file)}map(id:string,root:string){if(!/^[A-Za-z0-9_-]{1,128}$/.test(id))throw new Error('invalid mapping id');const real=fs.realpathSync(root);if(!fs.statSync(real).isDirectory())throw new Error('mapping root must be a directory');const rows=this.rows();rows[id]=real;this.save(rows)}unmap(id:string){const r=this.rows();delete r[id];this.save(r)}status(){return Object.entries(this.rows()).map(([mappingId,root])=>({mappingId,root}))}resolve(id:string,relative='',workingDirectory?:string){const root=this.rows()[id];if(!root)throw new Error('mapping unavailable');return resolveMappedWorkingDirectory(root,relative,workingDirectory)}}
const fields=['requestId','runId','deviceId','targetId','credentialVersion','mappingId','orgId','workspaceId','projectId','capability'] as const
export function authorizeRun<T extends Record<string,unknown>>(expected:Record<string,unknown>,body:T,authorization:string,token:string){const got=authorization.replace(/^Bearer /,'');if(!got||got.length!==token.length||!crypto.timingSafeEqual(Buffer.from(got),Buffer.from(token)))throw new Error('transport authentication failed');if(body.capability!=='workspace.execute'||fields.some(k=>body[k]!==expected[k]))throw new Error('dispatch binding mismatch');return body}
export function deepRedact(value:unknown):unknown{if(value instanceof Error)return{error:'[REDACTED]'};if(Array.isArray(value))return value.map(deepRedact);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value as Record<string,unknown>).map(([key,item])=>[key,/authorization|token|secret|credential|private|pem/i.test(key)?'[REDACTED]':deepRedact(item)]));if(typeof value==='string'&&(/BEGIN .*PRIVATE KEY|Bearer\s+|credential=/i.test(value)))return'[REDACTED]';return value}
