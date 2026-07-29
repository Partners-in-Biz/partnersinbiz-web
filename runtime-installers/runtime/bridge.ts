import {execFileSync} from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'

/** Standard subfolders for company Cowork roots and project folders. */
export const STANDARD_WORKSPACE_SUBDIRS = [
  'projects',
  'docs',
  'briefs',
  'assets',
  'marketing',
  'research',
  'operations',
  'deliverables',
  'inbox',
  'archive',
] as const

/** Project-scoped folders (no nested `projects/` under a project). */
export const STANDARD_PROJECT_SUBDIRS = [
  'docs',
  'briefs',
  'assets',
  'marketing',
  'research',
  'operations',
  'deliverables',
  'inbox',
  'archive',
] as const

function expandHome(value:string,mappingRoot?:string){
  // Portable ~/Cowork/... paths must resolve against the mapped Cowork root on
  // VPS (often /var/lib/hermes/Cowork), not the service account home (/root).
  // Mapping roots may be:
  //   /var/lib/hermes/Cowork                          (whole tree)
  //   …/Cowork/Partners in Biz                       (legacy flat)
  //   …/Cowork/partners/Partners in Biz              (org-nested)
  if(mappingRoot&&(value==='~/Cowork'||value.startsWith('~/Cowork/')||value.startsWith('~/Cowork'+path.sep))){
    const suffix=value.slice('~/Cowork'.length).replace(/^[/\\]+/,'')
    const rootName=path.basename(mappingRoot)
    if(rootName==='Cowork'){
      return suffix?path.join(mappingRoot,suffix):mappingRoot
    }
    const parent=path.dirname(mappingRoot)
    if(path.basename(parent)==='Cowork'){
      return suffix?path.join(parent,suffix):parent
    }
    const grandparent=path.dirname(parent)
    if(path.basename(grandparent)==='Cowork'){
      return suffix?path.join(grandparent,suffix):grandparent
    }
  }
  if(value==='~')return os.homedir()
  if(value.startsWith('~/')||value.startsWith('~'+path.sep))return path.join(os.homedir(),value.slice(2))
  return value
}
function isContained(root:string,candidate:string){return candidate===root||candidate.startsWith(root+path.sep)}
/**
 * Resolve a company Cowork working directory. Org Workspace mappings usually point
 * at one folder (e.g. partners/Partners in Biz). Company folders are siblings under
 * the same org nest (…/Cowork/{orgSlug}/), so absolute/portable working directories
 * are allowed when they stay inside that parent.
 */
/** Collapse …/partners/{Name}/partners/{Name}/… from stale conversation paths. */
function collapseNestedPartnersPath(value:string){
  return value
    .replace(/\/partners\/([^/]+)\/partners\/\1(?=\/|$)/g,'/partners/$1')
    .replace(/\/partners\/([^/]+)\/\1(?=\/|$)/g,'/partners/$1')
}
function ensureTraversableDir(dir:string){
  // pib-runtime uses UMask=0077 as root; force 0755 so hermes can is_dir() the cwd.
  try{fs.chmodSync(dir,0o755)}catch{/* ignore */}
}

function maybeChownHermesTree(dir:string){
  if(typeof process.getuid==='function'&&process.getuid()===0&&dir.startsWith('/var/lib/hermes/')){
    try{execFileSync('chown',['-R','hermes:hermes',dir],{stdio:'ignore'})}catch{/* best-effort */}
  }
}

/**
 * Create a standard empty project folder under a mapped workspace root.
 * Used when a project is linked to a computer before sync/provision has created
 * the on-disk path — without this, claim succeeds but acceptance never posts.
 */
export function ensureStandardProjectFolder(dir:string, label:string){
  fs.mkdirSync(dir,{recursive:true,mode:0o755})
  ensureTraversableDir(dir)
  for(const sub of STANDARD_PROJECT_SUBDIRS){
    const subDir=path.join(dir,sub)
    fs.mkdirSync(subDir,{recursive:true,mode:0o755})
    ensureTraversableDir(subDir)
  }
  const agents=path.join(dir,'AGENTS.md')
  if(!fs.existsSync(agents)){
    fs.writeFileSync(
      agents,
      `# ${label}\n\nProject folder created by Partners in Biz linked runtime.\n`,
      {mode:0o644},
    )
  }
  maybeChownHermesTree(dir)
}

function ensureCompanyCoworkFolder(dir:string){
  fs.mkdirSync(dir,{recursive:true,mode:0o755})
  ensureTraversableDir(dir)
  for(const sub of STANDARD_WORKSPACE_SUBDIRS){
    const subDir=path.join(dir,sub)
    fs.mkdirSync(subDir,{recursive:true,mode:0o755})
    ensureTraversableDir(subDir)
  }
  const agents=path.join(dir,'AGENTS.md')
  if(!fs.existsSync(agents)){
    fs.writeFileSync(
      agents,
      `# ${path.basename(dir)}\n\nCompany Cowork folder created by Partners in Biz linked runtime.\n`,
      {mode:0o644},
    )
  }
  maybeChownHermesTree(dir)
}

/** Reject path traversal before mkdir/realpath. */
export function sanitizeMappedRelativePath(relative:string):string{
  const cleaned=(relative||'').trim()
  if(!cleaned||cleaned==='.')return ''
  if(cleaned.startsWith('/')||cleaned.startsWith('~')||/^[A-Za-z]:[\\/]/.test(cleaned)||cleaned.includes('\\')){
    throw new Error('relative path is invalid')
  }
  const segments=cleaned.split('/').filter(Boolean)
  if(!segments.length||segments.some((segment)=>segment==='.'||segment==='..')){
    throw new Error('relative path is invalid')
  }
  return segments.join('/')
}

export function resolveMappedWorkingDirectory(mappingRoot:string,relative='',workingDirectory?:string){
  if(workingDirectory&&workingDirectory.trim()){
    const expanded=expandHome(collapseNestedPartnersPath(workingDirectory.trim()),mappingRoot)
    const requested=path.resolve(expanded)
    const mappingParent=fs.realpathSync(path.dirname(mappingRoot))
    if(!fs.existsSync(requested)){
      const requestedParent=path.dirname(requested)
      const requestedParentReal=fs.existsSync(requestedParent)?fs.realpathSync(requestedParent):requestedParent
      if(isContained(mappingParent,requestedParentReal)||isContained(mappingRoot,requestedParentReal)){
        ensureCompanyCoworkFolder(requested)
      }
    }
    const candidate=fs.realpathSync(requested)
    if(!fs.statSync(candidate).isDirectory())throw new Error('working directory must be a directory')
    if(isContained(mappingRoot,candidate))return candidate
    if(isContained(mappingParent,candidate))return candidate
    throw new Error('mapping containment violation')
  }

  const mappingRootReal=fs.realpathSync(mappingRoot)
  const safeRelative=sanitizeMappedRelativePath(relative)
  if(!safeRelative){
    if(!fs.statSync(mappingRootReal).isDirectory())throw new Error('working directory must be a directory')
    return mappingRootReal
  }

  const requested=path.resolve(mappingRootReal,safeRelative)
  if(!isContained(mappingRootReal,requested))throw new Error('mapping containment violation')

  if(!fs.existsSync(requested)){
    // Link-only project locations write a replica row without creating disk
    // paths. Auto-create the standard project tree so the first claim can
    // accept immediately instead of timing out without an acceptance receipt.
    ensureStandardProjectFolder(requested,path.basename(requested))
  }

  const candidate=fs.realpathSync(requested)
  if(!fs.statSync(candidate).isDirectory())throw new Error('working directory must be a directory')
  if(!isContained(mappingRootReal,candidate))throw new Error('mapping containment violation')
  return candidate
}

export class MappingRegistry{
  constructor(private file:string){}
  private rows():Record<string,string>{
    try{return JSON.parse(fs.readFileSync(this.file,'utf8'))}catch{return{}}
  }
  private save(rows:Record<string,string>){
    fs.mkdirSync(path.dirname(this.file),{recursive:true,mode:0o700})
    fs.chmodSync(path.dirname(this.file),0o700)
    const tmp=this.file+'.tmp'
    fs.writeFileSync(tmp,JSON.stringify(rows),{mode:0o600})
    fs.chmodSync(tmp,0o600)
    fs.renameSync(tmp,this.file)
  }
  map(id:string,root:string){
    if(!/^[A-Za-z0-9_-]{1,128}$/.test(id))throw new Error('invalid mapping id')
    const real=fs.realpathSync(root)
    if(!fs.statSync(real).isDirectory())throw new Error('mapping root must be a directory')
    const rows=this.rows()
    rows[id]=real
    this.save(rows)
  }
  unmap(id:string){
    const r=this.rows()
    delete r[id]
    this.save(r)
  }
  status(){
    return Object.entries(this.rows()).map(([mappingId,root])=>({mappingId,root}))
  }
  resolve(id:string,relative='',workingDirectory?:string){
    const root=this.rows()[id]
    if(!root)throw new Error('mapping unavailable')
    return resolveMappedWorkingDirectory(root,relative,workingDirectory)
  }
}

const fields=['requestId','runId','deviceId','targetId','credentialVersion','mappingId','orgId','workspaceId','projectId','capability'] as const
export function authorizeRun<T extends Record<string,unknown>>(expected:Record<string,unknown>,body:T,authorization:string,token:string){
  const got=authorization.replace(/^Bearer /,'')
  if(!got||got.length!==token.length||!crypto.timingSafeEqual(Buffer.from(got),Buffer.from(token)))throw new Error('transport authentication failed')
  if(body.capability!=='workspace.execute'||fields.some(k=>body[k]!==expected[k]))throw new Error('dispatch binding mismatch')
  return body
}
export function deepRedact(value:unknown):unknown{
  if(value instanceof Error)return{error:'[REDACTED]'}
  if(Array.isArray(value))return value.map(deepRedact)
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value as Record<string,unknown>).map(([key,item])=>[key,/authorization|token|secret|credential|private|pem/i.test(key)?'[REDACTED]':deepRedact(item)]))
  if(typeof value==='string'&&(/BEGIN .*PRIVATE KEY|Bearer\s+|credential=/i.test(value)))return'[REDACTED]'
  return value
}
