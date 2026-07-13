import { createPrivateKey, randomUUID, sign } from 'node:crypto'

export type DeviceIdentity = { deviceId:string; credential:string; credentialVersion:number; privateKey:string }

export class DeviceApiClient {
  constructor(private baseUrl:string,private identity:DeviceIdentity,private fetcher:typeof fetch=fetch,private now=Date.now,private nonce=randomUUID) {
    const url=new URL(baseUrl);if(url.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(url.hostname))throw new Error('runtime API must use HTTPS')
  }
  async post(path:string,body:unknown){
    if(!path.startsWith('/api/v1/linked-computers/'))throw new Error('outbound endpoint is not allowlisted')
    const raw=JSON.stringify(body),timestamp=String(this.now()),requestId=this.nonce()
    const payload=`POST\n${path}\n${timestamp}\n${requestId}\n${raw}`
    return this.fetcher(this.baseUrl+path,{method:'POST',headers:{'content-type':'application/json','x-device-id':this.identity.deviceId,'x-device-credential':this.identity.credential,'x-device-credential-version':String(this.identity.credentialVersion),'x-device-timestamp':timestamp,'x-device-request-id':requestId,'x-device-signature':sign(null,Buffer.from(payload),createPrivateKey(this.identity.privateKey)).toString('base64url')},body:raw})
  }
}
