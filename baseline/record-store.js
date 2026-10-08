(() => {
  'use strict';

  const KEY = 'tr_baseline_records_v1';
  const ACTIVE_KEY = 'tr_baseline_active_session_v1';

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function readRecords() {
    try {
      const value = JSON.parse(localStorage.getItem(KEY) || '[]');
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  }

  function readActive() {
    try {
      const value = JSON.parse(localStorage.getItem(ACTIVE_KEY) || 'null');
      return value && typeof value === 'object' ? value : null;
    } catch {
      return null;
    }
  }

  let records = readRecords();
  let active = readActive();

  function ensureTrack(session) {
    if (!session) return null;
    if (!session.track || typeof session.track !== 'object') {
      session.track = { points:[], distanceMeters:0, segment:0 };
    }
    if (!Array.isArray(session.track.points)) session.track.points = [];
    if (!Number.isFinite(Number(session.track.distanceMeters))) session.track.distanceMeters = 0;
    if (!Number.isInteger(session.track.segment) || session.track.segment < 0) session.track.segment = 0;
    return session.track;
  }

  function distanceMeters(a,b) {
    const A=[Number(a?.lat),Number(a?.lon)];
    const B=[Number(b?.lat),Number(b?.lon)];
    const core=window.BaselineNavigationCore;
    if (core?.validCoords?.(A) && core?.validCoords?.(B)) {
      return core.haversineKm(A,B) * 1000;
    }
    return NaN;
  }

  function persistActive() {
    if (active) localStorage.setItem(ACTIVE_KEY, JSON.stringify(active));
    else localStorage.removeItem(ACTIVE_KEY);
    window.dispatchEvent(new CustomEvent('baseline-session-change',{detail:{session:clone(active)}}));
  }

  function persistRecords() {
    localStorage.setItem(KEY, JSON.stringify(records));
    window.dispatchEvent(new CustomEvent('baseline-records-change'));
  }

  function elapsedMs(session = active, now = Date.now()) {
    if (!session?.startedAt) return 0;
    const end = session.endedAt || now;
    const livePause = session.status === 'PAUSED' && session.pausedAt ? Math.max(0,end-session.pausedAt) : 0;
    return Math.max(0,end-session.startedAt-(Number(session.pauseMs)||0)-livePause);
  }

  function start(planSnapshot) {
    if (!planSnapshot?.destination || !planSnapshot?.start) return null;
    const now = Date.now();
    active = {
      id:'REC-' + now.toString(36) + '-' + Math.random().toString(36).slice(2,7),
      name:String(planSnapshot.name || '미저장 계획'),
      status:'RUNNING',
      startedAt:now,
      endedAt:null,
      pausedAt:null,
      pauseMs:0,
      laps:[],
      events:[{type:'START',at:now}],
      initialPlan:clone(planSnapshot),
      finalPlan:null,
      track:{points:[],distanceMeters:0,segment:0}
    };
    persistActive();
    return clone(active);
  }

  function pause() {
    if (!active || active.status !== 'RUNNING') return null;
    ensureTrack(active);
    active.status='PAUSED';
    active.pausedAt=Date.now();
    active.events.push({type:'PAUSE',at:active.pausedAt});
    persistActive();
    return clone(active);
  }

  function resume() {
    if (!active || active.status !== 'PAUSED') return null;
    const now=Date.now();
    const track=ensureTrack(active);
    track.segment += 1;
    active.pauseMs += Math.max(0,now-(active.pausedAt || now));
    active.pausedAt=null;
    active.status='RUNNING';
    active.events.push({type:'RESUME',at:now});
    persistActive();
    return clone(active);
  }

  function lap(reference) {
    if (!active || !['RUNNING','PAUSED'].includes(active.status)) return null;
    const at=Date.now();
    const entry={
      index:active.laps.length+1,
      at,
      elapsedMs:elapsedMs(active,at),
      reference:reference ? clone(reference) : null
    };
    active.laps.push(entry);
    active.events.push({type:'LAP',at,index:entry.index});
    persistActive();
    return clone(entry);
  }

  function addTrackPoint(point) {
    if (!active || active.status !== 'RUNNING' || !point) return null;
    const lat=Number(point.lat ?? point.coords?.[0]);
    const lon=Number(point.lon ?? point.coords?.[1]);
    const at=Number(point.at) || Date.now();
    const accuracy=Number.isFinite(Number(point.accuracy)) ? Number(point.accuracy) : null;
    const altitude=Number.isFinite(Number(point.altitude)) ? Number(point.altitude) : null;
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat)>90 || Math.abs(lon)>180) return null;
    if (accuracy !== null && accuracy > 100) return null;

    const track=ensureTrack(active);
    const last=track.points[track.points.length-1] || null;
    if (last && at <= Number(last.at || 0)) return null;

    let distance=NaN;
    if (last && Number(last.segment) === track.segment) {
      distance=distanceMeters(last,{lat,lon});
      const elapsed=at-Number(last.at || 0);
      if (Number.isFinite(distance) && distance < 8 && elapsed < 10000) return null;
    }

    const accepted={lat,lon,at,accuracy,altitude,segment:track.segment};
    if (last && Number(last.segment) === track.segment && Number.isFinite(distance)) {
      track.distanceMeters += Math.max(0,distance);
    }
    track.points.push(accepted);
    persistActive();
    return clone(accepted);
  }

  function routeUpdated(planSnapshot) {
    if (!active) return;
    active.events.push({type:'ROUTE_UPDATED',at:Date.now()});
    active.finalPlan=clone(planSnapshot);
    persistActive();
  }

  function finish(finalPlan) {
    if (!active) return null;
    const now=Date.now();
    if (active.status === 'PAUSED' && active.pausedAt) {
      active.pauseMs += Math.max(0,now-active.pausedAt);
      active.pausedAt=null;
    }
    active.status='FINISHED';
    active.endedAt=now;
    active.events.push({type:'STOP',at:now});
    active.finalPlan=clone(finalPlan || active.finalPlan || active.initialPlan);
    active.elapsedMs=elapsedMs(active,now);
    records.unshift(clone(active));
    persistRecords();
    const finished=clone(active);
    active=null;
    persistActive();
    return finished;
  }

  function discardActive() {
    active=null;
    persistActive();
  }

  function getActive() {
    if (active) ensureTrack(active);
    return clone(active);
  }
  function list() { return records.map(clone).sort((a,b)=>b.startedAt-a.startedAt); }
  function get(id) {
    const record=records.find(r=>String(r.id)===String(id));
    return record ? clone(record) : null;
  }

  function remove(id) {
    const key=String(id);
    const before=records.length;
    records=records.filter(record=>String(record.id)!==key);
    if(records.length===before) return false;
    persistRecords();
    return true;
  }

  window.BaselineRecordStore = Object.freeze({
    start,pause,resume,lap,addTrackPoint,routeUpdated,finish,discardActive,getActive,list,get,remove,elapsedMs
  });
})();
