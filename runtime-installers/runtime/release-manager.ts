#!/usr/bin/env node
import fs from 'node:fs'
import { createPublicKey } from 'node:crypto'
import { verifyRelease,type ReleaseManifest } from './core'

function arg(name:string){const i=process.argv.indexOf(name);if(i<0||!process.argv[i+1])throw new Error(`${name} required`);return process.argv[i+1]}
export function verifyReleaseFiles(input:{manifest:string;signature:string;payload:string;publicKey:string;platform:string;architecture:string;currentVersion:string;channel:string;allowDowngrade?:boolean;allowUnsignedDev?:boolean}){
 const manifest=JSON.parse(fs.readFileSync(input.manifest,'utf8')) as ReleaseManifest
 const key=input.allowUnsignedDev?createPublicKey(`-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA11qYAYKxCrfVS/7TyWUZ2TWZI1mFRYJBFsDFoZvG9cE=\n-----END PUBLIC KEY-----`):createPublicKey(fs.readFileSync(input.publicKey));verifyRelease(manifest,input.allowUnsignedDev?'':fs.readFileSync(input.signature,'utf8').trim(),fs.readFileSync(input.payload),key,{platform:input.platform,architecture:input.architecture,currentVersion:input.currentVersion,channel:input.channel,allowDowngrade:input.allowDowngrade,allowUnsignedDev:input.allowUnsignedDev})
 return manifest
}
if(require.main===module){try{if(!['verify','installed-version'].includes(process.argv[2]))throw new Error('usage: pib-release-manager verify|installed-version ...');const manifest=JSON.parse(fs.readFileSync(arg('--manifest'),'utf8')) as ReleaseManifest,allowUnsignedDev=process.argv.includes('--allow-unsigned-dev');const verified=verifyReleaseFiles({manifest:arg('--manifest'),signature:allowUnsignedDev?'':arg('--signature'),payload:arg('--payload'),publicKey:allowUnsignedDev?'':arg('--public-key'),platform:arg('--platform'),architecture:arg('--architecture'),currentVersion:process.argv[2]==='installed-version'?manifest.version:arg('--current-version'),channel:arg('--channel'),allowDowngrade:process.argv.includes('--allow-downgrade'),allowUnsignedDev});process.stdout.write(process.argv[2]==='installed-version'?`${verified.version}\n`:'verified\n')}catch(e){console.error(e instanceof Error?e.message:String(e));process.exitCode=1}}
