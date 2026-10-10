const { chromium, webkit } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const root = path.resolve(__dirname, '..');
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const target = (pathname === '/' || pathname === '/baseline/' || pathname === '/baseline') ? '/baseline/index.html' : pathname;
  const file = path.join(root, target);
  if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  try {
    res.setHeader('Content-Type',
      file.endsWith('.js') ? 'application/javascript' :
      file.endsWith('.css') ? 'text/css' :
      file.endsWith('.html') ? 'text/html' : 'application/octet-stream');
    res.end(fs.readFileSync(file));
  } catch {
    res.writeHead(404).end();
  }
});

(async () => {
  await new Promise(resolve => server.listen(8766, '127.0.0.1', resolve));
  fs.mkdirSync('ui-results-baseline', { recursive: true });
  let failures = 0;

  for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
    const browser = await engine.launch();
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      serviceWorkers: 'allow'
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://*.tile.openstreetmap.org/**', route => route.abort());
    await page.route('https://nominatim.openstreetmap.org/**', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{
        lat:'37.5663',
        lon:'126.9779',
        display_name:'서울특별시 중구 세종대로 110 대한민국',
        address:{state:'서울특별시',borough:'중구',road:'세종대로',house_number:'110'}
      }])
    }));

    try {
      await page.goto('http://127.0.0.1:8766/baseline/');
      await page.waitForFunction(() => window.BaselineApp?.version === 'R0.1-BASELINE');

      assert.equal(await page.locator('.bottom-nav button').count(), 4);
      assert.deepEqual(await page.locator('.bottom-nav button').allTextContents(), ['거점','탐색','계획','기록']);
      assert.equal(await page.locator('.quick-stack .quick-btn').count(), 6);
      assert.equal(await page.locator('.bottom-nav .nav-icon').count(), 0);
      assert.equal(await page.locator('#followBtn svg').count(), 1);
      assert.equal(await page.evaluate(() => BaselineApp.topoLayer?._url.includes('opentopomap.org')), true);
      assert.equal(await page.evaluate(() => BaselineApp.roadBoostLayer?._url.includes('openstreetmap.org')), true);
      assert.equal(await page.evaluate(() => BaselineApp.map.hasLayer(BaselineApp.roadBoostLayer)), true, 'subtle facility/road label overlay must stay available online');
      assert.equal(await page.evaluate(() => BaselineApp.roadBoostLayer.options.opacity), 0.17);
      assert.equal(await page.evaluate(() => BaselineApp.roadBoostLayer.options.minZoom), 15, 'extra road tiles must be deferred until detail zoom');
      assert.equal(await page.locator('#tempBtn').evaluate(el => getComputedStyle(el).touchAction), 'manipulation');
      assert(parseFloat(await page.locator('.bottom-nav button').first().evaluate(el => getComputedStyle(el).fontSize)) >= 14);
      assert(parseFloat(await page.locator('#positionCoord').evaluate(el => getComputedStyle(el).fontSize)) >= 13);
      assert(parseFloat(await page.locator('#positionMeta').evaluate(el => getComputedStyle(el).fontSize)) >= 11);
      assert.equal(await page.locator('#positionMeta').evaluate(el => getComputedStyle(el).color), 'rgb(145, 214, 158)');
      assert.equal(await page.locator('#mapModeStatus').evaluate(el => getComputedStyle(el).color), 'rgb(127, 201, 142)');
      assert.equal(await page.locator('#reticleCoord').count(), 1);
      const bodyText = await page.locator('body').textContent();
      assert.equal(bodyText.includes('\\n'), false, 'escaped newline text must never render');
      assert.equal(await page.locator('.map-tech-grid').evaluate(el => getComputedStyle(el).opacity), '0.48');
      const gridAlignment=await page.locator('.map-tech-grid').evaluate(el=>getComputedStyle(el).backgroundPosition);
      assert(gridAlignment.includes('50% 50%'),'grid lines must align to the central map reticle');
      const hudShade=await page.locator('.position-hud').evaluate(el=>{
        const before=getComputedStyle(el,'::before'),line=getComputedStyle(el,'::after');
        return {shadeHeight:parseFloat(before.height),lineHeight:parseFloat(line.height),
          shadeTop:parseFloat(before.top),lineTop:parseFloat(line.top)};
      });
      assert(Math.abs(hudShade.shadeHeight-hudShade.lineHeight)<1 &&
        Math.abs(hudShade.shadeTop-hudShade.lineTop)<1,
        'upper POS background and vertical accent line must share identical vertical bounds');
      assert.equal(await page.locator('.position-hud').evaluate(el => getComputedStyle(el,'::before').backgroundColor), 'rgba(0, 8, 3, 0.21)');
      assert.equal(await page.locator('.position-hud').evaluate(el => getComputedStyle(el,'::after').content !== 'none'), true);
      // C-2 optical reticle is a single coordinate-anchored SVG:
      // exactly 4 brackets, 4 isolated ticks and one central point.
      const sight=await page.locator('.reticle').evaluate(el=>{
        const svg=el.querySelector('svg.reticle-sight');
        const brackets=svg.querySelector('.reticle-brackets');
        const ticks=svg.querySelector('.reticle-ticks');
        const dot=svg.querySelector('.reticle-point');
        const bounds=el.getBoundingClientRect();
        const box=dot.getBoundingClientRect();
        return {
          svgCount:el.querySelectorAll('svg').length,
          circles:el.querySelectorAll('circle, ellipse').length,
          brackets:brackets.getAttribute('d').match(/M/g)?.length,
          ticks:ticks.getAttribute('d').match(/M/g)?.length,
          filledPoint:dot.getAttribute('width')==='3' && dot.getAttribute('height')==='3',
          dotOffset:Math.hypot(box.left+box.width/2-bounds.left-bounds.width/2,
            box.top+box.height/2-bounds.top-bounds.height/2),
          opacity:getComputedStyle(el).opacity,
          pointerEvents:getComputedStyle(el).pointerEvents
        };
      });
      assert.deepEqual([sight.svgCount,sight.circles,sight.brackets,sight.ticks],
        [1,0,4,4],'C-2 must have four corner brackets and four separated sight ticks, no rings');
      assert(sight.filledPoint && sight.dotOffset<=.5,'3-unit target point must be geometrically centered');
      assert.equal(sight.opacity,'0.78','C-2 default mode is visually restrained');
      assert.equal(sight.pointerEvents,'none','reticle must never block map touch gestures');
      assert.equal(await page.locator('.map-tech-grid').count(), 1);
      assert.equal(await page.locator('#layerBtn').count(), 1);
      assert.equal(await page.locator('.position-hud').evaluate(el => getComputedStyle(el,'::before').content !== 'none'), true);
      const scaleShape = await page.locator('#scaleLine').evaluate(el => {
        const s=getComputedStyle(el);
        return {top:s.borderTopStyle,left:s.borderLeftStyle,right:s.borderRightStyle,bottom:s.borderBottomStyle,shadow:s.boxShadow};
      });
      assert(scaleShape.top === 'none' || scaleShape.top === 'hidden' || scaleShape.top === '');
      assert.notEqual(scaleShape.left,'none');
      assert.notEqual(scaleShape.right,'none');
      assert.notEqual(scaleShape.bottom,'none');
      assert.equal(scaleShape.shadow,'none');
      assert.equal(await page.locator('#gpsBtn').evaluate(el => el.classList.contains('inactive-state')), true);
      assert.equal(await page.locator('#followBtn').evaluate(el => el.classList.contains('inactive-state')), true);
      assert.equal(await page.evaluate(() => document.body.classList.contains('theme-nvg-green')), true);
      assert.equal(await page.evaluate(() => getComputedStyle(document.body).getPropertyValue('--bg-base').trim()), '#020904');
      assert.equal(await page.evaluate(() => getComputedStyle(document.body).getPropertyValue('--text-main').trim()), '#22ff66');
      assert.equal(await page.evaluate(() => getComputedStyle(document.body).getPropertyValue('--accent').trim()), '#9de3a4');
      assert.equal(await page.evaluate(() => getComputedStyle(document.body).getPropertyValue('--text-dim').trim()), '#4f9a63');
      assert.equal(await page.evaluate(() => getComputedStyle(document.body).getPropertyValue('--map-filter').includes('hue-rotate(76deg)')), true);
      assert.equal(await page.evaluate(() => getComputedStyle(document.body, '::after').opacity), '0.18');
      await page.waitForTimeout(120);
      const topoTileFilter = await page.locator('.leaflet-tile:not(.road-boost-tiles)').first().evaluate(el => getComputedStyle(el).filter).catch(() => '');
      if (topoTileFilter) assert(topoTileFilter.includes('hue-rotate'));
      assert.equal(await page.evaluate(() => BaselineSites.getRegistered().length), 24);
      assert.equal(await page.locator('.site-map-marker-wrap').count(), 24);
      assert.equal(await page.locator('.marker-registered').count(), 24);
      assert.equal(await page.locator('.reticle').count(), 1);
      assert.equal(await page.evaluate(() => BaselineApp.map.doubleClickZoom.enabled()), true, 'double-click/double-tap map zoom must be enabled');
      const reticleOffset = await page.evaluate(() => {
        const mapBox = document.getElementById('map').getBoundingClientRect();
        const target = document.querySelector('.reticle').getBoundingClientRect();
        return {
          x: (target.left + target.width / 2) - (mapBox.left + mapBox.width / 2),
          y: (target.top + target.height / 2) - (mapBox.top + mapBox.height / 2)
        };
      });
      assert(Math.abs(reticleOffset.x) <= 1 && Math.abs(reticleOffset.y) <= 1, 'reticle must coincide with Leaflet map center including iPhone safe area');
      assert.equal(await page.locator('[class*="corner"]').count(), 0);
      const attributionText = await page.locator('.leaflet-control-attribution').textContent();
      assert.equal(attributionText.includes('Leaflet'), false, 'Leaflet prefix should be removed to reduce clutter');
      assert.equal(attributionText.includes('OpenStreetMap'), true, 'required map attribution must remain');

      // GPS activation contract: first good location centers the map exactly
      // once, future fixes do not hijack map gestures unless Follow is on.
      const gpsBefore=await page.evaluate(()=>{
        const m=BaselineApp.map,c=m.getCenter();
        const backup={
          center:[c.lat,c.lng],
          zoom:m.getZoom(),
          lastFix:BaselineState.state.lastFix,
          geolocationDescriptor:Object.getOwnPropertyDescriptor(navigator,'geolocation')
        };
        window.__gpsTestBackup=backup;
        window.__gpsMock={
          currentId:0,
          watchers:new Map(),
          cleared:[],
          watchPosition(ok,fail,options){
            const id=++this.currentId;
            this.watchers.set(id,{ok,fail,options});
            return id;
          },
          clearWatch(id){this.cleared.push(id);},
          success(lat,lon,id=this.currentId){
            this.watchers.get(id)?.ok({coords:{latitude:lat,longitude:lon,accuracy:6,altitude:30}});
          },
          error(code=1,id=this.currentId){
            this.watchers.get(id)?.fail({code});
          }
        };
        Object.defineProperty(navigator,'geolocation',{
          configurable:true,value:window.__gpsMock
        });
        return {center:backup.center,zoom:backup.zoom};
      });

      await page.locator('#gpsBtn').click();
      assert.equal(await page.evaluate(()=>BaselineState.state.gps.enabled),true);
      assert.equal(await page.locator('#followBtn').getAttribute('aria-pressed'),'false');
      assert.equal(await page.evaluate(()=>BaselineApp.map.getZoom()),gpsBefore.zoom,
        'GPS toggle must wait for the first actual fix before zooming');
      await page.evaluate(()=>window.__gpsMock.success(37.5788,127.004));
      const firstFix=await page.evaluate(()=>{
        const m=BaselineApp.map,c=m.getCenter(),fix=BaselineState.state.gps.fix;
        return {distance:m.distance(c,[fix.lat,fix.lon]),zoom:m.getZoom(),
          follow:BaselineState.state.gps.follow};
      });
      assert(firstFix.distance<4 && firstFix.zoom>=15 && !firstFix.follow,
        'first valid fix should move and zoom to live GPS, without enabling tracking');
      await page.evaluate(()=>window.__gpsMock.success(37.61,127.05));
      const secondFix=await page.evaluate(()=>BaselineApp.map.getCenter());
      assert(Number.isFinite(secondFix.lat) && Number.isFinite(secondFix.lng));
      assert.equal(await page.evaluate(()=>BaselineState.state.gps.fix.lat),37.61);
      assert(await page.evaluate(()=>{
        const m=BaselineApp.map;
        return m.distance(m.getCenter(),[37.5788,127.004])<4;
      }), 'subsequent fixes must not recenter without Follow');

      const oldId=await page.evaluate(()=>window.__gpsMock.currentId);
      await page.locator('#gpsBtn').click();
      assert.equal(await page.evaluate(()=>BaselineState.state.gps.enabled),false);
      const beforeStale=await page.evaluate(()=>{
        const c=BaselineApp.map.getCenter();return [c.lat,c.lng];
      });
      await page.evaluate(id=>window.__gpsMock.success(35.1,129.1,id),oldId);
      assert.equal(await page.evaluate(()=>BaselineState.state.gps.fix),null,
        'GPS off must ignore previously queued watch callbacks');
      assert(await page.evaluate(before=>{
        const m=BaselineApp.map;return m.distance(m.getCenter(),before)<4;
      },beforeStale),'stale callback after OFF must not drag map');

      // If the user starts panning before the first fix, that user intent wins.
      await page.locator('#gpsBtn').click();
      const manualCenter=await page.evaluate(()=>{
        const m=BaselineApp.map;
        m.panTo([37.66,127.13],{animate:false});
        m.fire('dragstart');
        const c=m.getCenter();
        return [c.lat,c.lng];
      });
      await page.evaluate(()=>window.__gpsMock.success(36.1,128.1));
      assert(await page.evaluate(center=>{
        const m=BaselineApp.map;return m.distance(m.getCenter(),center)<4;
      },manualCenter),'dragging while waiting for GPS must cancel automatic recenter');
      await page.locator('#gpsBtn').click();

      // Follow enabled before a new fix must wait for LIVE GPS instead of
      // jumping to the last known location or a TEMP reference.
      await page.locator('#gpsBtn').click();
      const pendingCenter=await page.evaluate(()=>{
        const c=BaselineApp.map.getCenter();return [c.lat,c.lng];
      });
      await page.locator('#followBtn').click();
      assert.equal(await page.locator('#followBtn').getAttribute('aria-pressed'),'true');
      assert(await page.evaluate(center=>{
        const m=BaselineApp.map;return m.distance(m.getCenter(),center)<4;
      },pendingCenter),'Follow should not center on a stale fix while live GPS is pending');
      await page.evaluate(()=>window.__gpsMock.success(37.52,126.91));
      assert(await page.evaluate(()=>{
        const m=BaselineApp.map;return m.distance(m.getCenter(),[37.52,126.91])<4;
      }),'first GPS fix with Follow preenabled should still jump to live location');
      await page.evaluate(()=>window.__gpsMock.success(37.521,126.911));
      await page.waitForFunction(()=>{
        const m=BaselineApp.map;
        return m.distance(m.getCenter(),[37.521,126.911])<4;
      },null,{timeout:3000});
      await page.locator('#gpsBtn').click();

      // A watch permission error must reset GPS state, not leave a pending
      // recenter to be fulfilled by callbacks from the failed watch.
      await page.locator('#gpsBtn').click();
      await page.evaluate(()=>window.__gpsMock.error(1));
      assert.equal(await page.evaluate(()=>BaselineState.state.gps.enabled),false);
      await page.evaluate(()=>{
        const backup=window.__gpsTestBackup;
        if(backup.geolocationDescriptor)
          Object.defineProperty(navigator,'geolocation',backup.geolocationDescriptor);
        else delete navigator.geolocation;
        BaselineState.state.lastFix=backup.lastFix;
        if(backup.lastFix)
          localStorage.setItem('tr_baseline_last_fix_v1',JSON.stringify(backup.lastFix));
        else localStorage.removeItem('tr_baseline_last_fix_v1');
        BaselineApp.map.setView(backup.center,backup.zoom,{animate:false});
        BaselineApp.refresh();
        delete window.__gpsMock;
        delete window.__gpsTestBackup;
      });
      assert.equal(await page.evaluate(()=>BaselineApp.map.getZoom()),gpsBefore.zoom);
      assert.equal(await page.evaluate(()=>BaselineState.state.gps.enabled),false);

      const resources = await page.evaluate(() => performance.getEntriesByType('resource').map(x => x.name));
      assert.equal(resources.some(url => /\/(?:v27|v28|v29|ep-ui|ep-runtime|ep-overlay|ep-plan|ep-mission|ep-surface)/.test(url)), false, 'BASELINE must not load legacy runtime/UI layers');

      await page.waitForFunction(async () => navigator.serviceWorker && (await navigator.serviceWorker.getRegistrations()).length === 1);
      const registrations = await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).map(reg => ({scope:reg.scope,script:reg.active?.scriptURL || ''})));
      assert.equal(registrations.length, 1);
      assert.equal(registrations[0].scope.endsWith('/baseline/'), true, 'BASELINE service worker must be isolated to /baseline/');
      assert.equal(registrations[0].script.endsWith('/baseline/sw.js'), true);
      await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));

      const liteBundleBytes = fs.statSync(path.join(root,'baseline/data/lite-map-osm.js')).size;
      assert(liteBundleBytes < 4_000_000, 'lite vector bundle must remain mobile-sized');
      assert.equal(await page.evaluate(() => BaselineLiteMap.status().dataReady), false, 'lite vectors must not parse during normal online boot');
      assert.equal(await page.evaluate(() => performance.getEntriesByType('resource').some(x => x.name.includes('/baseline/data/lite-map-osm.js'))), false, 'lite vector bundle must be lazy-loaded');
      assert.equal(await page.evaluate(() => BaselineLiteMap.status().requested), 'auto');

      await page.evaluate(() => BaselineLiteMap.setMode('lite'));
      await page.waitForFunction(() => BaselineLiteMap.status().effective === 'lite' && BaselineLiteMap.status().dataReady);
      assert.equal(await page.locator('#mapModeStatus').textContent(), 'MAP · LITE');
      assert.equal(await page.evaluate(() => BaselineApp.map.hasLayer(BaselineLiteMap.terrainLayer)), true);
      assert.equal(await page.evaluate(() => BaselineApp.map.hasLayer(BaselineLiteMap.vectorLayer)), true);
      const liteVectorLayerCount = await page.evaluate(() => BaselineLiteMap.vectorLayer.getLayers().length);
      assert(liteVectorLayerCount > 0 && liteVectorLayerCount <= 8, 'lite vectors should be grouped, not one Leaflet layer per OSM way');
      assert.equal(await page.evaluate(() => BaselineApp.map.hasLayer(BaselineApp.siteLayer)), true, 'operational site overlay must survive base map switch');
      await page.screenshot({ path:`ui-results-baseline/${name}-lite-map.png`, fullPage:true });

      await page.evaluate(() => BaselineLiteMap.setMode('online'));
      await page.waitForFunction(() => BaselineLiteMap.status().effective === 'online');
      assert.equal(await page.locator('#mapModeStatus').textContent(), 'MAP · ONLINE');
      assert.equal(await page.evaluate(() => localStorage.getItem('tr_baseline_map_mode_v1')), 'online', 'chosen online map must persist');
      await page.reload({ waitUntil:'domcontentloaded' });
      await page.waitForFunction(() => window.BaselineApp?.version === 'R0.1-BASELINE' && window.BaselineLiteMap?.status().requested === 'online');
      assert.equal(await page.evaluate(() => BaselineLiteMap.status().effective), 'online', 'reloaded manual ONLINE mode must not reset to AUTO');

      await page.locator('#tempBtn').click();
      let temp = await page.evaluate(() => BaselineState.state.temp);
      assert(temp && Number.isFinite(temp.lat) && Number.isFinite(temp.lon));
      assert.equal(await page.evaluate(() => BaselineState.reference()?.type), 'TEMP');
      assert(await page.locator('#tempBtn').evaluate(el => el.classList.contains('active')));
      assert.equal(await page.locator('.baseline-marker.temp').count(), 1);
      await page.locator('.baseline-marker.temp').click();
      assert.equal(await page.locator('#sheetTitle').textContent(), '임시위치', 'tapping TEMP marker must open position card');
      assert.equal(await page.locator('#tempCopyCoord').count(), 1);
      assert.equal(await page.locator('#tempMoveReticle').count(), 1);
      assert.equal(await page.locator('#tempClear').count(), 1);
      await page.locator('#sheetClose').click();
      await page.evaluate(() => BaselineApp.map.panBy([65,45],{animate:false}));
      const newTempAtCenter=await page.evaluate(() => {
        const c=BaselineApp.map.getCenter();return {lat:c.lat,lon:c.lng};
      });
      await page.locator('#tempBtn').click();
      assert.equal(await page.locator('#sheet').isHidden(),true,
        'TEMP quick button must never open a previous marker card');
      const updatedTemp=await page.evaluate(() => BaselineState.state.temp);
      assert(Math.abs(updatedTemp.lat-newTempAtCenter.lat)<0.000002);
      assert(Math.abs(updatedTemp.lon-newTempAtCenter.lon)<0.000002);
      await page.locator('.baseline-marker.temp').click();
      assert.equal(await page.locator('#sheetTitle').textContent(),'임시위치',
        'tapping TEMP marker must still open its information card');
      // All modal sheets close when the exposed map is tapped.
      await page.locator('#map').click({position:{x:85,y:275}});
      assert.equal(await page.locator('#sheet').isHidden(),true,'map tap must close open sheet');

      // A held finger must use its map pixel, not the reticle/center position.
      const mapTouch = await page.evaluate(() => {
        const box=BaselineApp.map.getContainer().getBoundingClientRect();
        const x=box.left+box.width*.43,y=box.top+box.height*.43;
        const point=BaselineApp.map.containerPointToLatLng([x-box.left,y-box.top]);
        return {x,y,lat:point.lat,lon:point.lng};
      });
      await page.locator('#map').dispatchEvent('pointerdown',{
        pointerId:771,pointerType:'touch',isPrimary:true,button:0,
        clientX:mapTouch.x,clientY:mapTouch.y
      });
      await page.waitForTimeout(720);
      assert.equal(await page.locator('#sheetTitle').textContent(), '위치 정보', 'map press must open coordinate card');
      const cardCoord = await page.locator('.site-detail-grid').textContent();
      assert(cardCoord.includes(mapTouch.lat.toFixed(6)));
      assert(cardCoord.includes(mapTouch.lon.toFixed(6)));
      assert.equal(await page.locator('#mapPointTemp').count(), 1);
      assert.equal(await page.locator('#mapPointCenter').count(), 1);
      assert.equal(await page.locator('#mapPointCopy').count(), 1);
      assert.equal(await page.locator('#mapPointClear').count(), 1);
      assert.equal(await page.locator('.map-selected-icon').count(), 1,'selected map point must have its own marker');
      assert.equal(await page.locator('.map-selected-caption').textContent(),'선택');
      assert.equal(await page.locator('.reticle').evaluate(el=>getComputedStyle(el).opacity),'1',
        'map-point selection must boost C-2 contrast without changing its geometry');
      const selectionCoords=await page.evaluate(() => {
        const item=document.querySelector('.map-selected-icon');
        const box=item.getBoundingClientRect();
        const mapBox=BaselineApp.map.getContainer().getBoundingClientRect();
        return {x:box.left+box.width/2,y:box.top+box.height/2,
          markerIsVisible:getComputedStyle(item).display!=='none',
          mapWidth:mapBox.width};
      });
      assert(Math.hypot(selectionCoords.x-mapTouch.x,selectionCoords.y-mapTouch.y)<3,'selection marker must be drawn at held pixel');
      await page.locator('#sheetClose').click();
      assert.equal(await page.locator('.map-selected-icon').count(),0,
        'selected marker must be removed on card dismissal');
      assert.equal(await page.locator('.reticle').evaluate(el=>getComputedStyle(el).opacity),'0.78',
        'dismissing a selected point must restore the C-2 default contrast');

      await page.locator('#map').dispatchEvent('pointerup',{
        pointerId:771,pointerType:'touch',isPrimary:true,button:0,
        clientX:mapTouch.x,clientY:mapTouch.y
      });
      await page.locator('#map').dispatchEvent('pointerdown',{
        pointerId:773,pointerType:'touch',isPrimary:true,button:0,
        clientX:mapTouch.x,clientY:mapTouch.y
      });
      await page.waitForTimeout(700);
      assert.equal(await page.locator('.map-selected-icon').count(),1);
      await page.locator('#mapPointTemp').click();
      assert.equal(await page.locator('.map-selected-icon').count(),0,'saving as TEMP clears ephemeral selection');
      assert.equal(await page.locator('#sheet').isHidden(), true);
      const pinned=await page.evaluate(() => BaselineState.state.temp);
      assert(Math.abs(pinned.lat-mapTouch.lat)<0.000002 && Math.abs(pinned.lon-mapTouch.lon)<0.000002);
      await page.locator('#map').dispatchEvent('pointerup',{
        pointerId:773,pointerType:'touch',isPrimary:true,button:0,
        clientX:mapTouch.x,clientY:mapTouch.y
      });
      await page.locator('#map').dispatchEvent('pointerdown',{
        pointerId:772,pointerType:'touch',isPrimary:true,button:0,
        clientX:mapTouch.x,clientY:mapTouch.y
      });
      await page.locator('#map').dispatchEvent('pointermove',{
        pointerId:772,pointerType:'touch',isPrimary:true,button:0,
        clientX:mapTouch.x+45,clientY:mapTouch.y
      });
      await page.waitForTimeout(690);
      assert.equal(await page.locator('#sheet').isHidden(), true, 'drag must cancel map long press');
      await page.locator('#map').dispatchEvent('pointerup',{
        pointerId:772,pointerType:'touch',isPrimary:true,button:0,
        clientX:mapTouch.x+45,clientY:mapTouch.y
      });

      // Mobile taps slightly slower than Leaflet's native 200 ms pair
      // must still zoom once, and only once.
      const freeTapPoint=await page.evaluate(() => {
        const box=BaselineApp.map.getContainer().getBoundingClientRect();
        const positions=[[.7,.48],[.25,.66],[.72,.72],[.3,.31]];
        for(const [fx,fy] of positions){
          const x=box.left+box.width*fx,y=box.top+box.height*fy;
          const hit=document.elementFromPoint(x,y);
          if(hit && !hit.closest('.leaflet-marker-icon,.leaflet-control,button,a,.sheet'))return {x,y};
        }
        throw new Error('No map-only point for double-tap test');
      });
      const doubleTapAnchor=await page.evaluate(({x,y})=>{
        const map=BaselineApp.map;
        const rect=map.getContainer().getBoundingClientRect();
        const latlng=map.containerPointToLatLng([x-rect.left,y-rect.top]);
        return {x,y,lat:latlng.lat,lng:latlng.lng};
      },freeTapPoint);
      const beforeDoubleTapZoom=await page.evaluate(() => BaselineApp.map.getZoom());
      await page.touchscreen.tap(freeTapPoint.x,freeTapPoint.y);
      await page.waitForTimeout(250);
      await page.touchscreen.tap(freeTapPoint.x,freeTapPoint.y);
      await page.waitForTimeout(280);
      const afterDoubleTapZoom=await page.evaluate(() => BaselineApp.map.getZoom());
      assert.equal(afterDoubleTapZoom,beforeDoubleTapZoom+1,'double tap must zoom exactly one step');
      const anchorDistance=await page.evaluate(({x,y,lat,lng})=>{
        const map=BaselineApp.map;
        const actual=map.latLngToContainerPoint([lat,lng]);
        const rect=map.getContainer().getBoundingClientRect();
        return Math.hypot(actual.x-(x-rect.left),actual.y-(y-rect.top));
      },doubleTapAnchor);
      assert(anchorDistance < 5,'double tap must preserve its geographic anchor (no teleport)');

      await page.evaluate(() => {
        const t = BaselineState.state.temp;
        BaselineState.setLastFix({ lat: t.lat + 0.01, lon: t.lon + 0.01, at: Date.now() + 5000 });
      });
      assert.equal(await page.evaluate(() => BaselineState.reference()?.type), 'LAST', 'GPS-off reference must use newest TEMP/LAST timestamp');

      await page.evaluate(() => {
        BaselineState.setGpsEnabled(true);
        BaselineState.setGpsFix({ lat: 37.57, lon: 126.98, accuracy: 7 });
      });
      assert.equal(await page.evaluate(() => BaselineState.reference()?.type), 'GPS', 'live GPS must own reference while enabled');

      await page.evaluate(() => {
        BaselineState.setGpsEnabled(false);
        BaselineState.setTemp({ lat: 37.41, lon: 127.01 });
        BaselineState.setFollow(true);
        BaselineApp.map.setView([35.0, 129.0], 11, { animate:false });
      });
      await page.waitForTimeout(20);
      assert.equal(await page.locator('.marker-gps.marker-last').count(), 1, 'GPS off must keep LAST FIX marker');
      assert.equal(await page.locator('#gpsBtn').evaluate(el => el.classList.contains('inactive-state')), true);
      const savedTemp = await page.evaluate(() => BaselineState.state.temp);
      await page.locator('#tempBtn').dispatchEvent('pointerdown', { pointerType:'touch', pointerId:1, isPrimary:true });
      await page.waitForTimeout(620);
      await page.locator('#tempBtn').dispatchEvent('pointerup', { pointerType:'touch', pointerId:1, isPrimary:true });
      await page.waitForTimeout(150);
      const center = await page.evaluate(() => {
        const c = BaselineApp.map.getCenter();
        return { lat:c.lat, lon:c.lng };
      });
      assert(Math.abs(center.lat - savedTemp.lat) < 0.002 && Math.abs(center.lon - savedTemp.lon) < 0.002, 'TEMP hold must move map to saved TEMP');
      assert.equal(await page.evaluate(() => BaselineState.state.gps.follow), false, 'TEMP hold must suspend follow');
      assert.equal(await page.locator('#followBtn').evaluate(el => el.classList.contains('inactive-state')), true);
      await page.waitForTimeout(40);
      const topCoords = await page.evaluate(() => ({
        pos:document.getElementById('positionCoord')?.textContent || '',
        ret:document.getElementById('reticleCoord')?.textContent || ''
      }));
      assert(/^POS\s{2}/.test(topCoords.pos));
      assert(/^RET\s{2}/.test(topCoords.ret));
      assert(/\d{1,2}[C-X]\s[A-Z]{2}\s\d{5}\s\d{5}/.test(topCoords.ret), 'reticle MGRS must be grouped for readability');

      await page.locator('.bottom-nav button[data-panel="sites"]').click();
      assert.equal(await page.locator('#sheetTitle').textContent(), '거점');
      assert.equal(await page.locator('[data-site-filter]').count(), 3);
      assert.equal(await page.locator('.site-row').count(), 24);
      await page.screenshot({ path:`ui-results-baseline/${name}-sites.png`, fullPage:true });
      const firstRegisteredId=await page.locator('.site-row').first().getAttribute('data-site-id');
      await page.locator('.site-row').first().click();
      assert.equal(await page.locator('#sheetTitle').textContent(), '거점 정보');
      assert.equal(await page.locator('.reticle').evaluate(el=>getComputedStyle(el).opacity),'1',
        'opening a site must boost C-2 contrast');
      assert(await page.locator('#siteMapGo').isVisible());
      assert.equal(await page.locator('#siteSecureToggle').textContent(), '개척 완료');
      await page.locator('#siteSecureToggle').click();
      assert.equal(await page.locator('#siteSecureToggle').textContent(), '개척 취소');
      assert.equal(await page.evaluate(() => BaselineSites.getSecured().length), 1);

      // Regression: a registered site sent to the map must sit beneath the
      // visual sight center and the Leaflet projection at four viewport sizes.
      await page.locator('#siteMapGo').click();
      await page.waitForFunction(id=>{
        const c=BaselineApp.map.getCenter(),s=BaselineSites.find(id);
        return Math.abs(c.lat-s.coords[0])<0.000003 && Math.abs(c.lng-s.coords[1])<0.000003;
      },firstRegisteredId);
      assert.equal(await page.locator('.reticle').evaluate(el=>getComputedStyle(el).opacity),'0.78',
        'returning to the map closes the selected-site emphasis');
      const measureSiteReticle=async(label,siteId=firstRegisteredId)=>{
        const metrics=await page.evaluate(id=>{
          const site=BaselineSites.find(id),map=BaselineApp.map,
            bounds=map.getContainer().getBoundingClientRect(),
            cross=document.querySelector('.reticle').getBoundingClientRect(),
            reticle=[cross.left+cross.width/2,cross.top+cross.height/2],
            center=map.getCenter(),
            projected=map.latLngToContainerPoint(site.coords),
            expected=[bounds.left+projected.x,bounds.top+projected.y],
            marker=BaselineApp.siteLayer.getLayers().find(layer=>
              typeof layer.getLatLng==='function' &&
              Math.abs(layer.getLatLng().lat-site.coords[0])<1e-8 &&
              Math.abs(layer.getLatLng().lng-site.coords[1])<1e-8);
          const icon=marker?.getElement()?.querySelector('svg.marker-symbol')?.getBoundingClientRect();
          const iconCenter=icon?[icon.left+icon.width/2,icon.top+icon.height/2]:null;
          const aim=map.containerPointToLatLng([reticle[0]-bounds.left,reticle[1]-bounds.top]);
          return {
            dProjection:Math.hypot(reticle[0]-expected[0],reticle[1]-expected[1]),
            dMarker:iconCenter?Math.hypot(reticle[0]-iconCenter[0],reticle[1]-iconCenter[1]):9999,
            dGeo:map.distance(aim,site.coords),
            dCenter:map.distance(center,site.coords),
            mapWidth:map.getSize().x,actualWidth:bounds.width,
            mapHeight:map.getSize().y,actualHeight:bounds.height,
            site:[...site.coords],reticle,iconCenter,expected
          };
        },siteId);
        console.log(name+' '+label+' site/reticle alignment: '+JSON.stringify(metrics));
        assert(metrics.dCenter<2,label+' map center must match selected site');
        assert(metrics.dGeo<2,label+' reticle geography must match selected site');
        assert(metrics.dProjection<=2,label+' map projection must meet reticle');
        assert(metrics.dMarker<=2,label+' registered SVG marker center must meet reticle');
        assert(Math.abs(metrics.mapWidth-metrics.actualWidth)<2 &&
          Math.abs(metrics.mapHeight-metrics.actualHeight)<2,
          label+' Leaflet pixel viewport must match CSS viewport');
      };
      for(const spec of [
        {label:'phone-portrait',width:390,height:844},
        {label:'phone-landscape',width:844,height:390},
        {label:'tablet-portrait',width:820,height:1100},
        {label:'tablet-landscape',width:1180,height:820}
      ]){
        await page.setViewportSize({width:spec.width,height:spec.height});
        // Do NOT manually invalidate: WebKit may deliver its ResizeObserver
        // asynchronously after setViewportSize resolves. Wait for the app to
        // reconcile Leaflet size and CSS viewport (not merely a timer).
        await page.waitForFunction(target=>{
          const map=BaselineApp.map,rect=map.getContainer().getBoundingClientRect();
          const size=map.getSize();
          return Math.abs(rect.width-target.width)<2 &&
            Math.abs(size.x-rect.width)<2 &&
            Math.abs(size.y-rect.height)<2;
        },spec,{timeout:4000});
        await page.waitForTimeout(100);
        await measureSiteReticle(spec.label);
        await page.screenshot({path:`ui-results-baseline/${name}-site-sight-${spec.label}.png`,fullPage:true});
      }
      await page.setViewportSize({width:390,height:844});
      await page.waitForTimeout(240);
      // Simulate an app panel altering map height with NO window resize event.
      await page.evaluate(()=>document.documentElement.style.setProperty('--bottom-h','92px'));
      await page.waitForTimeout(260);
      await measureSiteReticle('css-only-map-resize');
      await page.evaluate(()=>document.documentElement.style.removeProperty('--bottom-h'));
      await page.waitForTimeout(260);
      await measureSiteReticle('restored-portrait');

      await page.locator('.bottom-nav button[data-panel="sites"]').click();
      await page.locator('[data-site-filter="secured"]').click();
      assert.equal(await page.locator('.site-row').count(), 1);
      await page.locator('#sheetClose').click();

      await page.locator('.bottom-nav button[data-panel="explore"]').click();
      assert.equal(await page.locator('#sheetTitle').textContent(), '탐색');
      assert.equal(await page.locator('[data-explore-radius]').count(), 4);
      assert.equal(await page.locator('#exploreRegisteredBtn').count(), 1);
      assert.equal(await page.locator('#exploreWildBtn').count(), 1);
      assert.equal(await page.evaluate(()=>BaselineApp.topoLayer.options.keepBuffer),1,
        'iPad tiles must not preload three unseen rows in each direction');
      assert.equal(await page.evaluate(()=>BaselineApp.roadBoostLayer.options.keepBuffer),0,
        'secondary road tiles must stay on-screen only');
      assert.equal(await page.evaluate(()=>BaselineApp.topoLayer.options.updateWhenIdle),true);

      const checkExploreRange=async(label,km)=>{
        const state=await page.evaluate(()=>{
          const map=BaselineApp.map;
          let circle=null;
          map.eachLayer(layer=>{
            if(layer instanceof L.Circle && layer.options.className==='explore-range-circle')circle=layer;
          });
          const path=circle?.getElement();
          const m=map.getContainer().getBoundingClientRect();
          const pathBox=path?.getBoundingClientRect();
          const screenCenter=circle?map.latLngToContainerPoint(circle.getLatLng()):null;
          return {
            count:document.querySelectorAll('path.explore-range-circle').length,
            radius:circle?.getRadius(),center:circle?[circle.getLatLng().lat,circle.getLatLng().lng]:null,
            px:screenCenter?{x:screenCenter.x,y:screenCenter.y}:null,
            hasStroke:path?getComputedStyle(path).strokeWidth:'0px',
            intersects:pathBox ? pathBox.right>m.left && pathBox.left<m.right
              && pathBox.bottom>m.top && pathBox.top<m.bottom : false,
            zoom:map.getZoom(),mapSize:[map.getSize().x,map.getSize().y],
            actualSize:[m.width,m.height]
          };
        });
        console.log(name+' '+label+' exploration preview: '+JSON.stringify(state));
        assert.equal(state.count,1,label+' range SVG ring should actually exist in the DOM');
        assert.equal(state.radius,km*1000,label+' ring must use the selected physical km range');
        assert(state.intersects,label+' ring must overlap the real map viewport');
        assert(state.px.x>=0 && state.px.x<=state.mapSize[0] &&
          state.px.y>=0 && state.px.y<=state.mapSize[1],
          label+' range center must be visible');
        assert(parseFloat(state.hasStroke)>=2,label+' ring must have a legible outline');
        assert.equal(state.mapSize[0],state.actualSize[0]);
        assert.equal(state.mapSize[1],state.actualSize[1]);
      };

      for(const spec of [
        {label:'phone-portrait',width:390,height:844},
        {label:'phone-landscape',width:844,height:390},
        {label:'tablet-portrait',width:820,height:1100},
        {label:'tablet-landscape',width:1180,height:820}
      ]){
        await page.setViewportSize({width:spec.width,height:spec.height});
        await page.waitForTimeout(180);
        await page.locator('[data-explore-radius="30"]').click();
        await checkExploreRange(spec.label+'-30km',30);
        await page.locator('[data-explore-radius="150"]').click();
        await checkExploreRange(spec.label+'-150km',150);
        assert.equal(await page.locator('#exploreRegisteredBtn').count(),1,
          'changing exploration radius must not rebuild/discard the action panel');
      }
      await page.setViewportSize({width:390,height:844});
      await page.waitForTimeout(220);

      // No TEMP/GPS/LAST still gives an honest and usable RET radius preview.
      const priorReference=await page.evaluate(()=>{
        const state=BaselineState.state;
        const stored={temp:state.temp,lastFix:state.lastFix};
        state.lastFix=null;
        BaselineState.clearTemp();
        return stored;
      });
      await page.locator('#sheetClose').click();
      await page.locator('.bottom-nav button[data-panel="explore"]').click();
      assert((await page.locator('#exploreRefText').textContent()).startsWith('RET ·'),
        'without GPS or TEMP radius search must explicitly use the map sight');
      await page.locator('[data-explore-radius="30"]').click();
      await checkExploreRange('no-GPS-RET-anchor',30);
      assert.equal(await page.evaluate(()=>BaselineState.reference()),null,
        'range preview must not impersonate a valid GPS fix');
      await page.locator('[data-explore-radius="all"]').click();
      assert.equal(await page.locator('path.explore-range-circle').count(),0,
        'ALL selection removes the bounded range without retaining an orphan overlay');
      await page.evaluate(({temp,lastFix})=>{
        BaselineState.state.lastFix=lastFix;
        if(temp)BaselineState.setTemp(temp);
      },priorReference);
      assert.equal(await page.evaluate(()=>BaselineState.reference()?.type),'TEMP');

      // Both random registered and new random-coordinate discoveries move
      // the underlying map before opening the information sheet.
      await page.locator('[data-explore-radius="all"]').click();
      await page.locator('#exploreRegisteredBtn').click();
      assert.equal(await page.locator('#sheetTitle').textContent(), '거점 정보');
      const registeredFocus=await page.evaluate(() => {
        const center=BaselineApp.map.getCenter();
        return BaselineSites.getRegistered().some(site=>
          Math.abs(site.coords[0]-center.lat)<0.00002 && Math.abs(site.coords[1]-center.lng)<0.00002);
      });
      assert.equal(registeredFocus,true,'registered lottery must center its selected site');
      await page.locator('#sheetClose').click();
      await page.locator('.bottom-nav button[data-panel="explore"]').click();
      await page.locator('[data-explore-radius="30"]').click();
      assert(await page.locator('[data-explore-radius="30"]').evaluate(el => el.classList.contains('active')));
      await page.evaluate(() => BaselineState.setTemp({lat:37.4267,lon:127.0544}));
      await page.waitForTimeout(60);
      assert.equal(await page.locator('.leaflet-interactive').count() > 0, true);
      const beforeWild = await page.evaluate(() => BaselineSites.getUserSites().length);
      await page.locator('#exploreWildBtn').click();
      assert.equal(await page.locator('#sheetTitle').textContent(), '거점 정보');
      assert.equal(await page.locator('.site-detail-grid').textContent().then(t => t.includes('미개척')), true);
      assert.equal(await page.evaluate(() => BaselineSites.getUserSites().length), beforeWild + 1);
      assert.equal(await page.locator('.site-map-marker-wrap').count(), 25);
      const wildFocus=await page.evaluate(() => {
        const site=BaselineSites.getUserSites()[0];
        const center=BaselineApp.map.getCenter();
        return Math.abs(site.coords[0]-center.lat)<0.00002 && Math.abs(site.coords[1]-center.lng)<0.00002;
      });
      assert.equal(wildFocus,true,'generated random coordinates must recenter map');
      await page.locator('#sheetClose').click();

      await page.locator('.bottom-nav button[data-panel="sites"]').click();
      await page.locator('[data-site-filter="mine"]').click();
      assert.equal(await page.locator('.site-row').count(), 1);
      await page.locator('#sheetClose').click();

      // User site creation: location first, then form, then management.
      const beforeManualSites = await page.evaluate(() => BaselineSites.getUserSites().length);
      await page.locator('.bottom-nav button[data-panel="sites"]').click();
      await page.locator('#siteAddBtn').click();
      assert.equal(await page.locator('#sheetTitle').textContent(), '거점 추가');
      await page.locator('#siteAddCoord').fill('37.55123, 126.98876');
      await page.locator('#siteAddCoordGo').click();
      assert.equal(await page.locator('#sheet').isHidden(), true);
      assert.equal(await page.locator('#sitePlacementBar').isVisible(), true);
      const placementCenter = await page.evaluate(() => {
        const c = BaselineApp.map.getCenter();
        return [c.lat,c.lng];
      });
      assert(Math.abs(placementCenter[0]-37.55123) < 0.002);
      assert(Math.abs(placementCenter[1]-126.98876) < 0.002);
      await page.locator('#sitePlacementConfirm').click();
      assert.equal(await page.locator('#sheetTitle').textContent(), '거점 등록');
      await page.locator('#siteFormName').fill('테스트 관측점');
      await page.locator('#siteFormCat').fill('관측');
      await page.locator('#siteFormMemo').fill('BASELINE 사용자 거점 테스트');
      await page.locator('#siteFormSave').click();
      assert.equal(await page.locator('#sheetTitle').textContent(), '거점 정보');
      assert.equal(await page.evaluate(() => BaselineSites.getUserSites().length), beforeManualSites + 1);
      assert.equal(await page.locator('#siteEditBtn').count(), 1);
      assert.equal(await page.locator('#siteDeleteBtn').count(), 1);
      assert.equal(await page.locator('#siteDestinationSet').count(), 1);

      await page.locator('#siteEditBtn').click();
      assert.equal(await page.locator('#sheetTitle').textContent(), '거점 수정');
      await page.locator('#siteFormName').fill('테스트 거점 수정');
      await page.locator('#siteFormSave').click();
      assert.equal(await page.locator('.site-detail-head strong').textContent(), '테스트 거점 수정');
      const manualSiteId = await page.evaluate(() => BaselineSites.getUserSites().find(s => s.name === '테스트 거점 수정')?.id);
      assert(manualSiteId);

      await page.locator('#siteDestinationSet').click();
      assert.equal(await page.locator('#sheetTitle').textContent(), '계획 편집');
      assert.equal(await page.evaluate(() => BaselineNavigationUI.getDraft().destination?.name), '테스트 거점 수정');
      await page.locator('#sheetClose').click();

      await page.locator('.bottom-nav button[data-panel="sites"]').click();
      await page.locator('[data-site-filter="mine"]').click();
      await page.locator('.site-row', { hasText:'테스트 거점 수정' }).click();
      page.once('dialog', dialog => dialog.accept());
      await page.locator('#siteDeleteBtn').click();
      assert.equal(await page.evaluate(() => BaselineSites.getUserSites().length), beforeManualSites);
      await page.screenshot({ path:`ui-results-baseline/${name}-user-sites.png`, fullPage:true });
      await page.locator('#sheetClose').click();

      // Unified PLAN + NAVIGATION vertical flow.
      await page.locator('.bottom-nav button[data-panel="plans"]').click();
      assert.equal(await page.locator('#sheetTitle').textContent(), '계획');
      assert.equal(await page.locator('#planNewBtn').count(), 1);
      await page.locator('#planNewBtn').click();
      assert.equal(await page.locator('#sheetTitle').textContent(), '계획 편집');
      const planColors=await page.evaluate(()=>{
        const color=selector=>getComputedStyle(document.querySelector(selector)).color;
        return {
          nameLabel:color('.plan-name span'),
          pointLabel:color('.plan-route-row > span'),
          addVia:color('.plan-add-via')
        };
      });
      for(const [part,color] of Object.entries(planColors)){
        assert.equal(color,'rgb(185, 231, 194)',
          'PLAN '+part+' text must have clearly readable contrast');
      }
      assert.equal(await page.locator('[data-edit-point="START"]').count(), 1);
      assert.equal(await page.locator('[data-edit-point="DEST"]').count(), 1);

      assert.equal(await page.evaluate(() => BaselineNavigationUI.getDraft().start?.source), 'TEMP');
      await page.locator('#planNameInput').fill('BASELINE TEST PLAN');
      await page.locator('[data-edit-point="DEST"]').click();
      assert.equal(await page.locator('#sheetTitle').textContent(), '목적지 선택');
      assert.equal(await page.locator('.point-picker-grid span').first().evaluate(el=>getComputedStyle(el).color),
        'rgb(185, 231, 194)','destination picker secondary labels must remain legible');
      assert.equal(await page.locator('#pointAddressInput').count(), 1);
      await page.locator('#pointRandomRegistered').click();
      assert.equal(await page.locator('#sheetTitle').textContent(), '계획 편집');
      const planRegisteredFocused=await page.evaluate(() => {
        const site=BaselineNavigationUI.getDraft().destination;
        const center=BaselineApp.map.getCenter();
        return Math.abs(site.coords[0]-center.lat)<0.00002 && Math.abs(site.coords[1]-center.lng)<0.00002;
      });
      assert.equal(planRegisteredFocused,true,'random PLAN registered destination must recenter map');
      await page.locator('[data-edit-point="DEST"]').click();
      await page.locator('#pointRandomWild').click();
      const planWildFocused=await page.evaluate(() => {
        const site=BaselineNavigationUI.getDraft().destination;
        const center=BaselineApp.map.getCenter();
        return Math.abs(site.coords[0]-center.lat)<0.00002 && Math.abs(site.coords[1]-center.lng)<0.00002;
      });
      assert.equal(planWildFocused,true,'random PLAN coordinate destination must recenter map');
      const randomPlanSiteId=await page.evaluate(() => BaselineSites.getUserSites()[0]?.id);
      await page.locator('[data-edit-point="DEST"]').click();
      await page.locator('#pointAddressInput').fill('서울시청');
      await page.locator('#pointAddressSearch').click();
      await page.locator('[data-address-result="0"]').click();
      assert.equal(await page.locator('#sheetTitle').textContent(), '계획 편집');
      assert.equal(await page.evaluate(() => BaselineNavigationUI.getDraft().destination?.source), 'ADDRESS');
      await page.evaluate(id => BaselineSites.removeUserSite(id), randomPlanSiteId);

      await page.locator('#planAddVia').click();
      assert.equal(await page.locator('#sheetTitle').textContent(), '경유지 선택');
      await page.locator('#pointSiteSelect').selectOption({ index: 1 });
      await page.locator('#pointSiteUse').click();
      assert.equal(await page.locator('#sheetTitle').textContent(), '계획 편집');
      assert.equal(await page.locator('[data-edit-point="VIA"]').count(), 1);

      await page.locator('#planEditorSave').click();
      assert.equal(await page.evaluate(() => BaselinePlanStore.list().length), 1);
      await page.locator('#planEditorConfirm').click();
      assert.equal(await page.locator('#sheet').isHidden(), true);
      assert.equal(await page.locator('#navRouteSummary').isVisible(), true);
      assert.equal(await page.locator('#navigationHud').isVisible(), true);
      assert.equal(await page.locator('.reticle').evaluate(el=>getComputedStyle(el).opacity),'1',
        'active PLAN/NAV must boost C-2 contrast');
      const navLegibility=await page.evaluate(() => {
        const hud=document.getElementById('navigationHud');
        const pos=document.getElementById('positionHud');
        const summary=document.getElementById('navRouteSummary');
        const css=getComputedStyle(hud);
        const posShade=getComputedStyle(pos,'::before');
        const distanceValue=getComputedStyle(document.getElementById('navDistanceValue'));
        return {hudBackground:css.backgroundColor,mainBackdrop:posShade.backgroundColor,
          font:parseFloat(distanceValue.fontSize),weight:parseFloat(distanceValue.fontWeight),
          noOverlap:summary.getBoundingClientRect().top>=pos.getBoundingClientRect().bottom-2};
      });
      assert(navLegibility.font>=20 && navLegibility.weight<=700,
        'PLAN numeric telemetry must use clear but moderate typographic weight');
      assert.equal(navLegibility.hudBackground,'rgba(0, 0, 0, 0)',
        'only main POS/RET HUD can have a tinted backdrop');
      assert.notEqual(navLegibility.mainBackdrop,'rgba(0, 0, 0, 0)',
        'POS/RET backdrop must remain visible');
      assert(navLegibility.noOverlap,'navigation route HUD must not obscure POS telemetry');
      const gaugeReadouts=await page.evaluate(() => {
        const plan=BaselineNavigationUI.getDraft();
        const ref=BaselineState.reference();
        const bundle=BaselineNavigationCore.bearingBundle([ref.lat,ref.lon],plan.destination.coords);
        return {
          bundle,
          distance:document.getElementById('navDistanceValue').textContent,
          unit:document.getElementById('navDistanceUnit').textContent,
          grid:document.getElementById('navGridBearing').textContent,
          mag:document.getElementById('navMagBearing').textContent,
          gridRotation:document.getElementById('navGridNeedle').getAttribute('transform'),
          magRotation:document.getElementById('navMagNeedle').getAttribute('transform')
        };
      });
      assert.equal(gaugeReadouts.grid, String(Math.round(gaugeReadouts.bundle.gridBearing)%360).padStart(3,'0')+'°');
      assert.equal(gaugeReadouts.mag, String(Math.round(gaugeReadouts.bundle.magneticBearing)%360).padStart(3,'0')+'°');
      const needleAngle=raw=>Number(raw.slice(raw.indexOf('(')+1).split(' ')[0]);
      const delta=(actual,expected)=>Math.abs((actual-expected+540)%360-180);
      assert(delta(needleAngle(gaugeReadouts.gridRotation),gaugeReadouts.bundle.gridBearing)<0.1,
        'GRID instrument needle must represent its real calculated angle');
      assert(delta(needleAngle(gaugeReadouts.magRotation),gaugeReadouts.bundle.magneticBearing)<0.1,
        'MAG instrument needle must represent its real calculated angle');

      assert.equal(await page.locator('#navNowMetric').textContent().then(t => t.includes('자북')), true);
      assert.equal(await page.locator('#navStartMetric').textContent().then(t => t.includes('도북')), true);
      assert.equal(await page.locator('#navDeclination').textContent().then(t => t.includes('도자각') && t.includes('WMM2025')), true);
      assert.equal(await page.locator('#navNextBlock').count(), 0);
      assert.equal(await page.evaluate(() => Number.isFinite(BaselineNavigationCore.bearingBundle([37.5,127],[37.6,127.1]).magneticBearing)), true);
      const seoulDeclination = await page.evaluate(() => BaselineNavigationCore.wmmField(37.5665,126.9780,0,new Date('2026-10-07T00:00:00Z')).declination);
      assert(seoulDeclination < -7 && seoulDeclination > -11);
      const seoulBundle = await page.evaluate(() => BaselineNavigationCore.bearingBundle(
        [37.5665,126.9780],
        [37.6665,127.0780],
        {date:new Date('2026-10-07T00:00:00Z')}
      ));
      assert(Number.isFinite(seoulBundle.gridMagneticAngle));
      assert(seoulBundle.gridMagneticAngle < -5 && seoulBundle.gridMagneticAngle > -9, 'Seoul grid-magnetic angle should be westward around 6-8°');
      assert.equal(await page.locator('#navDeclination').textContent().then(t => /도자각 W \d+\.\d°/.test(t)), true);
      assert.equal(await page.locator('.site-map-marker-wrap').first().evaluate(el => getComputedStyle(el).display), 'none', 'site markers must hide in plan mode');
      assert.equal(await page.locator('.route-start-marker').count(), 1);
      assert.equal(await page.locator('.route-end-marker').count(), 1);
      assert.equal(await page.locator('[data-nav-action="CLOSE"]').count(), 1);
      await page.screenshot({ path:`ui-results-baseline/${name}-navigation-ready.png`, fullPage:true });

      // Verify all four viewport families while PLAN is active. A rotation
      // must not relocate the geographic center or discard the route state.
      const originalCenter=await page.evaluate(() => {
        const c=BaselineApp.map.getCenter();return [c.lat,c.lng];
      });
      for(const spec of [
        {label:'phone-portrait',width:390,height:844,columns:1},
        {label:'phone-landscape',width:844,height:390,columns:2},
        {label:'tablet-portrait',width:820,height:1100,columns:1},
        {label:'tablet-landscape',width:1180,height:820,columns:1}
      ]){
        await page.setViewportSize({width:spec.width,height:spec.height});
        await page.waitForTimeout(110);
        await page.evaluate(() => BaselineApp.map.invalidateSize({animate:false}));
        const responsive=await page.evaluate(() => {
          const r=id=>document.getElementById(id).getBoundingClientRect();
          const pos=r('positionHud'),nav=r('navigationHud'),
            summary=r('navRouteSummary'),quick=r('tempBtn'),controls=r('navSessionControls'),
            ret=document.querySelector('.reticle').getBoundingClientRect(),mapBox=r('map');
          const all=[...document.querySelectorAll('.quick-btn')].map(x=>x.getBoundingClientRect());
          const columns=new Set(all.map(x=>Math.round(x.left))).size;
          const c=BaselineApp.map.getCenter();
          return {
            pos:{right:pos.right,bottom:pos.bottom},
            nav:{right:nav.right,bottom:nav.bottom,top:nav.top},
            summary:{top:summary.top},
            quick:{left:quick.left,bottom:quick.bottom},
            controls:{top:controls.top},
            columns,
            retCenter:[ret.left+ret.width/2,ret.top+ret.height/2],
            mapCenter:[mapBox.left+mapBox.width/2,mapBox.top+mapBox.height/2],
            lat:c.lat,lon:c.lng,
            lastMetric:getComputedStyle(document.getElementById('navGridBearing')).fontSize
          };
        });
        assert.equal(responsive.columns,spec.columns,spec.label+' quick controls layout');
        assert(responsive.pos.right<spec.width-30,spec.label+' POS telemetry must fit');
        assert(responsive.nav.right<responsive.quick.left-6,spec.label+' HUD must clear quick controls');
        assert(responsive.nav.bottom<=responsive.controls.top-3,spec.label+' HUD must not cover actions');
        assert(responsive.summary.top>=responsive.pos.bottom-2,spec.label+' route label must clear POS');
        assert(Math.abs(responsive.retCenter[0]-responsive.mapCenter[0])<=1 &&
          Math.abs(responsive.retCenter[1]-responsive.mapCenter[1])<=1,
          spec.label+' reticle must stay at map center');
        assert(Math.abs(responsive.lat-originalCenter[0])<0.00005 &&
          Math.abs(responsive.lon-originalCenter[1])<0.00005,
          spec.label+' resizing must preserve reference geographic center');
        assert.equal(await page.evaluate(()=>BaselineNavigationUI.getDraft()?.destination!=null),true);
        await page.screenshot({path:`ui-results-baseline/${name}-instrument-${spec.label}.png`,fullPage:true});
        if(spec.label==='tablet-landscape'){
          await page.locator('#navRouteSummary').click();
          const side=await page.locator('#sheet').boundingBox();
          assert(side.x>spec.width*.5,'tablet landscape plan editor must use right drawer');
          assert(side.x+side.width<spec.width-55,'right drawer must leave quick equipment keys exposed');
          await page.locator('#sheetClose').click();
        }
      }
      await page.setViewportSize({width:390,height:844});
      await page.evaluate(() => BaselineApp.map.invalidateSize({animate:false}));

      await page.locator('[data-nav-action="CLOSE"]').click();
      assert.equal(await page.locator('#navRouteSummary').isHidden(), true);
      assert.equal(await page.locator('.reticle').evaluate(el=>getComputedStyle(el).opacity),'0.78',
        'closing PLAN must restore default sight contrast');
      assert.notEqual(await page.locator('.site-map-marker-wrap').first().evaluate(el => getComputedStyle(el).display), 'none', 'site markers must return when plan view closes');
      await page.locator('.bottom-nav button[data-panel="plans"]').click();
      assert.equal(await page.locator('#planContinueBtn').count(), 1);
      await page.locator('#planContinueBtn').click();
      assert.equal(await page.locator('#navRouteSummary').isVisible(), true);
      assert.equal(await page.locator('.site-map-marker-wrap').first().evaluate(el => getComputedStyle(el).display), 'none');

      // Drawing: one finger draws. Drawing mode owns gestures instead of legacy PLAN handlers.
      await page.locator('[data-nav-action="DRAW"]').click();
      assert.equal(await page.locator('#drawingCapture').isVisible(), true);
      const drawBox = await page.locator('#drawingCapture').boundingBox();
      assert.equal(await page.evaluate(()=>BaselineApp.map.options.zoomSnap),0,
        'drawing gestures must support continuous fractional zoom');
      await page.locator('#drawingCapture').dispatchEvent('pointerdown', { pointerId:11, pointerType:'touch', isPrimary:true, clientX:drawBox.x+120, clientY:drawBox.y+350 });
      await page.locator('#drawingCapture').dispatchEvent('pointermove', { pointerId:11, pointerType:'touch', isPrimary:true, clientX:drawBox.x+150, clientY:drawBox.y+370 });
      await page.locator('#drawingCapture').dispatchEvent('pointermove', { pointerId:11, pointerType:'touch', isPrimary:true, clientX:drawBox.x+180, clientY:drawBox.y+390 });
      await page.locator('#drawingCapture').dispatchEvent('pointerup', { pointerId:11, pointerType:'touch', isPrimary:true, clientX:drawBox.x+180, clientY:drawBox.y+390 });
      assert.equal(await page.evaluate(() => BaselineNavigationUI.getDraft().drawings.length), 1);

      // Two-finger gesture moves the map and must not create another drawing.
      const centerBeforeGesture = await page.evaluate(() => {
        const c = BaselineApp.map.getCenter();
        return [c.lat,c.lng];
      });
      await page.locator('#drawingCapture').dispatchEvent('pointerdown', { pointerId:21, pointerType:'touch', isPrimary:true, clientX:drawBox.x+100, clientY:drawBox.y+300 });
      await page.locator('#drawingCapture').dispatchEvent('pointerdown', { pointerId:22, pointerType:'touch', isPrimary:false, clientX:drawBox.x+210, clientY:drawBox.y+300 });
      await page.locator('#drawingCapture').dispatchEvent('pointermove', { pointerId:21, pointerType:'touch', isPrimary:true, clientX:drawBox.x+75, clientY:drawBox.y+315 });
      await page.locator('#drawingCapture').dispatchEvent('pointermove', { pointerId:22, pointerType:'touch', isPrimary:false, clientX:drawBox.x+185, clientY:drawBox.y+315 });
      await page.locator('#drawingCapture').dispatchEvent('pointerup', { pointerId:21, pointerType:'touch', isPrimary:true, clientX:drawBox.x+75, clientY:drawBox.y+315 });
      await page.locator('#drawingCapture').dispatchEvent('pointerup', { pointerId:22, pointerType:'touch', isPrimary:false, clientX:drawBox.x+185, clientY:drawBox.y+315 });
      assert.equal(await page.evaluate(() => BaselineNavigationUI.getDraft().drawings.length), 1);
      const centerAfterGesture = await page.evaluate(() => {
        const c = BaselineApp.map.getCenter();
        return [c.lat,c.lng];
      });
      assert(Math.abs(centerAfterGesture[0]-centerBeforeGesture[0]) > 0.00001 || Math.abs(centerAfterGesture[1]-centerBeforeGesture[1]) > 0.00001);

      // A small pinch must change zoom gradually instead of freezing until
      // a 0.12 threshold or snapping directly to a .25 increment.
      const zoomSmoothStart=await page.evaluate(()=>BaselineApp.map.getZoom());
      await page.locator('#drawingCapture').dispatchEvent('pointerdown',
        {pointerId:23,pointerType:'touch',isPrimary:true,clientX:drawBox.x+130,clientY:drawBox.y+310});
      await page.locator('#drawingCapture').dispatchEvent('pointerdown',
        {pointerId:24,pointerType:'touch',isPrimary:false,clientX:drawBox.x+250,clientY:drawBox.y+310});
      await page.locator('#drawingCapture').dispatchEvent('pointermove',
        {pointerId:23,pointerType:'touch',isPrimary:true,clientX:drawBox.x+124,clientY:drawBox.y+310});
      await page.locator('#drawingCapture').dispatchEvent('pointermove',
        {pointerId:24,pointerType:'touch',isPrimary:false,clientX:drawBox.x+256,clientY:drawBox.y+310});
      await page.waitForTimeout(50);
      const zoomMid=await page.evaluate(()=>BaselineApp.map.getZoom());
      assert(zoomMid>zoomSmoothStart+.05 && zoomMid<zoomSmoothStart+.25,
        'small pinch must produce a non-snapped incremental change');
      await page.locator('#drawingCapture').dispatchEvent('pointermove',
        {pointerId:23,pointerType:'touch',isPrimary:true,clientX:drawBox.x+115,clientY:drawBox.y+310});
      await page.locator('#drawingCapture').dispatchEvent('pointermove',
        {pointerId:24,pointerType:'touch',isPrimary:false,clientX:drawBox.x+265,clientY:drawBox.y+310});
      await page.locator('#drawingCapture').dispatchEvent('pointerup',
        {pointerId:23,pointerType:'touch',isPrimary:true,clientX:drawBox.x+115,clientY:drawBox.y+310});
      await page.locator('#drawingCapture').dispatchEvent('pointerup',
        {pointerId:24,pointerType:'touch',isPrimary:false,clientX:drawBox.x+265,clientY:drawBox.y+310});
      const zoomSmoothEnd=await page.evaluate(()=>BaselineApp.map.getZoom());
      assert(zoomSmoothEnd>zoomMid+.10,'continuous pinch should progress smoothly with finger movement');
      assert.equal(await page.evaluate(()=>BaselineNavigationUI.getDraft().drawings.length),1,
        'pinch must not create freehand or connected-line paths');

      const zoomBeforePinch=await page.evaluate(() => BaselineApp.map.getZoom());
      await page.locator('#drawingCapture').dispatchEvent('pointerdown', {pointerId:31,pointerType:'touch',isPrimary:true,clientX:drawBox.x+125,clientY:drawBox.y+310});
      await page.locator('#drawingCapture').dispatchEvent('pointerdown', {pointerId:32,pointerType:'touch',isPrimary:false,clientX:drawBox.x+245,clientY:drawBox.y+310});
      await page.locator('#drawingCapture').dispatchEvent('pointermove', {pointerId:31,pointerType:'touch',isPrimary:true,clientX:drawBox.x+75,clientY:drawBox.y+310});
      await page.locator('#drawingCapture').dispatchEvent('pointermove', {pointerId:32,pointerType:'touch',isPrimary:false,clientX:drawBox.x+295,clientY:drawBox.y+310});
      await page.locator('#drawingCapture').dispatchEvent('pointerup', {pointerId:31,pointerType:'touch',isPrimary:true,clientX:drawBox.x+75,clientY:drawBox.y+310});
      await page.locator('#drawingCapture').dispatchEvent('pointerup', {pointerId:32,pointerType:'touch',isPrimary:false,clientX:drawBox.x+295,clientY:drawBox.y+310});
      assert(await page.evaluate(() => BaselineApp.map.getZoom())>=zoomBeforePinch+.5,'two-finger drawing must actually zoom');
      assert.equal(await page.evaluate(() => BaselineNavigationUI.getDraft().drawings.length),1,'pinch must not add strokes');

      await page.locator('[data-draw-kind="ERASE"]').click();
      assert.equal(await page.locator('[data-draw-kind="ERASE"]').getAttribute('class')?.then(x=>x.includes('active')),true);
      const eraseLocation=await page.evaluate(() => {
        const draft=BaselineNavigationUI.getDraft();
        const map=BaselineApp.map;
        const points=draft.drawings[0].points;
        const center=map.latLngToContainerPoint(points[1]);
        const rect=map.getContainer().getBoundingClientRect();
        const length=points.slice(1).reduce((sum,p,i)=>sum+map.latLngToContainerPoint(p).distanceTo(map.latLngToContainerPoint(points[i])),0);
        return {x:center.x+rect.left,y:center.y+rect.top,length};
      });
      const freeBeforeEraser=await page.evaluate(()=>BaselineNavigationUI.getDraft().drawings);
      await page.locator('#drawingCapture').dispatchEvent('pointerdown',{pointerId:41,pointerType:'touch',isPrimary:true,clientX:eraseLocation.x,clientY:eraseLocation.y});
      assert.equal(await page.locator('#drawingEraserCursor').isVisible(),true);
      await page.locator('#drawingCapture').dispatchEvent('pointermove',{pointerId:41,pointerType:'touch',isPrimary:true,clientX:eraseLocation.x+13,clientY:eraseLocation.y+9});
      assert.notDeepEqual(await page.evaluate(()=>BaselineNavigationUI.getDraft().drawings),freeBeforeEraser,
        'freehand stroke must visibly change BEFORE pointerup, not on release');
      assert(await page.locator('path.baseline-plan-drawing').count()>=1,
        'persisted drawing must be painted in an editable SVG during live erasure');
      await page.locator('#drawingCapture').dispatchEvent('pointerup',{pointerId:41,pointerType:'touch',isPrimary:true,clientX:eraseLocation.x+13,clientY:eraseLocation.y+9});
      const erased=await page.evaluate(() => {
        const plan=BaselineNavigationUI.getDraft(),map=BaselineApp.map;
        return {count:plan.drawings.length,
          length:plan.drawings.reduce((sum,seg)=>sum+seg.points.slice(1).reduce((n,p,i)=>
            n+map.latLngToContainerPoint(p).distanceTo(map.latLngToContainerPoint(seg.points[i])),0),0)};
      });
      assert(erased.count>0 && erased.length<eraseLocation.length-5,
        'eraser must remove only the touched portion, not the entire drawing');
      await page.locator('#drawUndoBtn').click();
      const restored=await page.evaluate(() => BaselineNavigationUI.getDraft().drawings.length);
      assert.equal(restored,1,'undo must restore erased stroke segments');

      // RECON POINT: a tap adds precisely one geographic vertex; connected
      // edges persist even when their midpoint is touched by the eraser.
      const drawTap=async(pointerId,x,y)=>{
        const p={pointerId,pointerType:'touch',isPrimary:true,button:0,clientX:x,clientY:y};
        await page.locator('#drawingCapture').dispatchEvent('pointerdown',p);
        await page.locator('#drawingCapture').dispatchEvent('pointerup',p);
      };
      await page.locator('[data-draw-tool="POINT"]').click();
      assert.equal(await page.locator('#drawFinishLineBtn').isVisible(),true);
      assert.equal(await page.locator('[data-draw-tool="POINT"]').getAttribute('aria-pressed'),'true');
      const nodesPixels=[[drawBox.x+50,drawBox.y+485],[drawBox.x+170,drawBox.y+430],
        [drawBox.x+290,drawBox.y+485]];
      for(let i=0;i<nodesPixels.length;i++)
        await drawTap(151+i,nodesPixels[i][0],nodesPixels[i][1]);
      const originalPointChain=await page.evaluate(()=>BaselineNavigationUI.getDrawingState().points);
      assert.equal(originalPointChain.length,3,'each tap must yield exactly one corner');
      assert.equal(await page.locator('path.baseline-point-preview').count(),1);
      assert.equal(await page.locator('path.baseline-point-preview').getAttribute('stroke-dasharray'),null,
        'solid line is the default drawing style');
      await page.locator('[data-draw-kind="ROUTE"]').click();
      assert.equal(await page.evaluate(()=>BaselineNavigationUI.getDrawingState().points.length),3,
        'changing line style must not accidentally commit/discard the point chain');
      assert.equal(await page.locator('path.baseline-point-preview').getAttribute('stroke-dasharray'),'8 6');
      await page.locator('[data-draw-tool="ERASE"]').click();
      assert.equal(await page.locator('path.baseline-point-preview').count(),1,
        'unfinished connected edge must remain visible while erasing vertices');
      assert.equal(await page.locator('path.baseline-point-node').count(),3);
      const e1=await page.evaluate(()=>{
        const arr=BaselineNavigationUI.getDrawingState().points,m=BaselineApp.map;
        const a=m.latLngToContainerPoint(arr[0]),b=m.latLngToContainerPoint(arr[1]);
        const r=m.getContainer().getBoundingClientRect();
        return {x:r.left+(a.x+b.x)/2,y:r.top+(a.y+b.y)/2};
      });
      await drawTap(155,e1.x,e1.y);
      assert.equal(await page.evaluate(()=>BaselineNavigationUI.getDrawingState().points.length),3,
        'eraser touching a connected segment must not erase the line or a vertex');
      await drawTap(156,nodesPixels[1][0],nodesPixels[1][1]);
      assert.equal(await page.evaluate(()=>BaselineNavigationUI.getDrawingState().points.length),2,
        'eraser directly on a vertex must delete that vertex and reconnect edges');
      await page.locator('#drawUndoBtn').click();
      const restoredPointChain=await page.evaluate(()=>BaselineNavigationUI.getDrawingState());
      assert.deepEqual(restoredPointChain.points,originalPointChain,
        'undo should restore the exact geographic coordinates of the erased vertex');
      assert.equal(restoredPointChain.tool,'ERASE');
      await page.locator('[data-draw-tool="POINT"]').click();
      const beforePinchChain=await page.evaluate(()=>BaselineNavigationUI.getDrawingState().points);
      await page.locator('#drawingCapture').dispatchEvent('pointerdown',{
        pointerId:160,pointerType:'touch',isPrimary:true,clientX:drawBox.x+110,clientY:drawBox.y+350
      });
      await page.locator('#drawingCapture').dispatchEvent('pointerdown',{
        pointerId:161,pointerType:'touch',isPrimary:false,clientX:drawBox.x+220,clientY:drawBox.y+350
      });
      await page.locator('#drawingCapture').dispatchEvent('pointermove',{
        pointerId:160,pointerType:'touch',isPrimary:true,clientX:drawBox.x+90,clientY:drawBox.y+375
      });
      await page.locator('#drawingCapture').dispatchEvent('pointerup',{
        pointerId:160,pointerType:'touch',isPrimary:true,clientX:drawBox.x+90,clientY:drawBox.y+375
      });
      await page.locator('#drawingCapture').dispatchEvent('pointerup',{
        pointerId:161,pointerType:'touch',isPrimary:false,clientX:drawBox.x+220,clientY:drawBox.y+350
      });
      assert.deepEqual(await page.evaluate(()=>BaselineNavigationUI.getDrawingState().points),beforePinchChain,
        'two-finger panning must retain the WGS84 location of every selected vertex');
      assert.equal(await page.locator('#drawFinishLineBtn').isVisible(),true);
      await page.locator('#drawFinishLineBtn').click();
      assert.equal(await page.evaluate(()=>BaselineNavigationUI.getDrawingState().points.length),0,
        'finishing one connected line should immediately clear vertices for the next line');
      let connected=await page.evaluate(()=>BaselineNavigationUI.getDraft().drawings.filter(x=>x.mode==='POINT'));
      assert.equal(connected.length,1);
      assert.equal(connected[0].points.length,3);
      assert.equal(connected[0].kind,'ROUTE','saved point chain must remember its dashed style');
      assert.deepEqual(connected[0].points,originalPointChain);

      // One more line without closing and reopening the drawing interface.
      await drawTap(162,drawBox.x+75,drawBox.y+540);
      await drawTap(163,drawBox.x+270,drawBox.y+540);
      await page.locator('#drawFinishLineBtn').click();
      connected=await page.evaluate(()=>BaselineNavigationUI.getDraft().drawings.filter(x=>x.mode==='POINT'));
      assert.equal(connected.length,2,'a second separate straight line should be possible in one drawing session');

      // Erase an already committed point. The connected geometry keeps its
      // identity and the two surviving endpoints reconnect automatically.
      await page.locator('[data-draw-tool="ERASE"]').click();
      const savedMiddle=await page.evaluate(()=>{
        const seg=BaselineNavigationUI.getDraft().drawings.find(x=>x.mode==='POINT');
        const pt=BaselineApp.map.latLngToContainerPoint(seg.points[1]);
        const box=BaselineApp.map.getContainer().getBoundingClientRect();
        return {x:box.left+pt.x,y:box.top+pt.y};
      });
      await page.locator('#drawingCapture').dispatchEvent('pointerdown',
        {pointerId:164,pointerType:'touch',isPrimary:true,clientX:savedMiddle.x,clientY:savedMiddle.y});
      assert.equal(await page.evaluate(()=>
        BaselineNavigationUI.getDraft().drawings.find(x=>x.mode==='POINT').points.length),2,
        'saved POINT vertex must disappear on touch, before lifting the finger');
      await page.locator('#drawingCapture').dispatchEvent('pointerup',
        {pointerId:164,pointerType:'touch',isPrimary:true,clientX:savedMiddle.x,clientY:savedMiddle.y});
      connected=await page.evaluate(()=>BaselineNavigationUI.getDraft().drawings.filter(x=>x.mode==='POINT'));
      assert.equal(connected[0].points.length,2,'deleting a saved middle vertex must join neighboring endpoints');
      assert.deepEqual(connected[0].points,[originalPointChain[0],originalPointChain[2]]);
      await page.locator('#drawUndoBtn').click();
      connected=await page.evaluate(()=>BaselineNavigationUI.getDraft().drawings.filter(x=>x.mode==='POINT'));
      assert.deepEqual(connected[0].points,originalPointChain,'undo must restore saved vertex edits as well');
      assert.equal(await page.evaluate(()=>BaselineNavigationUI.getDrawingState().tool),'ERASE');

      const roundTrip=await page.evaluate(()=>{
        const draft=BaselineNavigationUI.getDraft();
        const encoded=JSON.stringify(BaselinePlanStore.exportPayload(draft));
        const decoded=BaselinePlanStore.normalize(JSON.parse(encoded).plan);
        return decoded.drawings.filter(seg=>seg.mode==='POINT')
          .map(seg=>({mode:seg.mode,kind:seg.kind,points:seg.points.length}));
      });
      assert.deepEqual(roundTrip,[
        {mode:'POINT',kind:'ROUTE',points:3},
        {mode:'POINT',kind:'ROUTE',points:2}
      ],'plan export and import must preserve connected vertex mode and style');
      await page.locator('#drawDoneBtn').click();
      assert.equal(await page.evaluate(() => BaselineApp.map.options.zoomSnap),1,
        'normal map zoom snapping must be restored after drawing');
      assert.equal(await page.locator('#drawingCapture').isHidden(), true);

      // Session lifecycle + TRACK v1: GPS-only points, pause segmentation, reload recovery.
      await page.locator('[data-nav-action="START"]').click();
      assert.equal(await page.evaluate(() => BaselineRecordStore.getActive()?.status), 'RUNNING');
      assert.equal(await page.locator('#navTimer').isVisible(), true);

      await page.evaluate(() => {
        BaselineState.setGpsEnabled(true);
        BaselineState.setGpsFix({ lat:37.50000, lon:127.00000, accuracy:5, altitude:100 });
      });
      await page.waitForTimeout(25);
      await page.evaluate(() => BaselineState.setGpsFix({ lat:37.50010, lon:127.00000, accuracy:5, altitude:101 }));
      await page.waitForTimeout(30);
      assert.equal(await page.evaluate(() => BaselineRecordStore.getActive()?.track?.points?.length), 2);
      assert.equal(await page.evaluate(() => BaselineNavigationUI.trackLayer.getLayers().length), 1);
      assert.equal(await page.evaluate(() => BaselineRecordStore.getActive()?.track?.distanceMeters > 8), true);

      await page.locator('[data-nav-action="LAP"]').click();
      assert.equal(await page.evaluate(() => BaselineRecordStore.getActive()?.laps.length), 1);
      await page.locator('[data-nav-action="PAUSE"]').click();
      assert.equal(await page.evaluate(() => BaselineRecordStore.getActive()?.status), 'PAUSED');
      assert.equal(await page.locator('[data-nav-action="PAUSE"]').textContent(), '재개');

      const trackCountAtPause = await page.evaluate(() => BaselineRecordStore.getActive()?.track?.points?.length);
      await page.evaluate(() => BaselineState.setGpsFix({ lat:37.51000, lon:127.01000, accuracy:5, altitude:120 }));
      await page.waitForTimeout(25);
      assert.equal(await page.evaluate(() => BaselineRecordStore.getActive()?.track?.points?.length), trackCountAtPause, 'paused GPS fixes must not append track points');

      await page.reload();
      await page.waitForFunction(() => window.BaselineApp?.version === 'R0.1-BASELINE');
      assert.equal(await page.evaluate(() => BaselineRecordStore.getActive()?.status), 'PAUSED');
      assert.equal(await page.locator('#navRouteSummary').isVisible(), true);
      assert.equal(await page.locator('[data-nav-action="PAUSE"]').textContent(), '재개');
      assert.equal(await page.evaluate(() => BaselineNavigationUI.trackLayer.getLayers().length), 1, 'saved live track must restore after reload');

      await page.locator('[data-nav-action="PAUSE"]').click();
      assert.equal(await page.evaluate(() => BaselineRecordStore.getActive()?.status), 'RUNNING');
      await page.evaluate(() => {
        BaselineState.setGpsEnabled(true);
        BaselineState.setGpsFix({ lat:37.51000, lon:127.01000, accuracy:5, altitude:120 });
      });
      await page.waitForTimeout(25);
      await page.evaluate(() => BaselineState.setGpsFix({ lat:37.51010, lon:127.01000, accuracy:5, altitude:121 }));
      await page.waitForTimeout(30);
      const trackCheck = await page.evaluate(() => {
        const track=BaselineRecordStore.getActive()?.track;
        return {
          points:track?.points?.length || 0,
          segments:[...new Set((track?.points || []).map(p => p.segment))],
          distance:track?.distanceMeters || 0
        };
      });
      assert.equal(trackCheck.points, 4);
      assert.equal(trackCheck.segments.length, 2);
      assert(trackCheck.distance > 15 && trackCheck.distance < 100, 'paused gap must not inflate track distance');
      assert.equal(await page.evaluate(() => BaselineNavigationUI.trackLayer.getLayers().length), 2);

      page.once('dialog', dialog => dialog.accept());
      await page.locator('[data-nav-action="STOP"]').click();
      assert.equal(await page.evaluate(() => BaselineRecordStore.getActive()), null);
      assert.equal(await page.evaluate(() => BaselineRecordStore.list().length), 1);
      const finishedTrack = await page.evaluate(() => BaselineRecordStore.list()[0].track);
      assert.equal(finishedTrack.points.length, 4);
      assert.equal(new Set(finishedTrack.points.map(p => p.segment)).size, 2);

      await page.locator('.bottom-nav button[data-panel="records"]').click();
      assert.equal(await page.locator('#sheetTitle').textContent(), '기록');
      assert.equal(await page.locator('.record-row').count(), 1);
      assert.equal(await page.locator('.record-row').textContent().then(t => t.includes('궤적')), true);
      await page.locator('.record-row').click();
      assert.equal(await page.locator('#sheetTitle').textContent(), '기록 상세');
      assert.equal(await page.locator('.record-lap').count(), 1);
      assert.equal(await page.locator('.record-summary').textContent().then(t => t.includes('4 지점')), true);
      assert.equal(await page.locator('#recordMapView').count(), 1);
      await page.screenshot({ path:`ui-results-baseline/${name}-navigation-record.png`, fullPage:true });
      await page.locator('#recordMapView').click();
      assert.equal(await page.locator('#sheet').isHidden(), true);
      assert.equal(await page.evaluate(() => BaselineNavigationUI.recordPreviewLayer.getLayers().length >= 3), true);

      await page.locator('.bottom-nav button[data-panel="records"]').click();
      await page.locator('.record-row').click();
      assert.equal(await page.locator('#recordDeleteBtn').count(), 1);
      page.once('dialog', dialog => dialog.accept());
      await page.locator('#recordDeleteBtn').click();
      assert.equal(await page.evaluate(() => BaselineRecordStore.list().length), 0);
      assert.equal(await page.locator('.record-row').count(), 0);

      await page.locator('.bottom-nav button[data-panel="plans"]').click();
      assert.equal(await page.locator('.plan-library-row').count(), 1);
      assert.equal(await page.locator('[data-plan-share]').count(), 1);
      await page.screenshot({ path:`ui-results-baseline/${name}-plans.png`, fullPage:true });
      await page.locator('#sheetClose').click();

      await page.locator('#searchBtn').click();
      assert.equal(await page.locator('#sheetTitle').textContent(), '검색');
      assert(await page.locator('#baselineSearchInput').isVisible());
      await page.locator('#sheetClose').click();

      await page.locator('#layerBtn').click();
      assert.equal(await page.locator('#sheetTitle').textContent(), '레이어');
      assert.equal(await page.locator('[data-layer-key]').count(), 6);
      await page.locator('[data-layer-key="registered"]').click();
      assert.equal(await page.evaluate(() => document.body.classList.contains('layer-hide-registered')), true);
      await page.locator('[data-layer-key="registered"]').click();
      assert.equal(await page.evaluate(() => document.body.classList.contains('layer-hide-registered')), false);
      await page.locator('#sheetClose').click();

      await page.locator('#settingsBtn').click();
      assert.equal(await page.locator('#sheetTitle').textContent(), '설정');
      assert.equal(await page.locator('#sheetBody').textContent().then(t => t.includes('NVG-G')), true);
      assert.equal(await page.locator('[data-map-mode]').count(), 3);
      assert.equal(await page.locator('#litePackBtn').count(), 1);
      await page.locator('#sheetClose').click();

      // Offline shell: verify the isolated cache in both engines.
      await page.evaluate(() => BaselineLiteMap.setMode('lite'));
      const offlineShell = await page.evaluate(async () => {
        const names=await caches.keys();
        const shellName=names.find(name => /^recon-console-baseline-shell-v\d+$/.test(name));
        if(!shellName)return {shell:false,index:false,app:false};
        const cache=await caches.open(shellName);
        return {
          shell:true,
          index:Boolean(await cache.match(new URL('./index.html',location.href).href)),
          app:Boolean(await cache.match(new URL('./app.js',location.href).href))
        };
      });
      assert.deepEqual(offlineShell,{shell:true,index:true,app:true});
      assert.equal(await page.evaluate(() => BaselineLiteMap.status().label), 'MAP · LITE');

      // Playwright WebKit currently crashes internally on SW-controlled setOffline+reload,
      // so the real network-cut boot is exercised in Chromium and cache ownership is
      // asserted above for WebKit. Real iPhone airplane-mode boot remains a device test.
      if(name === 'chromium'){
        await context.setOffline(true);
        await page.reload({ waitUntil:'domcontentloaded' });
        await page.waitForFunction(() => window.BaselineApp?.version === 'R0.1-BASELINE' && window.BaselineLiteMap);
        assert.equal(await page.evaluate(() => BaselineLiteMap.status().effective), 'lite');
        assert.equal(await page.locator('#mapModeStatus').textContent(), 'MAP · LITE');
        assert.equal(await page.locator('.bottom-nav button').count(), 4);
        assert.equal(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length), 1);
        await context.setOffline(false);
      }
      await page.evaluate(() => BaselineLiteMap.setMode('online'));

      for (const width of [320, 390, 768]) {
        await page.setViewportSize({ width, height: 844 });
        await page.evaluate(() => BaselineApp.map.invalidateSize());
        const quick = await page.locator('.quick-stack').boundingBox();
        const hud = await page.locator('.position-hud').boundingBox();
        assert(quick.x >= 0 && quick.x + quick.width <= width + 1);
        assert(hud.x >= 0 && hud.x + hud.width <= width + 1);
        await page.locator('.bottom-nav button[data-panel="sites"]').click();
        await page.locator('.site-row').first().click();
        const actionLayout=await page.evaluate(() => {
          const box=id=>document.getElementById(id).getBoundingClientRect();
          const top=box('siteDestinationSet'),left=box('siteMapGo'),right=box('siteSecureToggle');
          return {
            top:{width:top.width,y:top.y,bottom:top.bottom},
            left:{width:left.width,y:left.y,bottom:left.bottom},
            right:{width:right.width,y:right.y,bottom:right.bottom},
            labels:['siteDestinationSet','siteMapGo','siteSecureToggle'].map(id=>{
              const el=document.getElementById(id);
              return {nowrap:getComputedStyle(el).whiteSpace==='nowrap',overflow:el.scrollWidth>el.clientWidth+1};
            })
          };
        });
        assert(actionLayout.top.width > actionLayout.left.width*1.8,'primary action must occupy full row');
        assert(actionLayout.left.y >= actionLayout.top.bottom,'secondary actions must be below primary');
        assert(Math.abs(actionLayout.left.y-actionLayout.right.y) < 2,'secondary actions must align');
        assert(actionLayout.labels.every(x=>x.nowrap && !x.overflow),'action labels must fit on one line');
        await page.screenshot({ path:`ui-results-baseline/${name}-site-actions-${width}.png`, fullPage:true });
        await page.locator('#sheetClose').click();
        await page.screenshot({ path:`ui-results-baseline/${name}-${width}.png`, fullPage:true });

        // Do not equate hiding overflow with fixing it. Visit each major
        // function group at phone/tablet widths and measure actual line breaks.
        const auditText = async panel => {
          const issues=await page.evaluate(() => {
            const failures=[];
            const sheet=document.getElementById('sheet');
            const body=document.getElementById('sheetBody');
            if(!sheet.hidden && body.scrollWidth>body.clientWidth+2){
              failures.push('sheet horizontal overflow: ' + body.scrollWidth + '/' + body.clientWidth);
            }
            const items=[...document.querySelectorAll(
              '#sheet button, .bottom-nav button, .nav-session-controls button, '+
              '.drawing-controls button, .site-placement-bar button'
            )];
            for(const el of items){
              if(!el.getClientRects().length || el.closest('[hidden]'))continue;
              if(el.children.length>0)continue; // descriptions in cards are deliberately multiline
              const txt=el.textContent.trim();
              if(!txt)continue;
              if(el.scrollWidth>el.clientWidth+2){
                failures.push('horizontal clipping: '+txt+' / '+el.className);
              }
              const node=[...el.childNodes].find(x=>x.nodeType===Node.TEXT_NODE && x.textContent.trim());
              if(!node)continue;
              const range=document.createRange();
              range.selectNodeContents(node);
              const tops=[...range.getClientRects()].filter(rect=>rect.width>0)
                .map(rect=>Math.round(rect.top));
              if(new Set(tops).size>1){
                failures.push('broken button line: '+txt+' / '+el.className);
              }
            }
            return failures;
          });
          assert.deepEqual(issues,[],name+' '+width+' '+panel+' text audit: '+JSON.stringify(issues));
        };
        await page.locator('.bottom-nav button[data-panel="sites"]').click();
        await auditText('sites-list');
        await page.locator('#siteAddBtn').click();
        await auditText('site-add');
        await page.locator('[data-site-add-source="MAP"]').click();
        assert.equal(await page.locator('#sitePlacementBar').isVisible(),true);
        await auditText('map-placement');
        await page.locator('#sitePlacementConfirm').click();
        await auditText('site-form');
        await page.locator('#sheetClose').click();

        await page.locator('.bottom-nav button[data-panel="explore"]').click();
        await auditText('explore');
        await page.locator('#sheetClose').click();
        await page.locator('.bottom-nav button[data-panel="plans"]').click();
        await auditText('plans');
        await page.locator('#planNewBtn').click();
        assert.equal(await page.locator('#sheetTitle').textContent(),'계획 편집');
        await auditText('plan-editor');
        await page.locator('[data-edit-point="DEST"]').click();
        await auditText('point-picker');
        await page.locator('#pointPickerBack').click();
        await page.locator('#sheetClose').click();
        await page.locator('.bottom-nav button[data-panel="records"]').click();
        await auditText('records');
        await page.locator('#sheetClose').click();
        await page.locator('#settingsBtn').click();
        await auditText('settings');
        await page.locator('#sheetClose').click();
        await page.locator('#layerBtn').click();
        await auditText('layers');
        await page.locator('#sheetClose').click();
        await page.locator('#searchBtn').click();
        await auditText('search');
        await page.locator('#sheetClose').click();
      }

      // Simulate a partially unavailable OpenTopoMap service. The app must
      // present a useful OSM background instead of leaving blank tile holes,
      // while not downloading the second basemap on normal startup.
      const recovery=await page.evaluate(()=>{
        BaselineLiteMap.setMode('online');
        const lazy=!BaselineApp.map.hasLayer(BaselineLiteMap.onlineRecoveryLayer);
        BaselineApp.topoLayer.fire('tileerror');
        const first=BaselineApp.map.hasLayer(BaselineLiteMap.onlineRecoveryLayer);
        BaselineApp.topoLayer.fire('tileerror');
        BaselineApp.topoLayer.fire('tileerror');
        const recovered={
          lazy,first,status:BaselineLiteMap.status(),
          fallbackVisible:BaselineApp.map.hasLayer(BaselineLiteMap.onlineRecoveryLayer),
          topoActive:BaselineApp.map.hasLayer(BaselineApp.topoLayer),
          roadActive:BaselineApp.map.hasLayer(BaselineApp.roadBoostLayer)
        };
        BaselineLiteMap.setMode('online');
        recovered.reset={
          recovered:false,
          topoActive:BaselineApp.map.hasLayer(BaselineApp.topoLayer),
          fallbackActive:BaselineApp.map.hasLayer(BaselineLiteMap.onlineRecoveryLayer)
        };
        return recovered;
      });
      assert(recovery.lazy && recovery.first,'OSM backup must load only after a real topo tile error');
      assert(recovery.status.onlineRecoveryActive && recovery.status.onlineRecoveryPrimary &&
        recovery.fallbackVisible && !recovery.topoActive && !recovery.roadActive,
        'repeated failed topographic tiles must switch to real OSM without triple requests');
      assert.equal(recovery.status.label,'MAP · OSM');
      assert(recovery.reset.topoActive && !recovery.reset.fallbackActive,
        'explicit online selection should retry the original detailed map');

      assert.deepEqual(errors, []);
    } catch (error) {
      failures++;
      console.error(name, error.stack);
      await page.screenshot({ path:`ui-results-baseline/${name}-failure.png`, fullPage:true });
    }

    await browser.close();
  }

  server.close();
  if (failures) process.exitCode = 1;
})().catch(error => {
  console.error(error);
  server.close();
  process.exitCode = 1;
});
