'use strict';

const SHELL_CACHE='baseline-shell-v6';
const TERRAIN_CACHE='baseline-terrain-v1';
const ONLINE_TILE_CACHE='baseline-online-tiles-v1';
const ONLINE_TILE_LIMIT=384;
const BASE=new URL('./',self.location.href);
const local=path=>new URL(path,BASE).href;
const CORE_MARKER=local('__lite_core_ready__');
const PACK_MARKER=local('__lite_pack_ready__');
const LITE_DATA_URL=local('./data/lite-map-osm.js');

const SHELL=[
  './',
  './index.html',
  './styles.css',
  './state.js',
  './site-store.js',
  './explore-core.js',
  './navigation-core.js',
  './plan-store.js',
  './record-store.js',
  './app.js',
  './offline-runtime.js',
  './lite-map.js',
  './navigation-ui.js',
  './data/sites.js',
  '../vendor/leaflet-1.9.4.css',
  '../vendor/leaflet-1.9.4.js',
  '../vendor/mgrs-1.0.0.js'
].map(local);

const TERRAIN_HOST='https://s3.amazonaws.com';
const TERRAIN_PREFIX='/elevation-tiles-prod/terrarium/';
const ONLINE_TILE_HOSTS=new Set([
  'tile.openstreetmap.org',
  'a.tile.opentopomap.org',
  'b.tile.opentopomap.org',
  'c.tile.opentopomap.org'
]);

function tileXY(lat,lon,z){
  const n=2**z;
  const x=Math.floor((lon+180)/360*n);
  const rad=lat*Math.PI/180;
  const y=Math.floor((1-Math.asinh(Math.tan(rad))/Math.PI)/2*n);
  return [x,y];
}

function koreaTerrainUrls(levels=[5,6,7,8,9]){
  const bbox={south:32.8,west:124.0,north:39.6,east:132.2};
  const urls=[];
  for(const z of levels){
    const [x1,ySouth]=tileXY(bbox.south,bbox.west,z);
    const [x2,yNorth]=tileXY(bbox.north,bbox.east,z);
    const minX=Math.min(x1,x2),maxX=Math.max(x1,x2);
    const minY=Math.min(yNorth,ySouth),maxY=Math.max(yNorth,ySouth);
    for(let x=minX;x<=maxX;x++){
      for(let y=minY;y<=maxY;y++){
        urls.push(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`);
      }
    }
  }
  return urls;
}

async function trimCache(cacheName,limit){
  const cache=await caches.open(cacheName);
  const keys=await cache.keys();
  if(keys.length<=limit)return;
  const excess=keys.length-limit;
  await Promise.all(keys.slice(0,excess).map(req=>cache.delete(req)));
}

async function notify(type,detail={}){
  const clients=await self.clients.matchAll({includeUncontrolled:true,type:'window'});
  clients.forEach(client=>client.postMessage({type,...detail}));
}

async function markerReady(marker){
  const cache=await caches.open(TERRAIN_CACHE);
  return Boolean(await cache.match(marker));
}

async function cacheTerrainUrls(urls,{status='PREPARING',marker=null,concurrency=6}={}){
  const cache=await caches.open(TERRAIN_CACHE);
  let completed=0,failed=0;
  await notify('LITE_PACK_STATUS',{status,completed,total:urls.length,failed});

  const queue=urls.slice();
  const workers=Array.from({length:concurrency},async()=>{
    while(queue.length){
      const url=queue.shift();
      try{
        const req=new Request(url,{mode:'cors',credentials:'omit'});
        const cached=await cache.match(req);
        if(!cached){
          const res=await fetch(req);
          if(!res.ok) throw new Error('HTTP '+res.status);
          await cache.put(req,res.clone());
        }
      }catch{
        failed++;
      }
      completed++;
      if(completed%10===0||completed===urls.length){
        await notify('LITE_PACK_STATUS',{status,completed,total:urls.length,failed});
      }
    }
  });
  await Promise.all(workers);

  if(failed===0&&marker){
    await cache.put(marker,new Response(JSON.stringify({readyAt:Date.now(),tiles:urls.length}),{
      headers:{'content-type':'application/json'}
    }));
  }
  return {completed,total:urls.length,failed};
}

async function coreReady(){return markerReady(CORE_MARKER);}
async function packReady(){return markerReady(PACK_MARKER);}
async function liteDataReady(){
  const cache=await caches.open(SHELL_CACHE);
  return Boolean(await cache.match(LITE_DATA_URL));
}

async function warmLiteData(){
  if(await liteDataReady()){
    await notify('LITE_DATA_STATUS',{status:'READY'});
    return true;
  }
  await notify('LITE_DATA_STATUS',{status:'PREPARING'});
  try{
    const cache=await caches.open(SHELL_CACHE);
    const req=new Request(LITE_DATA_URL,{cache:'no-store'});
    const res=await fetch(req);
    if(!res.ok)throw new Error('HTTP '+res.status);
    await cache.put(req,res.clone());
    await notify('LITE_DATA_STATUS',{status:'READY'});
    return true;
  }catch{
    await notify('LITE_DATA_STATUS',{status:'ERROR'});
    return false;
  }
}

async function warmLiteCore(){
  if(await coreReady()){
    await notify('LITE_PACK_STATUS',{status:(await packReady())?'READY':'CORE_READY'});
    return;
  }
  const result=await cacheTerrainUrls(koreaTerrainUrls([5,6,7]),{
    status:'CORE_PREPARING',
    marker:CORE_MARKER,
    concurrency:4
  });
  await notify('LITE_PACK_STATUS',{
    status:result.failed===0?'CORE_READY':'CORE_PARTIAL',
    completed:result.completed,total:result.total,failed:result.failed
  });
}

async function prepareLitePack(){
  await warmLiteData();
  if(await packReady()){
    await notify('LITE_PACK_STATUS',{status:'READY'});
    return;
  }
  if(!(await coreReady())) await warmLiteCore();

  const urls=koreaTerrainUrls([8,9]);
  const result=await cacheTerrainUrls(urls,{
    status:'PREPARING',
    marker:PACK_MARKER,
    concurrency:6
  });

  if(result.failed===0){
    await notify('LITE_PACK_STATUS',{status:'READY',completed:result.completed,total:result.total,failed:0});
  }else{
    await notify('LITE_PACK_STATUS',{status:'PARTIAL',completed:result.completed,total:result.total,failed:result.failed});
  }
}

self.addEventListener('install',event=>{
  event.waitUntil((async()=>{
    const cache=await caches.open(SHELL_CACHE);
    await cache.addAll(SHELL);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const keep=new Set([SHELL_CACHE,TERRAIN_CACHE,ONLINE_TILE_CACHE]);
    const names=await caches.keys();
    await Promise.all(names.filter(name => {
      if(keep.has(name)) return false;
      return name.startsWith('baseline-shell-') || name.startsWith('baseline-offline-');
    }).map(name=>caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('message',event=>{
  const data=event.data||{};
  if(data.type==='WARM_LITE_CORE'){
    event.waitUntil(warmLiteCore());
  }
  if(data.type==='WARM_LITE_DATA'){
    event.waitUntil(warmLiteData());
  }
  if(data.type==='PREPARE_LITE_PACK'){
    event.waitUntil(prepareLitePack());
  }
  if(data.type==='GET_LITE_PACK_STATUS'){
    event.waitUntil((async()=>{
      const ready=await packReady();
      const core=await coreReady();
      const vector=await liteDataReady();
      event.source?.postMessage({type:'LITE_PACK_STATUS',status:ready?'READY':core?'CORE_READY':'NOT_READY',vectorReady:vector});
    })());
  }
});

self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.method!=='GET') return;
  const url=new URL(req.url);

  if(url.origin===self.location.origin){
    if(url.pathname.includes('/baseline/')||url.pathname.includes('/vendor/')){
      event.respondWith((async()=>{
        const cache=await caches.open(SHELL_CACHE);
        try{
          const res=await fetch(req);
          if(res.ok) cache.put(req,res.clone()).catch(()=>{});
          return res;
        }catch{
          const cached=await cache.match(req);
          if(cached) return cached;
          if(req.mode==='navigate'){
            const fallback=await cache.match(local('./index.html'));
            if(fallback) return fallback;
          }
          return new Response('',{status:504,statusText:'BASELINE offline shell miss'});
        }
      })());
    }
    return;
  }

  if(ONLINE_TILE_HOSTS.has(url.hostname)){
    event.respondWith((async()=>{
      const cache=await caches.open(ONLINE_TILE_CACHE);
      const cached=await cache.match(req);
      if(cached){
        event.waitUntil((async()=>{
          try{
            const fresh=await fetch(req);
            if(fresh.ok||fresh.type==='opaque'){
              await cache.put(req,fresh.clone());
              await trimCache(ONLINE_TILE_CACHE,ONLINE_TILE_LIMIT);
            }
          }catch{}
        })());
        return cached;
      }
      try{
        const res=await fetch(req);
        if(res.ok||res.type==='opaque'){
          await cache.put(req,res.clone());
          await trimCache(ONLINE_TILE_CACHE,ONLINE_TILE_LIMIT);
        }
        return res;
      }catch{
        return new Response('',{status:504,statusText:'Offline map tile unavailable'});
      }
    })());
    return;
  }

  if(url.origin===TERRAIN_HOST&&url.pathname.startsWith(TERRAIN_PREFIX)){
    event.respondWith((async()=>{
      const cache=await caches.open(TERRAIN_CACHE);
      const cached=await cache.match(req);
      if(cached) return cached;
      try{
        const res=await fetch(req);
        if(res.ok) cache.put(req,res.clone()).catch(()=>{});
        return res;
      }catch{
        return new Response('',{status:504,statusText:'Offline terrain tile unavailable'});
      }
    })());
  }
});
