/**
 * GET /embed/form/[publicKey]
 *
 * Returns an embeddable JS widget that renders a contact form into every
 * `<div data-pib-form>` on the host page and POSTs submissions back to
 * /api/public/capture/[publicKey].
 *
 * Drop-in usage on a client site:
 *   <script src="https://partnersinbiz.online/embed/form/PUBLIC_KEY" async></script>
 *   <div data-pib-form></div>
 *
 * The route is unauthenticated. The publicKey is opaque (rotating it kills
 * any deployed widgets using it). The response is JS only — never any HTML
 * shell — so it can be loaded as a <script> tag.
 *
 * Cached for 5 minutes at the CDN: changes to the source's name /
 * consentRequired / redirectUrl propagate within that window.
 */
import { NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import type { CaptureSource, PublicCaptureSourceView } from '@/lib/crm/captureSources'

type Params = { params: Promise<{ publicKey: string }> }

const JS_HEADERS = {
  'Content-Type': 'application/javascript; charset=utf-8',
  'Cache-Control': 'public, max-age=300, s-maxage=300',
  'Access-Control-Allow-Origin': '*',
}

const API_BASE = process.env.NEXT_PUBLIC_BASE_URL || 'https://partnersinbiz.online'

function notFoundJs(publicKey: string): string {
  // A polite no-op script. We expose nothing about whether the key existed,
  // only that the widget is unavailable. Logged to console so an embedder
  // can spot misconfiguration in DevTools.
  return `// Partners in Biz form widget — capture source not found or disabled
console.warn('[pib-form] Widget unavailable for key ${JSON.stringify(publicKey).slice(1, -1)}');
`
}

export async function GET(_req: Request, context: Params) {
  const { publicKey } = await context.params

  // Look up the capture source. Mirrors the public capture endpoint's
  // resolution logic exactly so a key that fails one will fail the other.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sourceSnap = await (adminDb.collection('capture_sources') as any)
    .where('publicKey', '==', publicKey)
    .limit(1)
    .get()

  if (sourceSnap.empty) {
    return new NextResponse(notFoundJs(publicKey), { status: 404, headers: JS_HEADERS })
  }

  const sourceDoc = sourceSnap.docs[0]
  const source = { id: sourceDoc.id, ...sourceDoc.data() } as CaptureSource

  if (source.deleted || !source.enabled) {
    return new NextResponse(notFoundJs(publicKey), { status: 404, headers: JS_HEADERS })
  }

  const view: PublicCaptureSourceView = {
    publicKey: source.publicKey,
    name: source.name || 'Contact us',
    consentRequired: !!source.consentRequired,
    redirectUrl: source.redirectUrl || '',
  }

  return new NextResponse(buildWidgetJs(view), { status: 200, headers: JS_HEADERS })
}

/**
 * Builds the IIFE that the embedder's <script> tag loads. The widget config
 * is JSON-encoded so it can't break out of the JS string. Inline styles only
 * — we never touch the host page's stylesheet.
 */
function buildWidgetJs(source: PublicCaptureSourceView): string {
  const config = {
    apiUrl: `${API_BASE}/api/public/capture/${source.publicKey}`,
    publicKey: source.publicKey,
    name: source.name,
    consentRequired: source.consentRequired,
    redirectUrl: source.redirectUrl,
  }
  // JSON.stringify with </ replaced so a "</script>" inside a value can't
  // close out the script tag if the embedder inlines this response.
  const json = JSON.stringify(config).replace(/</g, '\\u003c')

  return `(function(){'use strict';
var C=${json},D=document;
var FS='box-sizing:border-box;width:100%;padding:10px 12px;border:1px solid #d1d5db;border-radius:6px;font-size:14px;font-family:inherit;background:#fff;color:#111;margin:0;';
var LS='display:block;font-size:13px;font-weight:500;color:#374151;margin:0 0 6px 0;font-family:inherit;';
function input(n,t,p,req,ac){var i=D.createElement('input');i.type=t;i.name=n;if(p)i.placeholder=p;if(req)i.required=true;if(ac)i.autocomplete=ac;i.style.cssText=FS;return i;}
function row(label,inp){var w=D.createElement('div');w.style.cssText='margin:0 0 14px 0;';var l=D.createElement('label');l.textContent=label;l.style.cssText=LS;w.appendChild(l);w.appendChild(inp);return w;}
function render(host){
  if(host.getAttribute('data-pib-rendered')==='1')return;
  host.setAttribute('data-pib-rendered','1');host.innerHTML='';
  var f=D.createElement('form');
  f.style.cssText='max-width:480px;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111;';
  f.setAttribute('novalidate','');
  var nm=input('name','text','Your name',false,'name'),
      em=input('email','email','you@example.com',true,'email'),
      co=input('company','text','Optional',false,'organization'),
      ph=input('phone','tel','Optional',false,'tel');
  f.appendChild(row('Name',nm));f.appendChild(row('Email',em));f.appendChild(row('Company',co));f.appendChild(row('Phone',ph));
  var hp=input('_hp','text','',false,'off');hp.tabIndex=-1;hp.setAttribute('aria-hidden','true');
  hp.style.cssText='position:absolute;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;';
  f.appendChild(hp);
  var cb=null;
  if(C.consentRequired){
    cb=D.createElement('input');cb.type='checkbox';cb.name='consent';cb.required=true;
    cb.style.cssText='margin:0 8px 0 0;vertical-align:middle;';
    var cl=D.createElement('label');
    cl.style.cssText='display:block;font-size:13px;color:#374151;margin:0 0 14px 0;font-family:inherit;line-height:1.4;';
    cl.appendChild(cb);cl.appendChild(D.createTextNode('I agree to receive emails about '+C.name+' and understand that Partners in Biz will process my details under its privacy policy. '));
    var pl=D.createElement('a');pl.href='${API_BASE}/privacy-policy';pl.target='_blank';pl.rel='noopener noreferrer';pl.textContent='Privacy policy';pl.style.cssText='color:#111;text-decoration:underline;';cl.appendChild(pl);
    f.appendChild(cl);
  }
  var btn=D.createElement('button');btn.type='submit';btn.textContent='Submit';
  btn.style.cssText='display:inline-block;padding:10px 18px;background:#F59E0B;color:#111;border:0;border-radius:6px;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;';
  f.appendChild(btn);
  var err=D.createElement('div');
  err.style.cssText='margin:10px 0 0 0;padding:10px 12px;background:#fef2f2;color:#991b1b;border:1px solid #fecaca;border-radius:6px;font-size:13px;font-family:inherit;display:none;';
  err.setAttribute('role','alert');
  f.appendChild(err);
  function showErr(m){err.textContent=m;err.style.display='block';}
  function clearErr(){err.textContent='';err.style.display='none';}
  function reset(){btn.disabled=false;btn.style.opacity='';btn.style.cursor='';}
  f.addEventListener('submit',function(e){
    e.preventDefault();clearErr();
    var email=(em.value||'').trim();
    if(!email){showErr('Please enter your email.');return;}
    if(C.consentRequired&&cb&&!cb.checked){showErr('Please tick the consent checkbox to continue.');return;}
    btn.disabled=true;btn.style.opacity='0.6';btn.style.cursor='wait';
    var payload={email:email,name:(nm.value||'').trim(),company:(co.value||'').trim(),phone:(ph.value||'').trim(),_hp:hp.value||''};
    if(cb)payload.consent=!!cb.checked;
    fetch(C.apiUrl,{method:'POST',mode:'cors',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)})
    .then(function(r){return r.json().then(function(b){return{s:r.status,b:b};}).catch(function(){return{s:r.status,b:null};});})
    .then(function(r){
      if(r.s>=200&&r.s<300){
        var u=r.b&&r.b.data&&r.b.data.redirectUrl;
        if(u){window.location.href=u;return;}
        if(C.redirectUrl){window.location.href=C.redirectUrl;return;}
        var ok=D.createElement('div');ok.textContent="Thanks — we'll be in touch!";
        ok.style.cssText='padding:18px;background:#f0fdf4;color:#166534;border:1px solid #bbf7d0;border-radius:6px;font-size:14px;font-family:inherit;text-align:center;';
        host.innerHTML='';host.appendChild(ok);return;
      }
      if(r.s===429)showErr("Slow down — try again in a minute.");
      else showErr((r.b&&r.b.error)||'Something went wrong. Please try again.');
      reset();
    }).catch(function(){showErr('Network error. Please try again.');reset();});
  });
  host.appendChild(f);
}
function init(){var hs=D.querySelectorAll('div[data-pib-form]');for(var i=0;i<hs.length;i++)render(hs[i]);}
if(D.readyState==='loading')D.addEventListener('DOMContentLoaded',init);else init();
})();
`
}
