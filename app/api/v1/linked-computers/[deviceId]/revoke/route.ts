import { NextRequest,NextResponse } from 'next/server'
import { authenticateSignedDeviceRequest } from '@/lib/linked-computers/http'
import { removeOwnedDevice } from '@/lib/linked-computers/store'
import { lifecycleError,noStoreHeaders } from '@/lib/linked-computers/http'

type Context={params:Promise<{deviceId:string}>}
export async function handleDeviceRevoke(req:NextRequest,deviceId:string,auth=authenticateSignedDeviceRequest,remove=removeOwnedDevice):Promise<Response>{try{const raw=await req.text(),identity=await auth(req,deviceId,raw);await remove({deviceId,actorUserId:identity.ownerUserId});return NextResponse.json({success:true,data:{deviceId,status:'revoked'}},{headers:noStoreHeaders})}catch(error){return lifecycleError(error)}}
export async function POST(req:NextRequest,context:Context){return handleDeviceRevoke(req,(await context.params).deviceId)}
