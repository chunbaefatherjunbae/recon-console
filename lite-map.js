(() => {
  'use strict';

  const App=window.BaselineApp;
  const Offline=window.BaselineOffline;
  let Data=window.BaselineLiteOSM || null;
  let dataLoadPromise=null;
  if(!App||!window.L){
    console.error('[BASELINE LITE] dependency missing');
    return;
  }

  const map=App.map;
  const LITE_VECTOR_ATTR='Map data © OpenStreetMap contributors';
  const MODE_KEY='tr_baseline_map_mode_v1';
  const VALID_MODES=new Set(['auto','online','lite']);
  const processedTerrain=new Map();
  const TERRAIN_MEMORY_LIMIT=48;
  const DATA_URL='./data/lite-map-osm.js';
  let requestedMode=VALID_MODES.has(localStorage.getItem(MODE_KEY)) ? localStorage.getItem(MODE_KEY) : 'auto';
  let effectiveMode='online';
  let vectorReady=false;
  let secondaryRoadReady=false;
  let secondaryRoadScheduled=false;
  let onlineTileErrors=[];
  let fallbackReason=null;

  function clamp(v,min,max){return Math.max(min,Math.min(max,v));}

  function loadLiteData(){
    if(Data) return Promise.resolve(Data);
    if(window.BaselineLiteOSM){
      Data=window.BaselineLiteOSM;
      return Promise.resolve(Data);
    }
    if(dataLoadPromise) return dataLoadPromise;

    dataLoadPromise=new Promise((resolve,reject)=>{
      const existing=document.querySelector('script[data-baseline-lite-data]');
      if(existing){
        existing.addEventListener('load',()=>{
          Data=window.BaselineLiteOSM||null;
          if(Data) resolve(Data); else reject(new Error('lite data missing after load'));
        },{once:true});
        existing.addEventListener('error',()=>reject(new Error('lite data load failed')),{once:true});
        return;
      }

      const script=document.createElement('script');
      script.src=DATA_URL;
      script.async=true;
      script.dataset.baselineLiteData='1';
      script.onload=()=>{
        Data=window.BaselineLiteOSM||null;
        if(Data){
          resolve(Data);
        }else{
          dataLoadPromise=null;
          reject(new Error('lite data missing after load'));
        }
      };
      script.onerror=()=>{
        dataLoadPromise=null;
        reject(new Error('lite data load failed'));
      };
      document.head.appendChild(script);
    });
    return dataLoadPromise;
  }
  function terrainUrl(z,x,y){return 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/'+z+'/'+x+'/'+y+'.png';}

  async function blobToImage(blob){
    if('createImageBitmap' in window){
      return await createImageBitmap(blob);
    }
    return await new Promise((resolve,reject)=>{
      const url=URL.createObjectURL(blob);
      const img=new Image();
      img.onload=()=>{URL.revokeObjectURL(url);resolve(img);};
      img.onerror=()=>{URL.revokeObjectURL(url);reject(new Error('terrain image decode failed'));};
      img.src=url;
    });
  }

  function decodeElevation(r,g,b){
    return (r*256 + g + b/256) - 32768;
  }

  async function processedTerrainCanvas(z,x,y){
    const key=z+'/'+x+'/'+y;
    if(processedTerrain.has(key)) return processedTerrain.get(key);

    const promise=(async()=>{
      const response=await fetch(terrainUrl(z,x,y),{mode:'cors',credentials:'omit'});
      if(!response.ok) throw new Error('terrain '+response.status);
      const image=await blobToImage(await response.blob());
      const source=document.createElement('canvas');
      source.width=256;source.height=256;
      const sctx=source.getContext('2d',{willReadFrequently:true});
      sctx.drawImage(image,0,0,256,256);
      image.close?.();

      const raw=sctx.getImageData(0,0,256,256);
      const out=sctx.createImageData(256,256);
      const elevation=new Float32Array(256*256);
      for(let i=0,p=0;i<raw.data.length;i+=4,p++){
        elevation[p]=decodeElevation(raw.data[i],raw.data[i+1],raw.data[i+2]);
      }

      const centerLat=Math.atan(Math.sinh(Math.PI*(1-2*(y+.5)/(2**z))))*180/Math.PI;
      const metersPerPixel=156543.03392*Math.cos(centerLat*Math.PI/180)/(2**z);
      const contourInterval=z>=10?100:200;

      for(let py=0;py<256;py++){
        for(let px=0;px<256;px++){
          const idx=py*256+px;
          const e=elevation[idx];
          const o=idx*4;
          if(!Number.isFinite(e)||e<=1){
            out.data[o]=1;out.data[o+1]=8;out.data[o+2]=4;out.data[o+3]=255;
            continue;
          }

          const left=elevation[py*256+Math.max(0,px-1)];
          const right=elevation[py*256+Math.min(255,px+1)];
          const up=elevation[Math.max(0,py-1)*256+px];
          const down=elevation[Math.min(255,py+1)*256+px];

          const dzdx=(right-left)/(2*Math.max(1,metersPerPixel));
          const dzdy=(down-up)/(2*Math.max(1,metersPerPixel));
          const directional=clamp(.76 + (-dzdx*.78 + dzdy*.55),.34,1.18);

          let base=18;
          if(e>=100)base=22;
          if(e>=300)base=28;
          if(e>=600)base=35;
          if(e>=1000)base=43;
          if(e>=1500)base=50;

          let green=clamp(Math.round(base*directional),7,74);
          let red=Math.round(green*.08);
          let blue=Math.round(green*.18);

          const band=Math.floor(e/contourInterval);
          const indexBand=Math.floor(e/500);
          const contour=
            Math.floor(left/contourInterval)!==band ||
            Math.floor(right/contourInterval)!==band ||
            Math.floor(up/contourInterval)!==band ||
            Math.floor(down/contourInterval)!==band;
          const indexContour=
            Math.floor(left/500)!==indexBand ||
            Math.floor(right/500)!==indexBand ||
            Math.floor(up/500)!==indexBand ||
            Math.floor(down/500)!==indexBand;

          if(contour){
            green=indexContour?94:62;
            red=indexContour?10:5;
            blue=indexContour?18:12;
          }

          out.data[o]=red;
          out.data[o+1]=green;
          out.data[o+2]=blue;
          out.data[o+3]=255;
        }
      }

      sctx.putImageData(out,0,0);
      return source;
    })();

    processedTerrain.set(key,promise);
    while(processedTerrain.size>TERRAIN_MEMORY_LIMIT){
      const oldest=processedTerrain.keys().next().value;
      if(oldest===key)break;
      processedTerrain.delete(oldest);
    }
    try{return await promise;}
    catch(error){
      processedTerrain.delete(key);
      throw error;
    }
  }

  const TerrainLayer=L.GridLayer.extend({
    createTile(coords,done){
      const tile=document.createElement('canvas');
      tile.width=256;tile.height=256;
      tile.className='lite-terrain-tile';
      const ctx=tile.getContext('2d');
      ctx.fillStyle='#020904';
      ctx.fillRect(0,0,256,256);

      const targetZ=coords.z;
      const preferredZ=Math.min(targetZ,10);

      const drawFrom=async sourceZ=>{
        const factor=2**Math.max(0,targetZ-sourceZ);
        const srcX=Math.floor(coords.x/factor);
        const srcY=Math.floor(coords.y/factor);
        const src=await processedTerrainCanvas(sourceZ,srcX,srcY);
        const sw=256/factor;
        const sx=(coords.x-srcX*factor)*sw;
        const sy=(coords.y-srcY*factor)*sw;
        ctx.imageSmoothingEnabled=true;
        ctx.imageSmoothingQuality='high';
        ctx.drawImage(src,sx,sy,sw,sw,0,0,256,256);
      };

      (async()=>{
        const candidates=[preferredZ,9,8,7,6,5]
          .filter((z,index,list)=>z<=targetZ&&z>=5&&list.indexOf(z)===index)
          .sort((a,b)=>b-a);
        for(const sourceZ of candidates){
          try{
            await drawFrom(sourceZ);
            tile.dataset.terrainSourceZoom=String(sourceZ);
            break;
          }catch{}
        }
        done(null,tile);
      })();

      return tile;
    }
  });

  const terrainLayer=new TerrainLayer({
    pane:'tilePane',
    tileSize:256,
    updateWhenIdle:true,
    keepBuffer:1,
    maxZoom:19,
    minZoom:5,
    attribution:'Terrain © Mapzen / AWS Open Data'
  });

  const vectorLayer=L.layerGroup();
  const secondaryRoadLayer=L.layerGroup();
  const gridLayer=L.layerGroup();
  const placeLayer=L.layerGroup();
  const decodedCache=new Map();

  function roadStyle(cls){
    if(cls==='M') return {color:'#9de3a4',weight:2.35,opacity:.94};
    if(cls==='T') return {color:'#70bc7b',weight:1.9,opacity:.88};
    if(cls==='P') return {color:'#4e945b',weight:1.45,opacity:.84};
    return {color:'#2f6e3d',weight:1.0,opacity:.72,dashArray:'3 5'};
  }

  function decodePolyline(encoded,precision=Number(Data?.precision)||4){
    const factor=10**precision;
    let index=0,lat=0,lon=0;
    const points=[];
    while(index<encoded.length){
      let result=0,shift=0,b;
      do{
        b=encoded.charCodeAt(index++)-63;
        result|=(b&0x1f)<<shift;
        shift+=5;
      }while(b>=0x20&&index<=encoded.length);
      const dlat=(result&1)?~(result>>1):(result>>1);
      lat+=dlat;

      result=0;shift=0;
      do{
        b=encoded.charCodeAt(index++)-63;
        result|=(b&0x1f)<<shift;
        shift+=5;
      }while(b>=0x20&&index<=encoded.length);
      const dlon=(result&1)?~(result>>1):(result>>1);
      lon+=dlon;
      points.push([lat/factor,lon/factor]);
    }
    return points;
  }

  function decodedLines(key,value){
    if(decodedCache.has(key))return decodedCache.get(key);
    let lines=[];
    if(Array.isArray(value)){
      if(value.length&&typeof value[0]==='string'){
        lines=value.map(encoded=>decodePolyline(encoded)).filter(line=>line.length>=2);
      }else{
        // Backward compatibility with the first generated bundle.
        lines=value.map(item=>item?.p).filter(line=>Array.isArray(line)&&line.length>=2);
      }
    }
    decodedCache.set(key,lines);
    return lines;
  }

  function roadLines(cls){
    if(!Data)return [];
    if(Data.roads && !Array.isArray(Data.roads)){
      return decodedLines('road-'+cls,Data.roads[cls]||[]);
    }
    return decodedLines('road-'+cls,(Data.roads||[]).filter(item=>item?.c===cls));
  }

  function ensureSecondaryRoads(){
    if(secondaryRoadReady||secondaryRoadScheduled||!Data||map.getZoom()<11)return;
    secondaryRoadScheduled=true;
    const build=()=>{
      secondaryRoadScheduled=false;
      if(secondaryRoadReady||!Data||map.getZoom()<11)return;
      const secondary=roadLines('S');
      if(secondary.length)L.polyline(secondary,{interactive:false,...roadStyle('S')}).addTo(secondaryRoadLayer);
      secondaryRoadReady=true;
      updateSecondaryRoadVisibility();
    };
    if('requestIdleCallback' in window)requestIdleCallback(build,{timeout:1200});
    else setTimeout(build,120);
  }

  function updateSecondaryRoadVisibility(){
    if(effectiveMode!=='lite')return;
    if(map.getZoom()>=11){
      ensureSecondaryRoads();
      if(secondaryRoadReady&&!vectorLayer.hasLayer(secondaryRoadLayer))vectorLayer.addLayer(secondaryRoadLayer);
    }else if(vectorLayer.hasLayer(secondaryRoadLayer)){
      vectorLayer.removeLayer(secondaryRoadLayer);
    }
  }

  function renderVectors(){
    if(vectorReady||!Data)return;
    vectorReady=true;

    const coastLines=decodedLines('coast',Data.coast||[]);
    if(coastLines.length)L.polyline(coastLines,{interactive:false,color:'#386d48',weight:1.25,opacity:.82}).addTo(vectorLayer);

    const riverLines=decodedLines('rivers',Data.rivers||[]);
    if(riverLines.length)L.polyline(riverLines,{interactive:false,color:'#1e6043',weight:1.15,opacity:.84}).addTo(vectorLayer);

    const railLines=decodedLines('rails',Data.rails||[]);
    if(railLines.length)L.polyline(railLines,{interactive:false,color:'#5f8f67',weight:.9,opacity:.72,dashArray:'5 5'}).addTo(vectorLayer);

    ['M','T','P'].forEach(cls=>{
      const lines=roadLines(cls);
      if(lines.length)L.polyline(lines,{interactive:false,...roadStyle(cls)}).addTo(vectorLayer);
    });

    rebuildPlaces();
    updateSecondaryRoadVisibility();
  }

  function normalizedPlace(item){
    if(Array.isArray(item)){
      return {n:item[0],c:item[1],p:[Number(item[2]),Number(item[3])]};
    }
    return item||{};
  }

  function placeIcon(item){
    const safe=String(item.n||'').replace(/[&<>"]/g,'');
    return L.divIcon({
      className:'lite-place-wrap',
      html:'<span class="lite-place-dot"></span><b>'+safe+'</b>',
      iconSize:[90,18],
      iconAnchor:[4,9]
    });
  }

  function rebuildPlaces(){
    placeLayer.clearLayers();
    const z=map.getZoom();
    const visible=map.getBounds().pad(.28);
    (Data?.places||[]).map(normalizedPlace).forEach(item=>{
      if(!item?.p||!item.n)return;
      if(item.c==='T'&&z<10)return;
      if(!visible.contains(item.p))return;
      L.marker(item.p,{icon:placeIcon(item),interactive:false,zIndexOffset:-100}).addTo(placeLayer);
    });
  }

  function gridStep(){
    const z=map.getZoom();
    if(z<8)return 1;
    if(z<10)return .25;
    if(z<12)return .1;
    if(z<14)return .05;
    return .02;
  }

  function rebuildGrid(){
    gridLayer.clearLayers();
    if(effectiveMode!=='lite')return;
    const bounds=map.getBounds();
    const step=gridStep();
    const south=Math.floor(bounds.getSouth()/step)*step;
    const north=Math.ceil(bounds.getNorth()/step)*step;
    const west=Math.floor(bounds.getWest()/step)*step;
    const east=Math.ceil(bounds.getEast()/step)*step;
    const style={interactive:false,color:'#1a5128',weight:.55,opacity:.38,dashArray:'2 7'};

    for(let lat=south;lat<=north+step/2;lat+=step){
      L.polyline([[lat,west],[lat,east]],style).addTo(gridLayer);
    }
    for(let lon=west;lon<=east+step/2;lon+=step){
      L.polyline([[south,lon],[north,lon]],style).addTo(gridLayer);
    }
  }

  function mapStatusLabel(){
    if(effectiveMode==='lite') return 'MAP · LITE';
    return navigator.onLine ? 'MAP · ONLINE' : 'MAP · CACHED';
  }

  function updateStatusHud(){
    const node=document.getElementById('mapModeStatus');
    if(node)node.textContent=mapStatusLabel();
  }

  function emit(reason){
    updateStatusHud();
    window.dispatchEvent(new CustomEvent('baseline-map-mode-change',{
      detail:{reason,requested:requestedMode,effective:effectiveMode,fallbackReason}
    }));
  }

  function desiredEffective(){
    if(requestedMode==='lite')return 'lite';
    if(requestedMode==='online')return 'online';
    if(fallbackReason==='tile-errors')return 'lite';
    // AUTO tries already-viewed cached online tiles first, even without network.
    // Missing cached coverage produces tile errors and then falls back to LITE.
    return 'online';
  }

  function applyMode(reason='apply'){
    const next=desiredEffective();
    effectiveMode=next;
    if(next==='lite'){
      map.attributionControl?.addAttribution(LITE_VECTOR_ATTR);
      if(map.hasLayer(App.topoLayer))map.removeLayer(App.topoLayer);
      if(map.hasLayer(App.roadBoostLayer))map.removeLayer(App.roadBoostLayer);
      if(!map.hasLayer(terrainLayer))terrainLayer.addTo(map);
      if(!map.hasLayer(vectorLayer))vectorLayer.addTo(map);
      if(!map.hasLayer(gridLayer))gridLayer.addTo(map);
      if(!map.hasLayer(placeLayer))placeLayer.addTo(map);
      rebuildGrid();
      loadLiteData().then(()=>{
        renderVectors();
        rebuildPlaces();
        updateSecondaryRoadVisibility();
        emit('lite-data-ready');
      }).catch(error=>{
        console.error('[BASELINE LITE] vector data unavailable',error);
        emit('lite-data-error');
      });
    }else{
      map.attributionControl?.removeAttribution(LITE_VECTOR_ATTR);
      if(map.hasLayer(terrainLayer))map.removeLayer(terrainLayer);
      if(map.hasLayer(vectorLayer))map.removeLayer(vectorLayer);
      if(map.hasLayer(gridLayer))map.removeLayer(gridLayer);
      if(map.hasLayer(placeLayer))map.removeLayer(placeLayer);
      if(!map.hasLayer(App.topoLayer))App.topoLayer.addTo(map);
      if(!map.hasLayer(App.roadBoostLayer))App.roadBoostLayer.addTo(map);
    }
    emit(reason);
  }

  function setMode(mode){
    const clean=VALID_MODES.has(mode)?mode:'auto';
    requestedMode=clean;
    fallbackReason=null;
    localStorage.setItem(MODE_KEY,clean);
    applyMode('set-mode');
    return status();
  }

  function status(){
    const offline=Offline?.snapshot?.()||null;
    const loaded=Boolean(Data);
    return {
      requested:requestedMode,
      effective:effectiveMode,
      label:mapStatusLabel(),
      dataReady:Boolean(loaded && (
        (Array.isArray(Data.roads) ? Data.roads.length : Object.values(Data.roads||{}).some(list=>list?.length)) ||
        (Data.rivers||[]).length
      )),
      dataCached:Boolean(offline?.vectorReady),
      dataGeneratedAt:Data?.generatedAt||null,
      dataSource:Data?.source||null,
      packStatus:offline?.packStatus||'UNKNOWN',
      packCompleted:offline?.completed||0,
      packTotal:offline?.total||0,
      packFailed:offline?.failed||0
    };
  }

  function noteOnlineTileError(){
    const now=Date.now();
    onlineTileErrors=onlineTileErrors.filter(t=>now-t<5000);
    onlineTileErrors.push(now);
    if(requestedMode==='auto'&&onlineTileErrors.length>=3){
      fallbackReason='tile-errors';
      applyMode('tile-errors');
    }
  }

  App.topoLayer.on('tileerror',noteOnlineTileError);
  App.topoLayer.on('tileload',()=>{
    if(requestedMode==='auto'&&fallbackReason==='tile-errors'){
      onlineTileErrors=[];
    }
  });

  window.addEventListener('online',()=>{
    fallbackReason=null;
    applyMode('online');
  });
  window.addEventListener('offline',()=>{
    fallbackReason=null;
    applyMode('offline');
    if(requestedMode==='auto'&&effectiveMode==='online'){
      App.topoLayer.redraw();
      App.roadBoostLayer.redraw();
    }
  });
  map.on('zoomend moveend',()=>{
    if(effectiveMode==='lite'){
      rebuildGrid();
      rebuildPlaces();
      updateSecondaryRoadVisibility();
    }
  });

  window.BaselineLiteMap=Object.freeze({
    setMode,
    status,
    applyMode,
    terrainLayer,
    vectorLayer,
    secondaryRoadLayer,
    gridLayer,
    placeLayer,
    prepareLitePack:()=>Offline?.prepareLitePack?.(),
    loadLiteData
  });

  applyMode('init');
})();
