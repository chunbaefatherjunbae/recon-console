'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const required=['index.html','baseline/index.html','baseline/manifest.json','baseline/sw.js',
  'baseline/app.js','baseline/styles.css','baseline/data/lite-map-osm.js',
  'vendor/leaflet-1.9.4.css','vendor/leaflet-1.9.4.js','vendor/mgrs-1.0.0.js',
  'icons/icon-192.png','icons/icon-512.png'];
for(const file of required) assert(fs.existsSync(path.join(root,file)), 'Missing file: '+file);
const html=fs.readFileSync(path.join(root,'baseline/index.html'),'utf8');
assert(html.includes('RECON CONSOLE // BASELINE'));
assert(!html.includes('TACTICAL RECON'));
assert(html.includes('href="./manifest.json"'));
for(const match of html.matchAll(/(?:href|src)="([^"]+)"/g)){
  const url=match[1];
  if(url.startsWith('#') || /^[a-z]+:/i.test(url)) continue;
  assert(fs.existsSync(path.resolve(root,'baseline',url)), 'Broken HTML reference: '+url);
}
const manifest=JSON.parse(fs.readFileSync(path.join(root,'baseline/manifest.json'),'utf8'));
assert.equal(manifest.name,'RECON CONSOLE');
assert.equal(manifest.start_url,'./');
assert.equal(manifest.scope,'./');
for(const icon of manifest.icons){
  const p=path.resolve(root,'baseline',icon.src);
  assert(fs.existsSync(p),'Missing icon: '+icon.src);
  const b=fs.readFileSync(p);
  assert.equal(b.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  const size=Number.parseInt(icon.sizes.split('x')[0],10);
  assert.equal(b.readUInt32BE(16),size);
  assert.equal(b.readUInt32BE(20),size);
}
const sw=fs.readFileSync(path.join(root,'baseline/sw.js'),'utf8');
const shell=sw.match(/const SHELL=\[([\s\S]*?)\]\.map\(local\)/);
assert(shell,'Service worker SHELL not found');
for(const match of shell[1].matchAll(/'([^']+)'/g)){
  assert(fs.existsSync(path.resolve(root,'baseline',match[1])), 'Broken precache: '+match[1]);
}
assert(sw.includes("scope") || sw.includes("self.location.href"));
const lite=fs.readFileSync(path.join(root,'baseline/data/lite-map-osm.js'),'utf8');
assert(lite.length>2000000,'LITE dataset incomplete');
assert(lite.startsWith('window.BaselineLiteOSM='));
const entry=fs.readFileSync(path.join(root,'index.html'),'utf8');
assert(entry.includes('./baseline/'),'Missing entry-point redirect');
console.log('PASS: RECON CONSOLE standalone links, icons, cache, LITE dataset, branding');
