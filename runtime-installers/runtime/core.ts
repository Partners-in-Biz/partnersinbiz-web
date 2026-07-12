import { createHash, generateKeyPairSync, sign, verify, type KeyLike } from 'node:crypto'

export type ReleaseManifest = { channel:string; platform:string; architecture:string; version:string; minimumVersion:string; sha256:string; payloadUrl?:string }
export function canonicalJson(value: unknown): string { if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`; if (value && typeof value === 'object') return `{${Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`; return JSON.stringify(value) }
const parts=(v:string)=>v.split('.').map(Number); const lt=(a:string,b:string)=>{const x=parts(a),y=parts(b); for(const i of [0,1,2]){if((x[i]||0)!==(y[i]||0))return (x[i]||0)<(y[i]||0)} return false}
export function verifyRelease(m:ReleaseManifest, signature:string, payload:Buffer, key:KeyLike, host:{platform:string;architecture:string;currentVersion:string}) {
  if (!verify(null, Buffer.from(canonicalJson(m)), key, Buffer.from(signature,'base64url'))) throw new Error('invalid manifest signature')
  if (m.platform!==host.platform) throw new Error('platform mismatch'); if(m.architecture!==host.architecture) throw new Error('architecture mismatch')
  if (lt(host.currentVersion,m.minimumVersion) || lt(m.version,m.minimumVersion)) throw new Error('minimum version not satisfied')
  if(createHash('sha256').update(payload).digest('hex')!==m.sha256) throw new Error('payload hash mismatch')
  return m
}
export function createPairingIdentity(){ const pair=generateKeyPairSync('ed25519'); return {publicKey:pair.publicKey.export({type:'spki',format:'pem'}).toString(),privateKey:pair.privateKey} }
export function pairingPayload(challengeId:string,code:string,deviceId:string,publicKey:string){return `${challengeId}\n${code}\n${deviceId}\n${publicKey}`}
export function createReceipt(body:Record<string,unknown>, key:KeyLike){return {...body,signature:sign(null,Buffer.from(canonicalJson(body)),key).toString('base64url'),algorithm:'Ed25519'}}
export function redactLog(s:string){return s.replace(/(credential|transportToken|pairingCode|privateKey)\s*[=:]\s*\S+/gi,'$1=[REDACTED]')}
export async function revokeAndCleanup(remote:()=>Promise<unknown>,cleanup:()=>Promise<void>|void){let remoteRevokePending=false;try{await remote()}catch{remoteRevokePending=true}finally{await cleanup()}return{remoteRevokePending}}
