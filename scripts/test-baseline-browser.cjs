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
      assert.equal(await page.locator('#tempBtn').evaluate(el => getComputedStyle(el).touchAction), 'manipulation');
      assert(parseFloat(await page.locator('.bottom-nav button').first().evaluate(el => getComputedStyle(el).fontSize)) >= 14);
      assert(parseFloat(await page.locator('#positionCoord').evaluate(el => getComputedStyle(el).fontSize)) >= 13);
      assert(parseFloat(await page.locator('#positionMeta').evaluate(el => getComputedStyle(el).fontSize)) >= 11);
      assert.equal(await page.locator('#positionMeta').evaluate(el => getComputedStyle(el).color), 'rgb(145, 214, 158)');
      assert.equal(await page.locator('#mapModeStatus').evaluate(el => getComputedStyle(el).color), 'rgb(127, 201, 142)');
      assert.equal(await page.locator('#reticleCoord').count(), 1);
      const bodyText = await page.locator('body').textContent();
      assert.equal(bodyText.includes('\\n'), false, 'escaped newline text must never render');
      assert.equal(await page.locator('.map-tech-grid').evaluate(el => getComputedStyle(el).opacity), '0.72');
      assert.equal(await page.locator('.position-hud').evaluate(el => getComputedStyle(el,'::before').backgroundColor), 'rgba(0, 8, 3, 0.21)');
      assert.equal(await page.locator('.position-hud').evaluate(el => getComputedStyle(el,'::after').content !== 'none'), true);
      assert.equal(await page.locator('.reticle').evaluate(el => getComputedStyle(el,'::before').content !== 'none'), true);
      assert.equal(await page.locator('.reticle-core').evaluate(el => getComputedStyle(el,'::after').content !== 'none'), true);
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
      assert.equal(await page.locator('[class*="corner"]').count(), 0);
      const attributionText = await page.locator('.leaflet-control-attribution').textContent();
      assert.equal(attributionText.includes('Leaflet'), false, 'Leaflet prefix should be removed to reduce clutter');
      assert.equal(attributionText.includes('OpenStreetMap'), true, 'required map attribution must remain');

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

      await page.locator('#tempBtn').click();
      let temp = await page.evaluate(() => BaselineState.state.temp);
      assert(temp && Number.isFinite(temp.lat) && Number.isFinite(temp.lon));
      assert.equal(await page.evaluate(() => BaselineState.reference()?.type), 'TEMP');
      assert(await page.locator('#tempBtn').evaluate(el => el.classList.contains('active')));
      assert.equal(await page.locator('.baseline-marker.temp').count(), 1);

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
      await page.locator('.site-row').first().click();
      assert.equal(await page.locator('#sheetTitle').textContent(), '거점 정보');
      assert(await page.locator('#siteMapGo').isVisible());
      assert.equal(await page.locator('#siteSecureToggle').textContent(), '개척 완료');
      await page.locator('#siteSecureToggle').click();
      assert.equal(await page.locator('#siteSecureToggle').textContent(), '미개척으로');
      assert.equal(await page.evaluate(() => BaselineSites.getSecured().length), 1);
      await page.locator('#sheetClose').click();

      await page.locator('.bottom-nav button[data-panel="sites"]').click();
      await page.locator('[data-site-filter="secured"]').click();
      assert.equal(await page.locator('.site-row').count(), 1);
      await page.locator('#sheetClose').click();

      await page.locator('.bottom-nav button[data-panel="explore"]').click();
      assert.equal(await page.locator('#sheetTitle').textContent(), '탐색');
      assert.equal(await page.locator('[data-explore-radius]').count(), 4);
      assert.equal(await page.locator('#exploreRegisteredBtn').count(), 1);
      assert.equal(await page.locator('#exploreWildBtn').count(), 1);
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
      assert.equal(await page.locator('[data-edit-point="START"]').count(), 1);
      assert.equal(await page.locator('[data-edit-point="DEST"]').count(), 1);

      assert.equal(await page.evaluate(() => BaselineNavigationUI.getDraft().start?.source), 'TEMP');
      await page.locator('#planNameInput').fill('BASELINE TEST PLAN');
      await page.locator('[data-edit-point="DEST"]').click();
      assert.equal(await page.locator('#sheetTitle').textContent(), '목적지 선택');
      assert.equal(await page.locator('#pointAddressInput').count(), 1);
      await page.locator('#pointAddressInput').fill('서울시청');
      await page.locator('#pointAddressSearch').click();
      await page.locator('[data-address-result="0"]').click();
      assert.equal(await page.locator('#sheetTitle').textContent(), '계획 편집');
      assert.equal(await page.evaluate(() => BaselineNavigationUI.getDraft().destination?.source), 'ADDRESS');

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

      await page.locator('[data-nav-action="CLOSE"]').click();
      assert.equal(await page.locator('#navRouteSummary').isHidden(), true);
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

      await page.locator('#drawDoneBtn').click();
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
        const shellName=names.find(name => /^baseline-shell-v\d+$/.test(name) || /^baseline-offline-v\d+-shell$/.test(name));
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
        await page.screenshot({ path:`ui-results-baseline/${name}-${width}.png`, fullPage:true });
      }

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
