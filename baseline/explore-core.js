(() => {
  'use strict';

  const RADII = Object.freeze(['all', 30, 80, 150]);
  const MOUNTAIN_ZONES = Object.freeze([
    Object.freeze({ minLat:37.6, maxLat:38.2, minLon:127.3, maxLon:128.6 }),
    Object.freeze({ minLat:36.8, maxLat:37.4, minLon:128.0, maxLon:128.9 }),
    Object.freeze({ minLat:35.3, maxLat:36.0, minLon:127.4, maxLon:128.4 })
  ]);

  function validCoords(coords) {
    return Array.isArray(coords) &&
      Number.isFinite(Number(coords[0])) &&
      Number.isFinite(Number(coords[1])) &&
      Math.abs(Number(coords[0])) <= 90 &&
      Math.abs(Number(coords[1])) <= 180;
  }

  function distanceKm(a, b) {
    if (!validCoords(a) || !validCoords(b)) return NaN;
    const R = 6371;
    const toRad = n => Number(n) * Math.PI / 180;
    const dLat = toRad(b[0] - a[0]);
    const dLon = toRad(b[1] - a[1]);
    const lat1 = toRad(a[0]);
    const lat2 = toRad(b[0]);
    const h = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }

  function randomRegistered(sites, radius, reference, random = Math.random) {
    const list = Array.isArray(sites) ? sites : [];
    const pool = radius === 'all'
      ? list.slice()
      : list.filter(site => validCoords(site.coords) &&
          validCoords(reference) &&
          distanceKm(reference, site.coords) <= Number(radius));

    if (!pool.length) return null;
    return pool[Math.floor(random() * pool.length)] || null;
  }

  function randomPointWithin(reference, radiusKm, random = Math.random) {
    if (!validCoords(reference) || !Number.isFinite(Number(radiusKm))) return null;
    // Preserve the old RECON behavior: avoid trivial near-origin picks by using 25%-100% of range.
    const distance = Number(radiusKm) * (0.25 + random() * 0.75);
    const bearing = random() * 2 * Math.PI;
    const angular = distance / 6371;
    const lat1 = reference[0] * Math.PI / 180;
    const lon1 = reference[1] * Math.PI / 180;
    const lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(angular) +
      Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing)
    );
    const lon2 = lon1 + Math.atan2(
      Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1),
      Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2)
    );
    return [lat2 * 180 / Math.PI, ((lon2 * 180 / Math.PI + 540) % 360) - 180];
  }

  function randomNationalPoint(random = Math.random) {
    const zone = MOUNTAIN_ZONES[Math.floor(random() * MOUNTAIN_ZONES.length)] || MOUNTAIN_ZONES[0];
    return [
      zone.minLat + random() * (zone.maxLat - zone.minLat),
      zone.minLon + random() * (zone.maxLon - zone.minLon)
    ];
  }

  function randomWild(radius, reference, random = Math.random) {
    const coords = radius === 'all'
      ? randomNationalPoint(random)
      : randomPointWithin(reference, Number(radius), random);
    if (!validCoords(coords)) return null;

    const secNum = Math.floor(1000 + random() * 9000);
    const now = Date.now();
    return {
      id: 'WILD-' + now + '-' + secNum,
      opCode: 'WILD-SEC-' + secNum,
      name: '미개척 구릉 탐색지 [SEC-' + secNum + ']',
      cat: '미개척지',
      coords,
      desc: '미상의 내륙 산악 구릉 지점. 지형 등고선을 확인하며 현장에서 직접 정찰하는 임시 탐색 거점.',
      tips: '접근 가능 여부와 출입 제한을 현장에서 우선 확인하십시오.',
      status: 'UNEXPLORED',
      source: 'WILD',
      createdAt: new Date(now).toISOString()
    };
  }

  window.BaselineExplore = Object.freeze({
    RADII,
    distanceKm,
    randomRegistered,
    randomWild
  });
})();
