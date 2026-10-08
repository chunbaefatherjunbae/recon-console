(() => {
  'use strict';

  const KEY = 'tr_baseline_plans_v1';
  const FORMAT = 'TACTICAL_RECON_PLAN';
  const VERSION = 1;

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function read() {
    try {
      const value = JSON.parse(localStorage.getItem(KEY) || '[]');
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  }

  let plans = read();

  function write() {
    localStorage.setItem(KEY, JSON.stringify(plans));
    window.dispatchEvent(new CustomEvent('baseline-plans-change'));
  }

  function validCoords(coords) {
    return Array.isArray(coords) &&
      Number.isFinite(Number(coords[0])) &&
      Number.isFinite(Number(coords[1])) &&
      Math.abs(Number(coords[0])) <= 90 &&
      Math.abs(Number(coords[1])) <= 180;
  }

  function point(input, role = 'POINT') {
    const coords = input?.coords;
    if (!validCoords(coords)) return null;
    return {
      id:String(input.id || (role + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2,7))),
      role:String(input.role || role),
      name:String(input.name || role),
      coords:[Number(coords[0]), Number(coords[1])],
      source:String(input.source || 'MANUAL'),
      siteId:input.siteId ? String(input.siteId) : null,
      address:input.address ? String(input.address) : null,
      capturedAt:Number(input.capturedAt) || Date.now()
    };
  }

  function drawing(input) {
    const pts = Array.isArray(input?.points)
      ? input.points.filter(validCoords).map(p => [Number(p[0]),Number(p[1])])
      : [];
    if (pts.length < 2) return null;
    return {
      id:String(input.id || ('DRAW-' + Date.now().toString(36) + Math.random().toString(36).slice(2,7))),
      kind:input.kind === 'MARK' ? 'MARK' : 'ROUTE',
      points:pts
    };
  }

  function normalize(input = {}) {
    const now = Date.now();
    return {
      version:VERSION,
      id:String(input.id || ('PLAN-' + now.toString(36) + '-' + Math.random().toString(36).slice(2,7))),
      name:String(input.name || '').slice(0,120),
      createdAt:Number(input.createdAt) || now,
      updatedAt:Number(input.updatedAt) || now,
      start:point(input.start,'START'),
      vias:Array.isArray(input.vias) ? input.vias.map(v => point(v,'VIA')).filter(Boolean) : [],
      destination:point(input.destination,'DEST'),
      drawings:Array.isArray(input.drawings) ? input.drawings.map(drawing).filter(Boolean) : []
    };
  }

  function createDraft(referencePoint = null) {
    return normalize({
      name:'',
      start:referencePoint ? {...referencePoint, role:'START'} : null,
      vias:[],
      destination:null,
      drawings:[]
    });
  }

  function save(input, name = input?.name) {
    const normalized = normalize({...input,name:String(name || '').trim(),updatedAt:Date.now()});
    if (!normalized.name) return null;
    const index = plans.findIndex(p => String(p.id) === normalized.id);
    if (index >= 0) {
      normalized.createdAt = Number(plans[index].createdAt) || normalized.createdAt;
      plans[index] = normalized;
    } else {
      plans.unshift(normalized);
    }
    write();
    return clone(normalized);
  }

  function saveAs(input, name) {
    const copy = normalize({
      ...clone(input),
      id:null,
      name:String(name || '').trim(),
      createdAt:Date.now(),
      updatedAt:Date.now()
    });
    if (!copy.name) return null;
    plans.unshift(copy);
    write();
    return clone(copy);
  }

  function list() {
    return plans.map(normalize).sort((a,b) => b.updatedAt - a.updatedAt).map(clone);
  }

  function get(id) {
    const found = plans.find(p => String(p.id) === String(id));
    return found ? clone(normalize(found)) : null;
  }

  function remove(id) {
    const before = plans.length;
    plans = plans.filter(p => String(p.id) !== String(id));
    if (plans.length !== before) write();
    return plans.length !== before;
  }

  function exportPayload(plan) {
    return {
      format:FORMAT,
      version:VERSION,
      exportedAt:new Date().toISOString(),
      plan:normalize(plan)
    };
  }

  function importPayload(payload) {
    if (!payload || payload.format !== FORMAT || Number(payload.version) !== VERSION || !payload.plan) return null;
    const imported = normalize({
      ...payload.plan,
      id:null,
      name:String(payload.plan.name || '가져온 계획'),
      createdAt:Date.now(),
      updatedAt:Date.now()
    });
    plans.unshift(imported);
    write();
    return clone(imported);
  }

  window.BaselinePlanStore = Object.freeze({
    FORMAT,VERSION,point,drawing,normalize,createDraft,save,saveAs,list,get,remove,exportPayload,importPayload
  });
})();
