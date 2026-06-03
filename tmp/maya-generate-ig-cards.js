const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const outDir = process.argv[2] || 'tmp/maya-ig-cards';
fs.mkdirSync(outDir, { recursive: true });
const posts = JSON.parse(fs.readFileSync(0, 'utf8'));

function esc(s){ return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c])); }
function wrap(text, max=24, lines=3){
  const words = String(text||'').split(/\s+/).filter(Boolean); const out=[]; let line='';
  for (const w of words){
    const next = line ? line+' '+w : w;
    if (next.length > max && line){ out.push(line); line=w; } else line=next;
    if (out.length === lines) break;
  }
  if (out.length < lines && line) out.push(line);
  return out.slice(0, lines);
}
function slug(s){ return String(s||'post').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,60) || 'post'; }
const accents = ['#F5A623','#00E0B8','#FF6B7A','#A78BFA','#35B6FF','#F97316'];
(async()=>{
  const manifest=[];
  for (let i=0;i<posts.length;i++){
    const p=posts[i];
    const accent=accents[i%accents.length];
    const headline=String(p.headline||'Growth system').replace(/\s+/g,' ').trim();
    const kicker=String(p.kicker||'PARTNERS IN BIZ').toUpperCase();
    const lines=wrap(headline, 21, 3);
    const file=path.join(outDir, `${String(i+1).padStart(2,'0')}-${slug(headline)}.png`);
    const lineSvg=lines.map((l,idx)=>`<text x="96" y="${420+idx*86}" class="headline">${esc(l)}</text>`).join('');
    const svg=`<svg width="1080" height="1080" viewBox="0 0 1080 1080" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="g1" cx="78%" cy="18%" r="62%"><stop offset="0" stop-color="${accent}" stop-opacity="0.42"/><stop offset="1" stop-color="#07111f" stop-opacity="0"/></radialGradient>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#05070b"/><stop offset="0.55" stop-color="#091624"/><stop offset="1" stop-color="#02040a"/></linearGradient>
        <linearGradient id="card" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#102033"/><stop offset="1" stop-color="#07101d"/></linearGradient>
        <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="32" stdDeviation="28" flood-color="#000" flood-opacity="0.55"/></filter>
        <style>
          .kicker{font:800 24px Inter,Arial,sans-serif;letter-spacing:5px;fill:${accent}}
          .headline{font:900 66px Inter,Arial,sans-serif;fill:#F8FAFC;letter-spacing:-2px}
          .body{font:700 26px Inter,Arial,sans-serif;fill:#B8C7D9;letter-spacing:.2px}
          .tiny{font:800 22px Inter,Arial,sans-serif;fill:#00E0B8;letter-spacing:.5px}
          .num{font:900 46px Inter,Arial,sans-serif;fill:#F8FAFC}
        </style>
      </defs>
      <rect width="1080" height="1080" fill="url(#bg)"/>
      <rect width="1080" height="1080" fill="url(#g1)"/>
      <circle cx="900" cy="158" r="260" fill="${accent}" opacity="0.12"/>
      <circle cx="120" cy="970" r="350" fill="#00E0B8" opacity="0.08"/>
      <path d="M0,760 C220,680 365,835 550,760 C760,672 830,550 1080,580 L1080,1080 L0,1080 Z" fill="#0b1d2e" opacity="0.72"/>
      <g filter="url(#shadow)">
        <rect x="72" y="96" width="936" height="888" rx="42" fill="url(#card)" stroke="#26445d" stroke-width="2"/>
        <rect x="72" y="96" width="936" height="888" rx="42" fill="none" stroke="${accent}" stroke-width="4" stroke-opacity="0.28"/>
      </g>
      <rect x="96" y="132" width="166" height="10" rx="5" fill="${accent}"/>
      <text x="96" y="214" class="kicker">${esc(kicker)}</text>
      <g opacity="0.9">
        <rect x="720" y="170" width="210" height="128" rx="24" fill="#0d1f31" stroke="#254258"/>
        <circle cx="772" cy="234" r="28" fill="${accent}" opacity="0.9"/>
        <path d="M818 252 L878 206 L918 258" fill="none" stroke="#00E0B8" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/>
        <text x="742" y="338" class="tiny">growth signal</text>
      </g>
      ${lineSvg}
      <g transform="translate(96 720)">
        <rect x="0" y="0" width="252" height="126" rx="24" fill="#06111d" stroke="#24465f"/>
        <text x="28" y="54" class="num">01</text><text x="86" y="52" class="body">Plan</text><text x="28" y="92" class="tiny">brief → assets</text>
        <rect x="292" y="0" width="252" height="126" rx="24" fill="#06111d" stroke="#24465f"/>
        <text x="320" y="54" class="num">02</text><text x="406" y="52" class="body">Review</text><text x="320" y="92" class="tiny">approve faster</text>
        <rect x="584" y="0" width="252" height="126" rx="24" fill="#06111d" stroke="#24465f"/>
        <text x="612" y="54" class="num">03</text><text x="698" y="52" class="body">Grow</text><text x="612" y="92" class="tiny">pipeline proof</text>
      </g>
      <text x="96" y="928" class="tiny">partnersinbiz.online</text>
      <circle cx="936" cy="926" r="28" fill="${accent}"/><circle cx="906" cy="926" r="28" fill="#00E0B8" opacity="0.85"/>
    </svg>`;
    await sharp(Buffer.from(svg)).png().toFile(file);
    manifest.push({postId:p.id, headline, file});
  }
  console.log(JSON.stringify(manifest, null, 2));
})();
