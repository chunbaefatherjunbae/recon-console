(() => {
  'use strict';

  // Clean BASELINE navigation math.
  // WMM-2025 synthesis is extracted from the previously verified pure V29 math,
  // without loading any V29 runtime/UI dependency.
  const EARTH_KM = 6371.0088;
  const DEG = Math.PI / 180;
  const RAD = 180 / Math.PI;

  function validCoords(coords) {
    return Array.isArray(coords) && coords.length === 2 &&
      Number.isFinite(Number(coords[0])) && Number.isFinite(Number(coords[1])) &&
      Number(coords[0]) >= -90 && Number(coords[0]) <= 90 &&
      Number(coords[1]) >= -180 && Number(coords[1]) <= 180;
  }

  function clamp(value, lo, hi) {
    return Math.max(lo, Math.min(hi, value));
  }

  function normalize360(deg) {
    const value = Number(deg);
    if (!Number.isFinite(value)) return NaN;
    return ((value % 360) + 360) % 360;
  }

  function haversineKm(a, b) {
    if (!validCoords(a) || !validCoords(b)) return NaN;
    const lat1 = Number(a[0]) * DEG;
    const lat2 = Number(b[0]) * DEG;
    const dLat = (Number(b[0]) - Number(a[0])) * DEG;
    const dLon = (Number(b[1]) - Number(a[1])) * DEG;
    const h = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return EARTH_KM * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
  }

  function initialBearing(a, b) {
    if (!validCoords(a) || !validCoords(b)) return NaN;
    const p1 = Number(a[0]) * DEG;
    const p2 = Number(b[0]) * DEG;
    const dl = (Number(b[1]) - Number(a[1])) * DEG;
    const y = Math.sin(dl) * Math.cos(p2);
    const x = Math.cos(p1) * Math.sin(p2) -
      Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
    return normalize360(Math.atan2(y, x) * RAD);
  }

const WMM_COF = `2025.0 WMM-2025 11/13/2024
1 0 -29351.8 0.0 12.0 0.0
1 1 -1410.8 4545.4 9.7 -21.5
2 0 -2556.6 0.0 -11.6 0.0
2 1 2951.1 -3133.6 -5.2 -27.7
2 2 1649.3 -815.1 -8.0 -12.1
3 0 1361.0 0.0 -1.3 0.0
3 1 -2404.1 -56.6 -4.2 4.0
3 2 1243.8 237.5 0.4 -0.3
3 3 453.6 -549.5 -15.6 -4.1
4 0 895.0 0.0 -1.6 0.0
4 1 799.5 278.6 -2.4 -1.1
4 2 55.7 -133.9 -6.0 4.1
4 3 -281.1 212.0 5.6 1.6
4 4 12.1 -375.6 -7.0 -4.4
5 0 -233.2 0.0 0.6 0.0
5 1 368.9 45.4 1.4 -0.5
5 2 187.2 220.2 0.0 2.2
5 3 -138.7 -122.9 0.6 0.4
5 4 -142.0 43.0 2.2 1.7
5 5 20.9 106.1 0.9 1.9
6 0 64.4 0.0 -0.2 0.0
6 1 63.8 -18.4 -0.4 0.3
6 2 76.9 16.8 0.9 -1.6
6 3 -115.7 48.8 1.2 -0.4
6 4 -40.9 -59.8 -0.9 0.9
6 5 14.9 10.9 0.3 0.7
6 6 -60.7 72.7 0.9 0.9
7 0 79.5 0.0 -0.0 0.0
7 1 -77.0 -48.9 -0.1 0.6
7 2 -8.8 -14.4 -0.1 0.5
7 3 59.3 -1.0 0.5 -0.8
7 4 15.8 23.4 -0.1 0.0
7 5 2.5 -7.4 -0.8 -1.0
7 6 -11.1 -25.1 -0.8 0.6
7 7 14.2 -2.3 0.8 -0.2
8 0 23.2 0.0 -0.1 0.0
8 1 10.8 7.1 0.2 -0.2
8 2 -17.5 -12.6 0.0 0.5
8 3 2.0 11.4 0.5 -0.4
8 4 -21.7 -9.7 -0.1 0.4
8 5 16.9 12.7 0.3 -0.5
8 6 15.0 0.7 0.2 -0.6
8 7 -16.8 -5.2 -0.0 0.3
8 8 0.9 3.9 0.2 0.2
9 0 4.6 0.0 -0.0 0.0
9 1 7.8 -24.8 -0.1 -0.3
9 2 3.0 12.2 0.1 0.3
9 3 -0.2 8.3 0.3 -0.3
9 4 -2.5 -3.3 -0.3 0.3
9 5 -13.1 -5.2 0.0 0.2
9 6 2.4 7.2 0.3 -0.1
9 7 8.6 -0.6 -0.1 -0.2
9 8 -8.7 0.8 0.1 0.4
9 9 -12.9 10.0 -0.1 0.1
10 0 -1.3 0.0 0.1 0.0
10 1 -6.4 3.3 0.0 0.0
10 2 0.2 0.0 0.1 -0.0
10 3 2.0 2.4 0.1 -0.2
10 4 -1.0 5.3 -0.0 0.1
10 5 -0.6 -9.1 -0.3 -0.1
10 6 -0.9 0.4 0.0 0.1
10 7 1.5 -4.2 -0.1 0.0
10 8 0.9 -3.8 -0.1 -0.1
10 9 -2.7 0.9 -0.0 0.2
10 10 -3.9 -9.1 -0.0 -0.0
11 0 2.9 0.0 0.0 0.0
11 1 -1.5 0.0 -0.0 -0.0
11 2 -2.5 2.9 0.0 0.1
11 3 2.4 -0.6 0.0 -0.0
11 4 -0.6 0.2 0.0 0.1
11 5 -0.1 0.5 -0.1 -0.0
11 6 -0.6 -0.3 0.0 -0.0
11 7 -0.1 -1.2 -0.0 0.1
11 8 1.1 -1.7 -0.1 -0.0
11 9 -1.0 -2.9 -0.1 0.0
11 10 -0.2 -1.8 -0.1 0.0
11 11 2.6 -2.3 -0.1 0.0
12 0 -2.0 0.0 0.0 0.0
12 1 -0.2 -1.3 0.0 -0.0
12 2 0.3 0.7 -0.0 0.0
12 3 1.2 1.0 -0.0 -0.1
12 4 -1.3 -1.4 -0.0 0.1
12 5 0.6 -0.0 -0.0 -0.0
12 6 0.6 0.6 0.1 -0.0
12 7 0.5 -0.1 -0.0 -0.0
12 8 -0.1 0.8 0.0 0.0
12 9 -0.4 0.1 0.0 -0.0
12 10 -0.2 -1.0 -0.1 -0.0
12 11 -1.3 0.1 -0.0 0.0
12 12 -0.7 0.2 -0.1 -0.1`;

function matrix13() {
  return Array.from({length:13}, () => Array(13).fill(0));
}

function buildWmmModel() {
  const c = matrix13();
  const cd = matrix13();
  const k = matrix13();
  const fn = Array(13).fill(0);
  const fm = Array(13).fill(0);
  const rows = WMM_COF.trim().split(/\n+/);
  const header = rows.shift().trim().split(/\s+/);
  const epoch = Number(header[0]);
  rows.forEach(line => {
    const p = line.trim().split(/\s+/).map(Number);
    if (p.length < 6) return;
    const [n,m,g,h,dg,dh] = p;
    c[m][n] = g;
    cd[m][n] = dg;
    if (m !== 0) {
      c[n][m - 1] = h;
      cd[n][m - 1] = dh;
    }
  });

  const snorm = Array(169).fill(0);
  snorm[0] = 1;
  fm[0] = 0;
  for (let n = 1; n <= 12; n++) {
    snorm[n] = snorm[n - 1] * (2 * n - 1) / n;
    let j = 2;
    for (let m = 0; m <= n; m++) {
      k[m][n] = (((n - 1) * (n - 1)) - m * m) / ((2 * n - 1) * (2 * n - 3));
      if (m > 0) {
        const flnmj = ((n - m + 1) * j) / (n + m);
        snorm[n + m * 13] = snorm[n + (m - 1) * 13] * Math.sqrt(flnmj);
        j = 1;
        c[n][m - 1] *= snorm[n + m * 13];
        cd[n][m - 1] *= snorm[n + m * 13];
      }
      c[m][n] *= snorm[n + m * 13];
      cd[m][n] *= snorm[n + m * 13];
    }
    fn[n] = n + 1;
    fm[n] = n;
  }
  k[1][1] = 0;
  return {epoch,c,cd,k,fn,fm};
}

const WMM_MODEL = buildWmmModel();

function decimalYear(value = new Date()) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const d = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(d.getTime())) return NaN;
  const y = d.getUTCFullYear();
  const start = Date.UTC(y,0,1);
  const end = Date.UTC(y + 1,0,1);
  return y + (d.getTime() - start) / (end - start);
}

function wmmField(lat, lon, altitudeKm = 0, date = new Date()) {
  lat = Number(lat); lon = Number(lon); altitudeKm = Number(altitudeKm) || 0;
  const year = decimalYear(date);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 360) return null;
  if (!Number.isFinite(year) || year < 2025 || year >= 2030) return {
    valid:false, reason:'MODEL_DATE_OUT_OF_RANGE', epoch:2025, validUntil:2030
  };

  const MAX = 12;
  const A = 6378.137, B = 6356.7523142, RE = 6371.2;
  const A2 = A*A, B2 = B*B, C2 = A2-B2, A4=A2*A2, B4=B2*B2, C4=A4-B4;
  const dt = year - WMM_MODEL.epoch;
  const rlon = lon * DEG, rlat = lat * DEG;
  const srlon=Math.sin(rlon), srlat=Math.sin(rlat), crlon=Math.cos(rlon), crlat=Math.cos(rlat);
  const srlat2=srlat*srlat, crlat2=crlat*crlat;

  const sp=Array(13).fill(0), cp=Array(13).fill(0), pp=Array(13).fill(0);
  const p=Array(169).fill(0), dp=matrix13(), tc=matrix13();
  p[0]=1; pp[0]=1; cp[0]=1; dp[0][0]=0;
  sp[1]=srlon; cp[1]=crlon;

  const q=Math.sqrt(A2-C2*srlat2);
  const q1=altitudeKm*q;
  const q2=((q1+A2)/(q1+B2))**2;
  const ct=srlat/Math.sqrt(q2*crlat2+srlat2);
  const st=Math.sqrt(Math.max(0,1-ct*ct));
  const r2=altitudeKm*altitudeKm+2*q1+(A4-C4*srlat2)/(q*q);
  const r=Math.sqrt(r2);
  const d=Math.sqrt(A2*crlat2+B2*srlat2);
  const ca=(altitudeKm+d)/r;
  const sa=C2*crlat*srlat/(r*d);

  for(let m=2;m<=MAX;m++){
    sp[m]=sp[1]*cp[m-1]+cp[1]*sp[m-1];
    cp[m]=cp[1]*cp[m-1]-sp[1]*sp[m-1];
  }

  const aor=RE/r;
  let ar=aor*aor, br=0, bt=0, bp=0, bpp=0;
  for(let n=1;n<=MAX;n++){
    ar*=aor;
    for(let m=0;m<=n;m++){
      const idx=n+m*13;
      if(n===m){
        p[idx]=st*p[n-1+(m-1)*13];
        dp[m][n]=st*dp[m-1][n-1]+ct*p[n-1+(m-1)*13];
      } else if(n===1 && m===0){
        p[idx]=ct*p[n-1+m*13];
        dp[m][n]=ct*dp[m][n-1]-st*p[n-1+m*13];
      } else if(n>1 && n!==m){
        if(m>n-2){ p[n-2+m*13]=0; dp[m][n-2]=0; }
        p[idx]=ct*p[n-1+m*13]-WMM_MODEL.k[m][n]*p[n-2+m*13];
        dp[m][n]=ct*dp[m][n-1]-st*p[n-1+m*13]-WMM_MODEL.k[m][n]*dp[m][n-2];
      }

      tc[m][n]=WMM_MODEL.c[m][n]+dt*WMM_MODEL.cd[m][n];
      if(m!==0) tc[n][m-1]=WMM_MODEL.c[n][m-1]+dt*WMM_MODEL.cd[n][m-1];
      const par=ar*p[idx];
      let temp1,temp2;
      if(m===0){
        temp1=tc[m][n]*cp[m];
        temp2=tc[m][n]*sp[m];
      } else {
        temp1=tc[m][n]*cp[m]+tc[n][m-1]*sp[m];
        temp2=tc[m][n]*sp[m]-tc[n][m-1]*cp[m];
      }
      bt-=ar*temp1*dp[m][n];
      bp+=WMM_MODEL.fm[m]*temp2*par;
      br+=WMM_MODEL.fn[n]*temp1*par;

      if(st===0 && m===1){
        if(n===1) pp[n]=pp[n-1];
        else pp[n]=ct*pp[n-1]-WMM_MODEL.k[m][n]*pp[n-2];
        bpp+=WMM_MODEL.fm[m]*temp2*ar*pp[n];
      }
    }
  }
  bp=st===0?bpp:bp/st;
  const x=-bt*ca-br*sa;
  const y=bp;
  const z=bt*sa-br*ca;
  const h=Math.hypot(x,y);
  const f=Math.hypot(h,z);
  const declination=Math.atan2(y,x)*RAD;
  const inclination=Math.atan2(z,h)*RAD;
  return {
    valid:true, model:'WMM-2025', epoch:2025, validUntil:2030, decimalYear:year,
    x,y,z,h,f,declination,inclination
  };
}

function utmZone(lon) {
  const value = Number(lon);
  if (!Number.isFinite(value)) return null;
  return clamp(Math.floor((value + 180) / 6) + 1, 1, 60);
}

function gridConvergence(lat, lon) {
  lat=Number(lat);lon=Number(lon);
  if(!Number.isFinite(lat)||!Number.isFinite(lon)||lat<-80||lat>84) return NaN;
  const zone=utmZone(lon);
  const central=zone*6-183;
  const dl=(lon-central)*DEG;
  return Math.atan(Math.tan(dl)*Math.sin(lat*DEG))*RAD;
}

function bearingBundle(current, target, options = {}) {
  if (!validCoords(current) || !validCoords(target)) return null;
  const trueBearing=initialBearing(current,target);
  const convergence=gridConvergence(current[0],current[1]);
  const field=wmmField(current[0],current[1],Number(options.altitudeKm)||0,options.date||new Date());
  const declination=field?.valid?field.declination:NaN;
  const gridMagneticAngle=(Number.isFinite(declination)&&Number.isFinite(convergence))
    ? declination-convergence
    : NaN;
  const gridToMagneticCorrection=Number.isFinite(gridMagneticAngle)
    ? -gridMagneticAngle
    : NaN;
  return {
    distanceKm:haversineKm(current,target),
    trueBearing,
    convergence,
    gridBearing:Number.isFinite(convergence)?normalize360(trueBearing-convergence):NaN,
    declination,
    gridMagneticAngle,
    gridToMagneticCorrection,
    magneticBearing:Number.isFinite(declination)?normalize360(trueBearing-declination):NaN,
    zone:utmZone(current[1]),
    model:field
  };
}


  window.BaselineNavigationCore = Object.freeze({
    validCoords,
    normalize360,
    haversineKm,
    initialBearing,
    gridConvergence,
    utmZone,
    bearingBundle,
    decimalYear,
    wmmField
  });
})();
