import { createHash, generateKeyPairSync, sign, verify, type KeyLike } from 'node:crypto'
export type JSONPrimitive=string|number|boolean|null
export type JSONValue=JSONPrimitive|JSONValue[]|{[key:string]:JSONValue}

export type ReleaseManifest = { channel:string; platform:string; architecture:string; version:string; minimumVersion:string; sha256:string; payloadUrl?:string }
export function canonicalJson(value: unknown): string { if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`; if (value && typeof value === 'object') return `{${Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`; return JSON.stringify(value) }
const SEMVER=/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
function semver(v:string){const m=SEMVER.exec(v);if(!m)throw new Error('invalid semver');return{core:[+m[1],+m[2],+m[3]],pre:m[4]?.split('.')}}
const lt=(a:string,b:string)=>{const x=semver(a),y=semver(b);for(let i=0;i<3;i++)if(x.core[i]!==y.core[i])return x.core[i]<y.core[i];if(!x.pre)return false;if(!y.pre)return true;for(let i=0;i<Math.max(x.pre.length,y.pre.length);i++){if(x.pre[i]===undefined)return true;if(y.pre[i]===undefined)return false;if(x.pre[i]===y.pre[i])continue;const xn=/^\d+$/.test(x.pre[i]),yn=/^\d+$/.test(y.pre[i]);if(xn!==yn)return xn;return xn?+x.pre[i]<+y.pre[i]:x.pre[i]<y.pre[i]}return false}
export function verifyRelease(m:ReleaseManifest, signature:string, payload:Buffer, key:KeyLike, host:{platform:string;architecture:string;currentVersion:string;channel?:string;allowDowngrade?:boolean;allowUnsignedDev?:boolean}) {
  semver(m.version);semver(m.minimumVersion);semver(host.currentVersion)
  if(!/^[a-z][a-z0-9-]{0,31}$/.test(m.channel))throw new Error('invalid release channel')
  if (!host.allowUnsignedDev&&!verify(null, Buffer.from(canonicalJson(m)), key, Buffer.from(signature,'base64url'))) throw new Error('invalid manifest signature')
  if (m.platform!==host.platform) throw new Error('platform mismatch'); if(m.architecture!==host.architecture) throw new Error('architecture mismatch')
  if(host.channel&&m.channel!==host.channel)throw new Error('channel mismatch')
  if (lt(host.currentVersion,m.minimumVersion) || lt(m.version,m.minimumVersion)) throw new Error('minimum version not satisfied')
  if(!host.allowDowngrade&&lt(m.version,host.currentVersion))throw new Error('release downgrade refused')
  if(createHash('sha256').update(payload).digest('hex')!==m.sha256) throw new Error('payload hash mismatch')
  return m
}
export function createPairingIdentity(){ const pair=generateKeyPairSync('ed25519'); return {publicKey:pair.publicKey.export({type:'spki',format:'pem'}).toString(),privateKey:pair.privateKey} }
export function pairingPayload(challengeId:string,code:string,deviceId:string,publicKey:string){return `${challengeId}\n${code}\n${deviceId}\n${publicKey.trim()}`}
export function createReceipt(body:Record<string,unknown>, key:KeyLike){return {...body,signature:sign(null,Buffer.from(canonicalJson(body)),key).toString('base64url'),algorithm:'Ed25519'}}
export function redactLog(s:string){return s.replace(/(credential|transportToken|pairingCode|privateKey)\s*[=:]\s*\S+/gi,'$1=[REDACTED]')}
export async function revokeAndCleanup(remote:()=>Promise<unknown>,cleanup:()=>Promise<void>|void){try{await remote();await cleanup();return{remoteRevokePending:false}}catch{return{remoteRevokePending:true}}}
