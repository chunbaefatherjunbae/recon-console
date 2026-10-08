(() => {
  'use strict';

  const App = window.BaselineApp;
  const S = window.BaselineState;
  const Sites = window.BaselineSites;
  const Explore = window.BaselineExplore;
  const Core = window.BaselineNavigationCore;
  const Plans = window.BaselinePlanStore;
  const Records = window.BaselineRecordStore;

  if (!App || !S || !Sites || !Explore || !Core || !Plans || !Records || !window.L) {
    console.error('[BASELINE NAV] dependency missing');
    return;
  }

  const map = App.map;
  const $ = id => document.getElementById(id);
  const routeLayer = L.layerGroup().addTo(map);
  const drawingLayer = L.layerGroup().addTo(map);
  const pointLayer = L.layerGroup().addTo(map);
  const trackLayer = L.layerGroup().addTo(map);
  const recordPreviewLayer = L.layerGroup().addTo(map);

  let draft = null;
  let planViewActive = false;
  let drawingMode = false;
  let drawKind = 'ROUTE';
  let liveLine = null;
  let currentStroke = null;
  let pointerState = new Map();
  let gesture = null;
  let gestureUntilClear = false;
  let timerHandle = null;
  let pointAddressSearchToken = 0;

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
    })[ch]);
  }

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function toast(message) {
    const node = $('toast');
    if (!node) return;
    node.textContent = String(message || '');
    node.classList.add('show');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => node.classList.remove('show'), 1450);
  }

  function referencePoint(role = 'START') {
    const ref = S.reference();
    if (!ref) return null;
    return Plans.point({
      role,
      name: ref.type === 'GPS' ? '현위치' : ref.type === 'TEMP' ? '임시위치' : '마지막위치',
      coords:[Number(ref.lat),Number(ref.lon)],
      source:String(ref.type),
      capturedAt:Number(ref.at) || Date.now()
    }, role);
  }

  function explicitStatePoint(source, role) {
    let raw = null;
    if (source === 'TEMP' && S.state.temp) raw = {...S.state.temp,type:'TEMP'};
    if (source === 'LAST' && S.state.lastFix) raw = {...S.state.lastFix,type:'LAST'};
    if (!raw) return null;
    return Plans.point({
      role,
      name:source === 'TEMP' ? '임시위치' : '마지막위치',
      coords:[Number(raw.lat),Number(raw.lon)],
      source,
      capturedAt:Number(raw.at) || Date.now()
    }, role);
  }

  function reticlePoint(role) {
    const c = map.getCenter();
    return Plans.point({
      role,
      name:'지도 선택',
      coords:[c.lat,c.lng],
      source:'MAP',
      capturedAt:Date.now()
    }, role);
  }

  function sitePoint(site, role) {
    if (!site?.coords) return null;
    return Plans.point({
      role,
      name:site.name,
      coords:site.coords,
      source:site.source || 'SITE',
      siteId:site.id,
      capturedAt:Date.now()
    }, role);
  }

  function parseCoords(raw) {
    const text = String(raw || '').trim();
    const latlon = text.match(/^\s*(-?\d{1,2}(?:\.\d+)?)\s*[,\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/);
    if (latlon) {
      const lat = Number(latlon[1]);
      const lon = Number(latlon[2]);
      if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) return [lat,lon];
    }
    try {
      if (window.mgrs?.toPoint) {
        const point = window.mgrs.toPoint(text.toUpperCase().replace(/\s+/g,''));
        if (Array.isArray(point) && point.length >= 2) return [Number(point[1]),Number(point[0])];
      }
    } catch {}
    return null;
  }

  function formatMgrs(coords) {
    if (!Core.validCoords(coords)) return '--';
    if (App.formatMgrs) return App.formatMgrs({lat:coords[0],lon:coords[1]});
    return coords.map(n => Number(n).toFixed(5)).join(', ');
  }

  function uniqueAddressParts(parts) {
    const seen=new Set();
    return parts.filter(value => {
      const clean=String(value||'').trim();
      if(!clean||clean==='대한민국'||/^\d{5}$/.test(clean)||seen.has(clean))return false;
      seen.add(clean);return true;
    }).map(value=>String(value).trim());
  }

  function normalizeKoreanAddress(data,fallback='') {
    const a=data?.address||{};
    const province=a.state||a.province||a.region;
    const city=a.city||a.municipality;
    const district=a.city_district||a.borough||a.county;
    const locality=a.town||a.village||a.suburb||a.quarter||a.neighbourhood;
    const road=a.road||a.pedestrian||a.residential||a.path;
    const house=a.house_number;
    const building=a.building||a.amenity||a.shop||a.tourism;
    let parts=uniqueAddressParts([province,city,district]);
    if(road)parts=uniqueAddressParts([...parts,road,house]);
    else parts=uniqueAddressParts([...parts,locality,building]);
    if(parts.length>=2)return parts.join(' ');
    const display=String(data?.display_name||'').split(',').map(v=>v.trim()).filter(v=>v&&v!=='대한민국'&&!/^\d{5}$/.test(v));
    return display.length?display.reverse().join(' '):fallback;
  }

  function routeLabel() {
    if (!draft) return '';
    const start = draft.start?.name || '출발지';
    const dest = draft.destination?.name || '목적지';
    return draft.vias.length
      ? start + ' → 경유 ' + draft.vias.length + ' → ' + dest
      : start + ' → ' + dest;
  }

  function pointShort(point, fallback) {
    if (!point) return fallback;
    return point.name || point.source || fallback;
  }

  function mapPointIcon(role,index) {
    const label = role === 'START' ? 'S' : role === 'DEST' ? 'E' : String(index + 1);
    const cls = role === 'START' ? 'route-start-marker' : role === 'DEST' ? 'route-end-marker' : 'route-via-marker';
    return L.divIcon({
      className:'tactical-route-wrapper',
      html:'<span class="' + cls + '" data-label="' + label + '"></span>',
      iconSize:[26,26],
      iconAnchor:[13,13]
    });
  }

  function renderPlanMap() {
    routeLayer.clearLayers();
    drawingLayer.clearLayers();
    pointLayer.clearLayers();
    if (!draft || !planViewActive) return;

    const nodes = [];
    if (draft.start) nodes.push(draft.start.coords);
    draft.vias.forEach(v => nodes.push(v.coords));
    if (draft.destination) nodes.push(draft.destination.coords);

    if (nodes.length >= 2) {
      L.polyline(nodes,{
        interactive:false,
        className:'baseline-plan-path',
        color:'#9de3a4',
        weight:1.6,
        opacity:.7,
        dashArray:'7 7'
      }).addTo(routeLayer);
    }

    if (draft.start) {
      L.marker(draft.start.coords,{icon:mapPointIcon('START',0),interactive:false,zIndexOffset:420}).addTo(pointLayer);
    }
    draft.vias.forEach((via,index) => {
      L.marker(via.coords,{icon:mapPointIcon('VIA',index),interactive:false,zIndexOffset:430}).addTo(pointLayer);
    });
    if (draft.destination) {
      L.marker(draft.destination.coords,{icon:mapPointIcon('DEST',0),interactive:false,zIndexOffset:440}).addTo(pointLayer);
    }

    draft.drawings.forEach(seg => {
      if (!Array.isArray(seg.points) || seg.points.length < 2) return;
      L.polyline(seg.points,{
        interactive:false,
        className:'baseline-plan-drawing',
        color:'#9de3a4',
        weight:2,
        opacity:seg.kind === 'MARK' ? .9 : .78,
        dashArray:seg.kind === 'MARK' ? null : '8 6'
      }).addTo(drawingLayer);
    });
  }

  function metricText(bundle) {
    if (!bundle) return '--';
    const dist = bundle.distanceKm < 1
      ? Math.round(bundle.distanceKm * 1000) + ' M'
      : bundle.distanceKm.toFixed(bundle.distanceKm < 10 ? 2 : 1) + ' KM';
    const mag = Number.isFinite(bundle.magneticBearing)
      ? String(Math.round(bundle.magneticBearing)).padStart(3,'0') + '° 자북'
      : '-- 자북';
    const grid = Number.isFinite(bundle.gridBearing)
      ? String(Math.round(bundle.gridBearing)).padStart(3,'0') + '° 도북'
      : '-- 도북';
    return dist + ' · ' + grid + ' · ' + mag;
  }

  function nextTarget() {
    if (!draft) return null;
    return draft.vias[0] || draft.destination || null;
  }

  function renderHud() {
    const summary = $('navRouteSummary');
    const hud = $('navigationHud');
    const controls = $('navSessionControls');
    const visible=Boolean(draft && planViewActive);
    document.body.classList.toggle('baseline-navigation-active',visible);
    if (!visible) {
      if (summary) summary.hidden = true;
      if (hud) hud.hidden = true;
      if (controls) controls.hidden = true;
      return;
    }

    summary.hidden = false;
    $('navRouteText').textContent = routeLabel();

    if (!draft.destination) {
      hud.hidden = true;
      renderSessionControls();
      return;
    }

    hud.hidden = false;
    const ref = S.reference();
    const nowCoords = ref ? [Number(ref.lat),Number(ref.lon)] : null;
    const dest = draft.destination.coords;
    const start = draft.start?.coords || null;
    const nowBundle = nowCoords ? Core.bearingBundle(nowCoords,dest) : null;
    const startBundle = start ? Core.bearingBundle(start,dest) : null;
    $('navNowMetric').textContent = metricText(nowBundle);
    $('navStartMetric').textContent = metricText(startBundle);
    const nextBlock = $('navNextBlock');
    if (nextBlock) nextBlock.hidden = true;

    const gm = nowBundle?.gridMagneticAngle;
    $('navDeclination').textContent = Number.isFinite(gm)
      ? '도자각 ' + (gm < 0 ? 'W ' : gm > 0 ? 'E ' : '') + Math.abs(gm).toFixed(1) + '° · WMM2025'
      : '도자각 --';

    renderTimer();
    renderSessionControls();
  }

  function trackSegments(track) {
    const groups = new Map();
    (track?.points || []).forEach(point => {
      const key = Number.isInteger(point.segment) ? point.segment : 0;
      if (!groups.has(key)) groups.set(key,[]);
      groups.get(key).push(point);
    });
    return [...groups.values()].filter(points => points.length > 0);
  }

  function renderActiveTrack() {
    trackLayer.clearLayers();
    const session=Records.getActive();
    if (!session?.track?.points?.length) return;
    trackSegments(session.track).forEach(segment => {
      if (segment.length < 2) return;
      L.polyline(segment.map(p => [p.lat,p.lon]),{
        interactive:false,
        className:'baseline-track-path',
        color:'#22ff66',
        weight:2.5,
        opacity:.92
      }).addTo(trackLayer);
    });
  }

  function currentGpsTrackPoint() {
    const fix=S.state.gps.fix;
    if (!S.state.gps.enabled || !fix) return null;
    return {
      lat:Number(fix.lat),
      lon:Number(fix.lon),
      at:Number(fix.at)||Date.now(),
      accuracy:Number.isFinite(Number(fix.accuracy))?Number(fix.accuracy):null,
      altitude:Number.isFinite(Number(fix.altitude))?Number(fix.altitude):null
    };
  }

  function routeChanged(reason = 'ROUTE_UPDATED') {
    renderPlanMap();
    renderActiveTrack();
    renderHud();
    const active = Records.getActive();
    if (active) Records.routeUpdated(draft);
    window.dispatchEvent(new CustomEvent('baseline-navigation-change',{detail:{reason,draft:clone(draft)}}));
  }

  function newDraft() {
    planViewActive = true;
    draft = Plans.createDraft(referencePoint('START'));
    renderPlanMap();
    renderHud();
    openEditor();
  }

  function loadPlan(id) {
    const plan = Plans.get(id);
    if (!plan) {
      toast('계획을 불러올 수 없음');
      return;
    }
    planViewActive = true;
    draft = Plans.normalize(plan);
    renderPlanMap();
    renderHud();
    App.closeSheet();
    toast('계획 불러옴');
  }

  function saveCurrent(forceAs = false) {
    if (!draft) return null;
    const input = $('planNameInput');
    if (input) draft.name = input.value.trim();
    if (!draft.name) {
      openEditor();
      setTimeout(() => $('planNameInput')?.focus(),0);
      toast('계획 이름 필요');
      return null;
    }
    const saved = forceAs ? Plans.saveAs(draft,draft.name) : Plans.save(draft,draft.name);
    if (!saved) {
      toast('계획 저장 실패');
      return null;
    }
    draft = saved;
    renderHud();
    toast(forceAs ? '다른 이름으로 저장' : '계획 저장');
    return saved;
  }

  function pointRowsHtml() {
    if (!draft) return '';
    const viaRows = draft.vias.map((via,index) =>
      '<div class="plan-route-row">' +
        '<span>경유 ' + (index + 1) + '</span>' +
        '<button type="button" data-edit-point="VIA" data-via-index="' + index + '">' + esc(pointShort(via,'선택')) + '</button>' +
        '<div class="plan-row-tools">' +
          '<button type="button" data-via-up="' + index + '" ' + (index === 0 ? 'disabled' : '') + '>↑</button>' +
          '<button type="button" data-via-down="' + index + '" ' + (index === draft.vias.length - 1 ? 'disabled' : '') + '>↓</button>' +
          '<button type="button" data-via-delete="' + index + '">×</button>' +
        '</div>' +
      '</div>'
    ).join('');

    return '<div class="plan-route-row">' +
        '<span>출발지</span><button type="button" data-edit-point="START">' + esc(pointShort(draft.start,'선택')) + '</button>' +
      '</div>' +
      viaRows +
      '<button class="plan-add-via" type="button" id="planAddVia">+ 경유지 추가</button>' +
      '<div class="plan-route-row">' +
        '<span>목적지</span><button type="button" data-edit-point="DEST">' + esc(pointShort(draft.destination,'선택')) + '</button>' +
      '</div>';
  }

  function editorHtml() {
    return '<div class="plan-editor">' +
      '<label class="plan-name"><span>계획 이름</span><input id="planNameInput" type="text" maxlength="120" value="' + esc(draft?.name || '') + '" placeholder="계획 이름"></label>' +
      '<div class="plan-route-stack">' + pointRowsHtml() + '</div>' +
      '<div class="plan-editor-actions">' +
        '<button type="button" id="planEditorSave">저장</button>' +
        '<button type="button" id="planEditorConfirm" class="primary">확인</button>' +
      '</div>' +
    '</div>';
  }

  function bindEditor() {
    $('planNameInput')?.addEventListener('input',e => {
      if (draft) draft.name = e.target.value;
    });

    document.querySelectorAll('[data-edit-point]').forEach(btn => {
      btn.addEventListener('click',() => {
        const role = btn.dataset.editPoint;
        const index = role === 'VIA' ? Number(btn.dataset.viaIndex) : null;
        openPointPicker(role,index);
      });
    });

    $('planAddVia')?.addEventListener('click',() => {
      draft.vias.push(null);
      draft.vias = draft.vias.filter(Boolean);
      openPointPicker('VIA',draft.vias.length);
    });

    document.querySelectorAll('[data-via-up]').forEach(btn => {
      btn.addEventListener('click',() => {
        const i=Number(btn.dataset.viaUp);
        if (i <= 0 || i >= draft.vias.length) return;
        [draft.vias[i-1],draft.vias[i]]=[draft.vias[i],draft.vias[i-1]];
        routeChanged('VIA_REORDER');
        openEditor();
      });
    });
    document.querySelectorAll('[data-via-down]').forEach(btn => {
      btn.addEventListener('click',() => {
        const i=Number(btn.dataset.viaDown);
        if (i < 0 || i >= draft.vias.length-1) return;
        [draft.vias[i+1],draft.vias[i]]=[draft.vias[i],draft.vias[i+1]];
        routeChanged('VIA_REORDER');
        openEditor();
      });
    });
    document.querySelectorAll('[data-via-delete]').forEach(btn => {
      btn.addEventListener('click',() => {
        const i=Number(btn.dataset.viaDelete);
        draft.vias.splice(i,1);
        routeChanged('VIA_DELETE');
        openEditor();
      });
    });

    $('planEditorSave')?.addEventListener('click',() => saveCurrent(false));
    $('planEditorConfirm')?.addEventListener('click',() => {
      if ($('planNameInput')) draft.name = $('planNameInput').value.trim();
      if (!draft.start) draft.start=referencePoint('START');
      if (!draft.start) return toast('출발지 기준 위치 필요');
      if (!draft.destination) return toast('목적지 선택 필요');
      routeChanged('PLAN_CONFIRM');
      App.closeSheet();
    });
  }

  function openEditor() {
    planViewActive = true;
    if (!draft) {
      newDraft();
      return;
    }
    App.openSheet('plans',{title:'계획 편집',html:editorHtml()});
    bindEditor();
  }

  function setPoint(role,index,point) {
    if (!draft || !point) return;
    if (role === 'START') draft.start = Plans.point(point,'START');
    else if (role === 'DEST') draft.destination = Plans.point(point,'DEST');
    else {
      const normalized = Plans.point(point,'VIA');
      if (Number.isInteger(index) && index >= 0 && index < draft.vias.length) draft.vias[index] = normalized;
      else draft.vias.push(normalized);
    }
    routeChanged('POINT_SET');
    openEditor();
  }

  function pointPickerHtml(role,index) {
    const current = referencePoint(role);
    const temp = explicitStatePoint('TEMP',role);
    const last = explicitStatePoint('LAST',role);
    const allSites = [...Sites.getRegistered(),...Sites.getUserSites()];

    const siteOptions = allSites.map(site =>
      '<option value="' + esc(site.id) + '">' + esc(site.name) + '</option>'
    ).join('');

    const random = role === 'DEST'
      ? '<div class="point-picker-random"><button type="button" id="pointRandomRegistered">무작위 등록</button><button type="button" id="pointRandomWild">무작위 미개척</button></div>'
      : '';

    return '<div class="point-picker">' +
      '<div class="point-picker-grid">' +
        '<button type="button" data-point-source="CURRENT" ' + (current ? '' : 'disabled') + '>현재 기준<span>' + esc(current?.name || '없음') + '</span></button>' +
        '<button type="button" data-point-source="TEMP" ' + (temp ? '' : 'disabled') + '>임시위치<span>' + (temp ? formatMgrs(temp.coords) : '없음') + '</span></button>' +
        '<button type="button" data-point-source="LAST" ' + (last ? '' : 'disabled') + '>마지막위치<span>' + (last ? formatMgrs(last.coords) : '없음') + '</span></button>' +
        '<button type="button" data-point-source="MAP">지도 조준점<span>' + formatMgrs(reticlePoint(role).coords) + '</span></button>' +
      '</div>' +
      '<div class="point-picker-address"><input id="pointAddressInput" type="search" autocomplete="street-address" placeholder="주소 검색 (온라인)"><button type="button" id="pointAddressSearch">검색</button></div>' +
      '<div class="point-address-results" id="pointAddressResults"></div>' +
      '<div class="point-picker-coord"><input id="pointCoordInput" type="text" placeholder="MGRS 또는 위도, 경도"><button type="button" id="pointCoordUse">좌표 사용</button></div>' +
      '<div class="point-picker-site"><select id="pointSiteSelect"><option value="">거점 선택</option>' + siteOptions + '</select><button type="button" id="pointSiteUse">거점 사용</button></div>' +
      random +
      '<button type="button" class="point-picker-back" id="pointPickerBack">취소</button>' +
    '</div>';
  }

  function openPointPicker(role,index = null) {
    App.openSheet('plans',{title:(role === 'START' ? '출발지' : role === 'DEST' ? '목적지' : '경유지') + ' 선택',html:pointPickerHtml(role,index)});

    document.querySelectorAll('[data-point-source]').forEach(btn => {
      btn.addEventListener('click',() => {
        let point = null;
        if (btn.dataset.pointSource === 'CURRENT') point = referencePoint(role);
        if (btn.dataset.pointSource === 'TEMP') point = explicitStatePoint('TEMP',role);
        if (btn.dataset.pointSource === 'LAST') point = explicitStatePoint('LAST',role);
        if (btn.dataset.pointSource === 'MAP') point = reticlePoint(role);
        if (point) setPoint(role,index,point);
      });
    });

    const runAddressSearch=async() => {
      const input=$('pointAddressInput');
      const results=$('pointAddressResults');
      const button=$('pointAddressSearch');
      const query=String(input?.value||'').trim();
      if(!query){input?.focus();return;}
      if(!navigator.onLine){
        if(results)results.innerHTML='<div class="point-address-empty">OFFLINE · 주소 검색은 네트워크가 필요합니다.</div>';
        return;
      }
      const token=++pointAddressSearchToken;
      if(button)button.disabled=true;
      if(results)results.innerHTML='<div class="point-address-empty">SEARCHING...</div>';
      try{
        const url='https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=kr&limit=6&addressdetails=1&accept-language=ko&q='+encodeURIComponent(query);
        const res=await fetch(url,{headers:{Accept:'application/json'}});
        if(!res.ok)throw new Error('search failed');
        const data=await res.json();
        if(token!==pointAddressSearchToken)return;
        if(!Array.isArray(data)||!data.length){
          results.innerHTML='<div class="point-address-empty">검색 결과 없음</div>';return;
        }
        results.innerHTML=data.map((row,i)=>{
          const lat=Number(row.lat),lon=Number(row.lon);
          if(!Number.isFinite(lat)||!Number.isFinite(lon))return '';
          const address=normalizeKoreanAddress(row,row.display_name||query);
          return '<button type="button" data-address-result="'+i+'"><strong>'+esc(address||query)+'</strong><span>'+lat.toFixed(5)+', '+lon.toFixed(5)+' · '+esc(formatMgrs([lat,lon]))+'</span></button>';
        }).join('');
        results.querySelectorAll('[data-address-result]').forEach(btn=>btn.addEventListener('click',()=>{
          const row=data[Number(btn.dataset.addressResult)];
          const lat=Number(row?.lat),lon=Number(row?.lon);
          if(!Number.isFinite(lat)||!Number.isFinite(lon))return;
          const address=normalizeKoreanAddress(row,row.display_name||query);
          setPoint(role,index,Plans.point({role,name:address||query,address:address||row.display_name||query,coords:[lat,lon],source:'ADDRESS'},role));
        }));
      }catch(error){
        if(token!==pointAddressSearchToken)return;
        if(results)results.innerHTML='<div class="point-address-empty">주소 검색 실패 · 좌표/MGRS는 오프라인 사용 가능</div>';
      }finally{
        if(button&&token===pointAddressSearchToken)button.disabled=false;
      }
    };
    $('pointAddressSearch')?.addEventListener('click',runAddressSearch);
    $('pointAddressInput')?.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();runAddressSearch();}});

    $('pointCoordUse')?.addEventListener('click',() => {
      const coords = parseCoords($('pointCoordInput')?.value);
      if (!coords) {
        toast('좌표 확인 필요');
        return;
      }
      setPoint(role,index,Plans.point({role,name:'좌표 지정',coords,source:'COORD'},role));
    });

    $('pointSiteUse')?.addEventListener('click',() => {
      const site = Sites.find($('pointSiteSelect')?.value);
      if (!site) {
        toast('거점 선택 필요');
        return;
      }
      setPoint(role,index,sitePoint(site,role));
    });

    $('pointRandomRegistered')?.addEventListener('click',() => {
      const pool = Sites.getRegistered().filter(site => site.status !== 'SECURED');
      const site = Explore.randomRegistered(pool,'all',null);
      if (!site) return toast('등록 거점 없음');
      setPoint(role,index,sitePoint(site,role));
    });

    $('pointRandomWild')?.addEventListener('click',() => {
      const wild = Explore.randomWild('all',null);
      const saved = wild ? Sites.addUserSite(wild) : null;
      if (!saved) return toast('미개척 생성 실패');
      setPoint(role,index,sitePoint(saved,role));
    });

    $('pointPickerBack')?.addEventListener('click',openEditor);
  }

  function plansLibraryHtml() {
    const plans = Plans.list();
    const current = draft
      ? '<button type="button" class="plan-current" id="planContinueBtn"><strong>현재 계획 계속</strong><span>' + esc(routeLabel() || draft.name || '저장 전 계획') + '</span></button>'
      : '';
    const rows = plans.length ? plans.map(plan =>
      '<div class="plan-library-row">' +
        '<button type="button" class="plan-open" data-plan-open="' + esc(plan.id) + '">' +
          '<strong>' + esc(plan.name) + '</strong>' +
          '<span>' + esc(pointShort(plan.start,'출발')) + ' → ' + esc(pointShort(plan.destination,'목적지')) + ' · 경유 ' + plan.vias.length + '</span>' +
        '</button>' +
        '<button type="button" data-plan-share="' + esc(plan.id) + '">공유</button>' +
        '<button type="button" data-plan-delete="' + esc(plan.id) + '">삭제</button>' +
      '</div>'
    ).join('') : '<div class="site-empty">저장된 계획 없음</div>';

    return '<div class="plan-library-actions">' +
        '<button type="button" id="planNewBtn">새 계획</button>' +
        '<button type="button" id="planImportBtn">가져오기</button>' +
        '<input id="planImportFile" type="file" accept=".reconplan,application/json" hidden>' +
      '</div>' +
      current +
      '<div class="plan-library">' + rows + '</div>';
  }

  function downloadBlob(name,text) {
    const blob = new Blob([text],{type:'application/json'});
    const url = URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url;
    a.download=name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url),1000);
  }

  async function sharePlan(plan) {
    if (!plan) return;
    const payload = JSON.stringify(Plans.exportPayload(plan),null,2);
    const filename = (plan.name || 'TACTICAL_RECON_PLAN').replace(/[\\/:*?"<>|]/g,'_') + '.reconplan';
    try {
      const file = new File([payload],filename,{type:'application/json'});
      if (navigator.share && navigator.canShare?.({files:[file]})) {
        await navigator.share({files:[file],title:plan.name});
        return;
      }
    } catch {}
    downloadBlob(filename,payload);
  }

  function bindPlanLibrary() {
    $('planContinueBtn')?.addEventListener('click',() => {
      planViewActive=true;
      renderPlanMap();
      renderHud();
      App.closeSheet();
    });
    $('planNewBtn')?.addEventListener('click',newDraft);
    $('planImportBtn')?.addEventListener('click',() => $('planImportFile')?.click());
    $('planImportFile')?.addEventListener('change',async e => {
      const file=e.target.files?.[0];
      if (!file) return;
      try {
        const payload=JSON.parse(await file.text());
        const imported=Plans.importPayload(payload);
        if (!imported) throw new Error('invalid');
        planViewActive=true;
        draft=imported;
        renderPlanMap();
        renderHud();
        openEditor();
        toast('계획 가져옴');
      } catch {
        toast('계획 파일 확인 필요');
      }
    });

    document.querySelectorAll('[data-plan-open]').forEach(btn => btn.addEventListener('click',() => loadPlan(btn.dataset.planOpen)));
    document.querySelectorAll('[data-plan-share]').forEach(btn => btn.addEventListener('click',() => sharePlan(Plans.get(btn.dataset.planShare))));
    document.querySelectorAll('[data-plan-delete]').forEach(btn => btn.addEventListener('click',() => {
      const plan=Plans.get(btn.dataset.planDelete);
      if (!plan) return;
      if (!confirm('"' + plan.name + '" 계획을 삭제할까요?')) return;
      Plans.remove(plan.id);
      openPlans();
    }));
  }

  function setDestinationFromSite(site) {
    const point = sitePoint(site,'DEST');
    if (!point) return false;
    if (!draft) draft = Plans.createDraft(referencePoint('START'));
    planViewActive = true;
    draft.destination = point;
    routeChanged('DEST_FROM_SITE');
    openEditor();
    toast('목적지 설정');
    return true;
  }

  function openPlans() {
    App.openSheet('plans',{title:'계획',html:plansLibraryHtml()});
    bindPlanLibrary();
  }

  function sessionState() {
    return Records.getActive();
  }

  function formatDuration(ms) {
    const total=Math.max(0,Math.floor(Number(ms || 0)/1000));
    const h=Math.floor(total/3600);
    const m=Math.floor((total%3600)/60);
    const s=total%60;
    return [h,m,s].map(v=>String(v).padStart(2,'0')).join(':');
  }

  function renderTimer() {
    const session=sessionState();
    const node=$('navTimer');
    if (!node) return;
    if (!session) {
      node.hidden=true;
      node.textContent='00:00:00';
      return;
    }
    node.hidden=false;
    node.textContent=formatDuration(Records.elapsedMs(session));
  }

  function currentReferenceSnapshot() {
    const ref=S.reference();
    if (!ref) return null;
    return {
      type:String(ref.type),
      coords:[Number(ref.lat),Number(ref.lon)],
      at:Number(ref.at)||Date.now(),
      accuracy:Number.isFinite(Number(ref.accuracy))?Number(ref.accuracy):null,
      mgrs:formatMgrs([Number(ref.lat),Number(ref.lon)])
    };
  }

  function startSession() {
    if (!draft?.destination) return toast('목적지 필요');
    if (!draft.start) {
      draft.start=referencePoint('START');
      if (!draft.start) return toast('출발지 필요');
    }
    const session=Records.start(draft);
    if (!session) return toast('항법 시작 실패');
    const gpsPoint=currentGpsTrackPoint();
    if (gpsPoint) Records.addTrackPoint(gpsPoint);
    renderActiveTrack();
    renderHud();
    toast('항법 시작');
  }

  function togglePause() {
    const session=sessionState();
    if (!session) return;
    if (session.status === 'RUNNING') {
      const gpsPoint=currentGpsTrackPoint();
      if (gpsPoint) Records.addTrackPoint(gpsPoint);
      Records.pause();
      toast('일시정지');
    } else if (session.status === 'PAUSED') {
      Records.resume();
      const gpsPoint=currentGpsTrackPoint();
      if (gpsPoint) Records.addTrackPoint(gpsPoint);
      toast('재개');
    }
    renderActiveTrack();
    renderHud();
  }

  function addLap() {
    const session=sessionState();
    if (!session) return;
    const lap=Records.lap(currentReferenceSnapshot());
    if (lap) toast('LAP ' + lap.index + ' 기록');
    renderHud();
  }

  function stopSession() {
    if (!sessionState()) return;
    if (!confirm('항법을 종료하고 기록으로 저장할까요?')) return;
    const gpsPoint=currentGpsTrackPoint();
    if (gpsPoint) Records.addTrackPoint(gpsPoint);
    const record=Records.finish(draft);
    renderActiveTrack();
    renderHud();
    toast(record ? '항법 기록 저장' : '종료 실패');
  }

  function closePlanView() {
    if (sessionState()) return toast('항법 종료 후 계획을 닫을 수 있음');
    planViewActive=false;
    renderPlanMap();
    renderHud();
    App.closeSheet();
    toast('계획 닫음');
  }

  function renderSessionControls() {
    const node=$('navSessionControls');
    if (!node) return;
    if (!draft || !$('sheet')?.hidden || drawingMode) {
      node.hidden=true;
      return;
    }
    node.hidden=false;
    const session=sessionState();
    if (!session) {
      node.innerHTML='<button type="button" data-nav-action="CLOSE">계획 닫기</button><button type="button" data-nav-action="DRAW">드로잉</button><button type="button" data-nav-action="SAVE">저장</button><button type="button" class="primary" data-nav-action="START">항법 시작</button>';
    } else if (session.status === 'PAUSED') {
      node.innerHTML='<button type="button" data-nav-action="DRAW">드로잉</button><button type="button" class="primary" data-nav-action="PAUSE">재개</button><button type="button" data-nav-action="LAP">LAP</button><button type="button" data-nav-action="STOP">항법 종료</button>';
    } else {
      node.innerHTML='<button type="button" data-nav-action="DRAW">드로잉</button><button type="button" class="primary" data-nav-action="PAUSE">일시정지</button><button type="button" data-nav-action="LAP">LAP</button><button type="button" data-nav-action="STOP">항법 종료</button>';
    }
    node.querySelectorAll('[data-nav-action]').forEach(btn => btn.addEventListener('click',() => {
      const action=btn.dataset.navAction;
      if (action === 'CLOSE') closePlanView();
      if (action === 'DRAW') enterDrawing();
      if (action === 'SAVE') saveCurrent(false);
      if (action === 'START') startSession();
      if (action === 'PAUSE') togglePause();
      if (action === 'LAP') addLap();
      if (action === 'STOP') stopSession();
    }));
  }

  function recordDateLabel(value) {
    const date=new Date(Number(value));
    if(Number.isNaN(date.getTime())) return '--';
    const pad=n=>String(n).padStart(2,'0');
    return date.getFullYear() + '.' + pad(date.getMonth()+1) + '.' + pad(date.getDate()) + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
  }

  function recordsHtml() {
    const records=Records.list();
    if (!records.length) return '<div class="site-empty">항법 기록 없음</div>';
    return '<div class="record-list">' + records.map(record =>
      '<button type="button" class="record-row" data-record-id="' + esc(record.id) + '">' +
        '<strong>' + esc(record.name) + '</strong>' +
        '<span>' + recordDateLabel(record.startedAt) + ' · ' + formatDuration(record.elapsedMs) + ' · LAP ' + record.laps.length + ' · 궤적 ' + ((Number(record.track?.distanceMeters)||0)/1000).toFixed(2) + ' km</span>' +
      '</button>'
    ).join('') + '</div>';
  }

  function openRecords() {
    App.openSheet('records',{title:'기록',html:recordsHtml()});
    document.querySelectorAll('[data-record-id]').forEach(btn => btn.addEventListener('click',() => openRecordDetail(btn.dataset.recordId)));
  }

  function openRecordDetail(id) {
    const record=Records.get(id);
    if (!record) return;
    const plan=record.finalPlan || record.initialPlan || {};
    const laps=record.laps.length ? record.laps.map(lap =>
      '<div class="record-lap"><b>LAP ' + lap.index + '</b><span>' + formatDuration(lap.elapsedMs) + (lap.reference?.mgrs ? ' · ' + esc(lap.reference.mgrs) : '') + '</span></div>'
    ).join('') : '<div class="site-empty">LAP 없음</div>';

    const pauseMs=Math.max(0,(record.endedAt-record.startedAt)-record.elapsedMs);
    const trackPoints=record.track?.points?.length || 0;
    const trackDistance=Math.max(0,Number(record.track?.distanceMeters)||0);
    App.openSheet('records',{
      title:'기록 상세',
      html:'<div class="record-detail">' +
        '<strong>' + esc(record.name) + '</strong>' +
        '<div class="record-summary">' +
          '<span>출발</span><b>' + esc(pointShort(plan.start,'--')) + '</b>' +
          '<span>목적지</span><b>' + esc(pointShort(plan.destination,'--')) + '</b>' +
          '<span>운용시간</span><b>' + formatDuration(record.elapsedMs) + '</b>' +
          '<span>정지시간</span><b>' + formatDuration(pauseMs) + '</b>' +
          '<span>LAP</span><b>' + record.laps.length + '</b>' +
          '<span>궤적</span><b>' + (trackDistance/1000).toFixed(2) + ' km · ' + trackPoints + ' 지점</b>' +
        '</div>' +
        '<div class="record-laps">' + laps + '</div>' +
        '<div class="record-actions">' +
          '<button class="record-map-btn" id="recordMapView" type="button">지도에서 보기</button>' +
          '<button class="record-delete-btn" id="recordDeleteBtn" type="button">삭제</button>' +
        '</div>' +
      '</div>'
    });

    $('recordDeleteBtn')?.addEventListener('click',() => {
      if(!confirm('이 기록을 삭제할까요?')) return;
      if(Records.remove(record.id)){
        recordPreviewLayer.clearLayers();
        toast('기록 삭제');
        openRecords();
      }
    });

    $('recordMapView')?.addEventListener('click',() => {
      recordPreviewLayer.clearLayers();
      const planNodes=[];
      if (plan.start?.coords) planNodes.push(plan.start.coords);
      (plan.vias || []).forEach(v => { if (v?.coords) planNodes.push(v.coords); });
      if (plan.destination?.coords) planNodes.push(plan.destination.coords);

      if (planNodes.length >= 2) {
        L.polyline(planNodes,{
          interactive:false,
          color:'#9de3a4',
          weight:1.5,
          opacity:.55,
          dashArray:'7 7'
        }).addTo(recordPreviewLayer);
      }

      trackSegments(record.track).forEach(segment => {
        if (segment.length < 2) return;
        L.polyline(segment.map(p => [p.lat,p.lon]),{
          interactive:false,
          color:'#22ff66',
          weight:2.7,
          opacity:.95
        }).addTo(recordPreviewLayer);
      });

      (record.laps || []).forEach(lap => {
        const coords=lap.reference?.coords;
        if (!Core.validCoords(coords)) return;
        L.circleMarker(coords,{
          radius:4,
          color:'#9de3a4',
          weight:1.2,
          fillColor:'#020904',
          fillOpacity:.8,
          interactive:false
        }).addTo(recordPreviewLayer);
      });

      const allPoints=[
        ...planNodes,
        ...(record.track?.points || []).map(p => [p.lat,p.lon]),
        ...(record.laps || []).map(l => l.reference?.coords).filter(coords => Core.validCoords(coords))
      ];
      if (allPoints.length >= 2) {
        map.fitBounds(L.latLngBounds(allPoints),{padding:[48,72],maxZoom:16,animate:false});
      } else if (allPoints.length === 1) {
        map.setView(allPoints[0],16,{animate:false});
      }
      App.closeSheet();
      toast('기록 경로 표시');
    });
  }

  function drawLatLng(event) {
    const rect=$('drawingCapture').getBoundingClientRect();
    return map.containerPointToLatLng([event.clientX-rect.left,event.clientY-rect.top]);
  }

  function renderLiveStroke() {
    if (liveLine) {
      liveLine.remove();
      liveLine=null;
    }
    if (!currentStroke || currentStroke.length < 2) return;
    liveLine=L.polyline(currentStroke,{
      interactive:false,
      color:'#9de3a4',
      weight:2,
      opacity:.95,
      dashArray:drawKind === 'ROUTE' ? '8 6' : null
    }).addTo(drawingLayer);
  }

  function commitStroke() {
    if (!draft || !currentStroke || currentStroke.length < 2) {
      currentStroke=null;
      renderLiveStroke();
      return;
    }
    const seg=Plans.drawing({kind:drawKind,points:currentStroke});
    if (seg) draft.drawings.push(seg);
    currentStroke=null;
    if (liveLine) { liveLine.remove(); liveLine=null; }
    routeChanged('DRAWING');
  }

  function midpoint(a,b) {
    return {x:(a.x+b.x)/2,y:(a.y+b.y)/2};
  }
  function distance(a,b) {
    return Math.hypot(a.x-b.x,a.y-b.y);
  }

  function bindDrawingCapture() {
    const capture=$('drawingCapture');
    if (!capture || capture.dataset.bound === '1') return;
    capture.dataset.bound='1';

    capture.addEventListener('pointerdown',event => {
      if (!drawingMode) return;
      try { capture.setPointerCapture?.(event.pointerId); } catch {}
      pointerState.set(event.pointerId,{x:event.clientX,y:event.clientY});

      if (pointerState.size === 1 && !gestureUntilClear) {
        const ll=drawLatLng(event);
        currentStroke=[[ll.lat,ll.lng]];
        renderLiveStroke();
      } else if (pointerState.size >= 2) {
        currentStroke=null;
        if (liveLine) { liveLine.remove(); liveLine=null; }
        gestureUntilClear=true;
        const pts=[...pointerState.values()].slice(0,2);
        gesture={mid:midpoint(pts[0],pts[1]),dist:Math.max(1,distance(pts[0],pts[1])),zoom:map.getZoom()};
      }
      event.preventDefault();
    },{passive:false});

    capture.addEventListener('pointermove',event => {
      if (!drawingMode || !pointerState.has(event.pointerId)) return;
      pointerState.set(event.pointerId,{x:event.clientX,y:event.clientY});

      if (pointerState.size >= 2) {
        const pts=[...pointerState.values()].slice(0,2);
        const nextMid=midpoint(pts[0],pts[1]);
        const nextDist=Math.max(1,distance(pts[0],pts[1]));
        if (gesture) {
          map.panBy([gesture.mid.x-nextMid.x,gesture.mid.y-nextMid.y],{animate:false});
          const ratio=nextDist/gesture.dist;
          if (ratio > 1.08 || ratio < .92) {
            const rect=capture.getBoundingClientRect();
            const point=L.point(nextMid.x-rect.left,nextMid.y-rect.top);
            const zoom=Math.max(map.getMinZoom(),Math.min(map.getMaxZoom(),map.getZoom()+Math.log2(ratio)));
            map.setZoomAround(point,zoom,{animate:false});
            gesture.dist=nextDist;
          }
          gesture.mid=nextMid;
        }
      } else if (!gestureUntilClear && currentStroke) {
        const ll=drawLatLng(event);
        const point=[ll.lat,ll.lng];
        const last=currentStroke[currentStroke.length-1];
        if (!last || map.distance(last,point) > 2) {
          currentStroke.push(point);
          renderLiveStroke();
        }
      }
      event.preventDefault();
    },{passive:false});

    const end=event => {
      if (!pointerState.has(event.pointerId)) return;
      pointerState.delete(event.pointerId);
      if (!gestureUntilClear && pointerState.size === 0) commitStroke();
      if (gestureUntilClear && pointerState.size === 0) {
        gestureUntilClear=false;
        gesture=null;
        currentStroke=null;
      }
      event.preventDefault();
    };
    capture.addEventListener('pointerup',end,{passive:false});
    capture.addEventListener('pointercancel',end,{passive:false});
    capture.addEventListener('contextmenu',event => event.preventDefault());
  }

  function enterDrawing() {
    if (!draft) return;
    drawingMode=true;
    $('drawingCapture').hidden=false;
    $('drawingControls').hidden=false;
    $('navSessionControls').hidden=true;
    document.body.classList.add('baseline-drawing');
    bindDrawingCapture();
    syncDrawButtons();
    toast('한 손가락 그리기 · 두 손가락 지도 이동');
  }

  function exitDrawing() {
    if (!drawingMode) return;
    if (currentStroke?.length >= 2) commitStroke();
    drawingMode=false;
    pointerState.clear();
    currentStroke=null;
    gesture=null;
    gestureUntilClear=false;
    if (liveLine) { liveLine.remove(); liveLine=null; }
    $('drawingCapture').hidden=true;
    $('drawingControls').hidden=true;
    document.body.classList.remove('baseline-drawing');
    renderSessionControls();
  }

  function syncDrawButtons() {
    document.querySelectorAll('[data-draw-kind]').forEach(btn => {
      btn.classList.toggle('active',btn.dataset.drawKind === drawKind);
    });
  }

  document.querySelectorAll('[data-draw-kind]').forEach(btn => btn.addEventListener('click',() => {
    drawKind=btn.dataset.drawKind === 'MARK' ? 'MARK' : 'ROUTE';
    syncDrawButtons();
  }));
  $('drawUndoBtn')?.addEventListener('click',() => {
    if (!draft?.drawings.length) return toast('되돌릴 드로잉 없음');
    draft.drawings.pop();
    routeChanged('DRAW_UNDO');
  });
  $('drawDoneBtn')?.addEventListener('click',exitDrawing);
  $('navRouteSummary')?.addEventListener('click',openEditor);

  window.addEventListener('baseline-state-change',event => {
    if (event.detail?.reason === 'gps-fix') {
      const session=Records.getActive();
      if (session?.status === 'RUNNING') {
        const point=currentGpsTrackPoint();
        if (point) Records.addTrackPoint(point);
      }
    }
    renderHud();
  });
  window.addEventListener('baseline-session-change',() => {
    renderActiveTrack();
    renderHud();
  });
  window.addEventListener('baseline-plans-change',() => {
    if (S.state.activePanel === 'plans' && $('sheetTitle')?.textContent === '계획') openPlans();
  });
  window.addEventListener('baseline-records-change',() => {
    if (S.state.activePanel === 'records' && $('sheetTitle')?.textContent === '기록') openRecords();
  });

  function restoreActiveSession() {
    const active=Records.getActive();
    if (!active) return false;
    planViewActive=true;
    draft=Plans.normalize(active.finalPlan || active.initialPlan || {});
    renderPlanMap();
    renderActiveTrack();
    renderHud();
    toast(active.status === 'PAUSED' ? '일시정지 항법 복구' : '진행 중 항법 복구');
    return true;
  }

  timerHandle=setInterval(() => {
    if (Records.getActive()) renderTimer();
  },1000);

  window.BaselineNavigationUI=Object.freeze({
    openPlans,
    openEditor,
    openRecords,
    newDraft,
    loadPlan,
    getDraft:() => clone(draft),
    enterDrawing,
    exitDrawing,
    saveCurrent,
    startSession,
    setDestinationFromSite,
    closePlanView,
    trackLayer,
    recordPreviewLayer
  });

  restoreActiveSession();
})();
