(() => {
  'use strict';

  const TEMP_KEY = 'tr_baseline_temp_v1';
  const LAST_FIX_KEY = 'tr_baseline_last_fix_v1';

  const read = key => {
    try {
      const value = JSON.parse(localStorage.getItem(key) || 'null');
      return value && Number.isFinite(value.lat) && Number.isFinite(value.lon) && Number.isFinite(value.at) ? value : null;
    } catch {
      return null;
    }
  };

  const state = {
    gps: {
      enabled: false,
      follow: false,
      watchId: null,
      fix: null
    },
    temp: read(TEMP_KEY),
    lastFix: read(LAST_FIX_KEY),
    activePanel: null
  };

  function emit(reason) {
    window.dispatchEvent(new CustomEvent('baseline-state-change', {
      detail: { reason, state: snapshot() }
    }));
  }

  function snapshot() {
    return JSON.parse(JSON.stringify({
      gps: {
        enabled: state.gps.enabled,
        follow: state.gps.follow,
        fix: state.gps.fix
      },
      temp: state.temp,
      lastFix: state.lastFix,
      activePanel: state.activePanel
    }));
  }

  function setTemp(point) {
    state.temp = {
      lat: Number(point.lat),
      lon: Number(point.lon),
      at: Date.now()
    };
    localStorage.setItem(TEMP_KEY, JSON.stringify(state.temp));
    emit('temp');
    return state.temp;
  }

  function clearTemp() {
    state.temp = null;
    localStorage.removeItem(TEMP_KEY);
    emit('temp-clear');
  }

  function setLastFix(point) {
    const next = {
      lat: Number(point.lat),
      lon: Number(point.lon),
      accuracy: Number.isFinite(Number(point.accuracy)) ? Number(point.accuracy) : null,
      altitude: Number.isFinite(Number(point.altitude)) ? Number(point.altitude) : null,
      at: Number.isFinite(Number(point.at)) ? Number(point.at) : Date.now()
    };
    state.lastFix = next;
    localStorage.setItem(LAST_FIX_KEY, JSON.stringify(next));
    emit('last-fix');
    return next;
  }

  function setGpsFix(point) {
    const fix = setLastFix({ ...point, at: Date.now() });
    state.gps.fix = fix;
    emit('gps-fix');
    return fix;
  }

  function clearLiveFix() {
    state.gps.fix = null;
    emit('gps-fix-clear');
  }

  function reference() {
    if (state.gps.enabled && state.gps.fix) {
      return { ...state.gps.fix, type: 'GPS' };
    }

    const candidates = [
      state.temp ? { ...state.temp, type: 'TEMP' } : null,
      state.lastFix ? { ...state.lastFix, type: 'LAST' } : null
    ].filter(Boolean);

    if (!candidates.length) return null;
    candidates.sort((a, b) => b.at - a.at);
    return candidates[0];
  }

  function setGpsEnabled(enabled) {
    state.gps.enabled = Boolean(enabled);
    if (!state.gps.enabled) {
      state.gps.follow = false;
      state.gps.fix = null;
    }
    emit('gps-power');
  }

  function setFollow(enabled) {
    state.gps.follow = Boolean(enabled);
    emit('follow');
  }

  function setWatchId(watchId) {
    state.gps.watchId = watchId;
  }

  function setPanel(panel) {
    state.activePanel = panel || null;
    emit('panel');
  }

  window.BaselineState = {
    state,
    snapshot,
    reference,
    setTemp,
    clearTemp,
    setLastFix,
    setGpsFix,
    clearLiveFix,
    setGpsEnabled,
    setFollow,
    setWatchId,
    setPanel
  };
})();
