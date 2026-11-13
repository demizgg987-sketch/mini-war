'use strict';
/*
 * Globe - כדור הארץ התלת-ממדי של המשחק
 * WebGL לכדור עצמו (תאורה, עננים, אטמוספרה, כוכבים) + קנבס דו-ממדי מעליו לכל מה שעל המפה.
 */
const Globe = (() => {
  const DEG = Math.PI / 180;
  const TEX_W = 4096, TEX_H = 2048;
  const MASK_W = 1440, MASK_H = 720;

  const view = { lon: 30, lat: 22, zoom: 1, autoSpin: true };
  const anim = { from: null, to: null, t0: 0, dur: 0 };
  let glCanvas, overlay, ctx, gl, prog, uni = {};
  let W = 0, H = 0, dpr = 1, R = 0, cx = 0, cy = 0;
  let mask = null;
  let ready = false;
  const t0 = performance.now();
  const api = { view, onClick: null, onDraw: null, onHover: null };

  // ---------------- שיידרים ----------------
  const VS = `attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`;
  const FS = `
precision highp float;
uniform vec2 uRes; uniform vec2 uCenter; uniform float uR;
uniform float uLon; uniform float uLat; uniform float uTime;
uniform sampler2D uTex; uniform float uHasTex;
float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float h3(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float noise(vec3 p){
  vec3 i = floor(p); vec3 f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(h3(i), h3(i+vec3(1,0,0)), f.x), mix(h3(i+vec3(0,1,0)), h3(i+vec3(1,1,0)), f.x), f.y),
             mix(mix(h3(i+vec3(0,0,1)), h3(i+vec3(1,0,1)), f.x), mix(h3(i+vec3(0,1,1)), h3(i+vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p){ float v = 0.0; float a = 0.5; for(int i = 0; i < 5; i++){ v += a*noise(p); p *= 2.03; a *= 0.5; } return v; }
vec3 space(vec2 frag){
  vec2 q = frag / uRes;
  vec3 c = mix(vec3(0.005, 0.01, 0.03), vec3(0.03, 0.04, 0.10), smoothstep(1.2, 0.0, length(q - vec2(0.5, 0.45))));
  c += vec3(0.10, 0.03, 0.15) * smoothstep(0.5, 0.0, length(q - vec2(0.85, 0.15))) * 0.6;
  vec2 cell = floor(frag / 2.0);
  float s = h2(cell);
  if (s > 0.9965) c += vec3(0.75 + 0.25*h2(cell+3.1), 0.8, 1.0) * (0.45 + 0.55*sin(uTime*1.7 + s*400.0)) * (s - 0.9965) * 280.0;
  return c;
}
void main(){
  vec2 frag = gl_FragCoord.xy;
  vec2 d = (frag - uCenter) / uR;
  float r2 = dot(d, d);
  float r = sqrt(r2);
  vec3 bg = space(frag);
  vec3 sun = normalize(vec3(-0.55, 0.45, 0.75));
  if (r2 > 1.0) {
    float glow = exp(-(r - 1.0) * 9.0);
    float side = 0.55 + 0.45 * max(dot(normalize(d), normalize(sun.xy)), 0.0);
    gl_FragColor = vec4(bg + vec3(0.30, 0.62, 1.0) * glow * 0.85 * side, 1.0);
    return;
  }
  vec3 n = vec3(d, sqrt(1.0 - r2));
  float cb = cos(uLat); float sb = sin(uLat); float ca = cos(uLon); float sa = sin(uLon);
  float y = n.y*cb + n.z*sb;
  float z1 = -n.y*sb + n.z*cb;
  float x = n.x*ca + z1*sa;
  float z = -n.x*sa + z1*ca;
  vec3 e = vec3(x, y, z);
  float lat = asin(clamp(y, -1.0, 1.0));
  float lon = atan(x, z);
  vec2 uv = vec2((lon + 3.14159265) / 6.28318531, (1.57079633 - lat) / 3.14159265);
  vec3 col;
  if (uHasTex > 0.5) col = texture2D(uTex, uv).rgb;
  else col = mix(vec3(0.05, 0.2, 0.42), vec3(0.2, 0.45, 0.2), step(0.55, fbm(e*2.0)));
  bool ocean = col.b > col.r + 0.08 && col.b > col.g - 0.02;

  float diff = dot(n, sun);
  float light = smoothstep(-0.35, 0.75, diff);
  vec3 c = col * (0.30 + 0.95 * light);
  if (ocean) {
    vec3 hv = normalize(sun + vec3(0.0, 0.0, 1.0));
    c += vec3(1.0, 0.95, 0.85) * pow(max(dot(n, hv), 0.0), 70.0) * 0.55;
    c += vec3(0.02, 0.06, 0.1) * (1.0 - n.z);
  }
  // עננים
  vec3 cp = e * 2.6 + vec3(uTime * 0.012, 0.0, uTime * 0.006);
  float cl = smoothstep(0.52, 0.82, fbm(cp + fbm(cp * 1.7) * 0.6));
  cl *= 0.85 - 0.35 * abs(y);
  c = mix(c, vec3(1.0) * (0.35 + 0.75 * light), cl * 0.6);
  // אטמוספרה בקצוות
  float rim = pow(1.0 - n.z, 2.6);
  c = mix(c, vec3(0.38, 0.68, 1.0) * (0.4 + 0.8 * light), rim * 0.65);
  float edge = smoothstep(1.0, 0.993, r);
  gl_FragColor = vec4(mix(bg + vec3(0.3,0.62,1.0)*0.8, c, edge), 1.0);
}`;

  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }

  function initGL() {
    gl = glCanvas.getContext('webgl', { antialias: false, alpha: false }) || glCanvas.getContext('experimental-webgl');
    if (!gl) throw new Error('הדפדפן לא תומך ב-WebGL');
    prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    for (const n of ['uRes', 'uCenter', 'uR', 'uLon', 'uLat', 'uTime', 'uTex', 'uHasTex']) uni[n] = gl.getUniformLocation(prog, n);
    gl.uniform1f(uni.uHasTex, 0);
  }

  // ---------------- מפת העולם ----------------
  function decodeTopo(topo) {
    const [sx, sy] = topo.transform.scale;
    const [tx, ty] = topo.transform.translate;
    const arcs = topo.arcs.map((arc) => {
      let x = 0, y = 0;
      return arc.map(([dx, dy]) => { x += dx; y += dy; return [x * sx + tx, y * sy + ty]; });
    });
    const ring = (ids) => {
      const pts = [];
      ids.forEach((id, i) => {
        const a = id < 0 ? arcs[~id].slice().reverse() : arcs[id];
        pts.push(...(i ? a.slice(1) : a));
      });
      return pts;
    };
    const rings = (geom) => {
      if (geom.type === 'Polygon') return geom.arcs.map(ring);
      if (geom.type === 'MultiPolygon') return geom.arcs.flatMap((poly) => poly.map(ring));
      return [];
    };
    return {
      land: topo.objects.land.geometries.flatMap(rings),
      countries: topo.objects.countries.geometries.flatMap(rings),
    };
  }

  // מוסיף טבעת למסלול, כולל טיפול בקו התאריך ובאנטארקטיקה
  function addRing(c, ring, w, h, offset, closePole) {
    let prev = null, shift = 0;
    const pts = ring.map(([lo, la]) => {
      if (prev !== null) {
        if (lo + shift - prev > 180) shift -= 360;
        else if (lo + shift - prev < -180) shift += 360;
      }
      prev = lo + shift;
      return [lo + shift, la];
    });
    const lons = pts.map((p) => p[0]);
    const span = Math.max(...lons) - Math.min(...lons);
    if (closePole && span > 350) {
      const last = pts[pts.length - 1], first = pts[0];
      pts.push([last[0], -90], [first[0], -90]);
    }
    pts.forEach(([lo, la], i) => {
      const x = (lo + 180) / 360 * w + offset;
      const y = (90 - la) / 180 * h;
      i ? c.lineTo(x, y) : c.moveTo(x, y);
    });
    c.closePath();
  }

  function landPath(c, rings, w, h, closePole = true) {
    c.beginPath();
    for (const off of [-w, 0, w]) for (const r of rings) addRing(c, r, w, h, off, closePole);
  }

  function seeded(seed) {
    return () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  }

  function buildTexture(world) {
    const tex = document.createElement('canvas');
    tex.width = TEX_W; tex.height = TEX_H;
    const c = tex.getContext('2d');
    const lat2y = (la) => (90 - la) / 180 * TEX_H;

    // אוקיינוס
    const og = c.createLinearGradient(0, 0, 0, TEX_H);
    og.addColorStop(0, '#0b2244'); og.addColorStop(0.3, '#0e3466'); og.addColorStop(0.5, '#0f3d78');
    og.addColorStop(0.7, '#0e3466'); og.addColorStop(1, '#0b2244');
    c.fillStyle = og; c.fillRect(0, 0, TEX_W, TEX_H);

    // מים רדודים ליד החופים
    const sh = document.createElement('canvas');
    sh.width = 1024; sh.height = 512;
    const s = sh.getContext('2d');
    s.filter = 'blur(4px)';
    s.fillStyle = '#1f6aa8';
    landPath(s, world.land, 1024, 512);
    s.fill('evenodd');
    s.filter = 'blur(1.5px)';
    s.fillStyle = '#2b86bd';
    landPath(s, world.land, 1024, 512);
    s.fill('evenodd');
    c.imageSmoothingEnabled = true;
    c.drawImage(sh, 0, 0, TEX_W, TEX_H);

    // יבשה עם אזורי אקלים לפי קו רוחב
    c.save();
    landPath(c, world.land, TEX_W, TEX_H);
    c.clip('evenodd');
    const lg = c.createLinearGradient(0, 0, 0, TEX_H);
    const stops = [[90, '#f2f6f8'], [72, '#dfe7ea'], [64, '#5e6f4c'], [55, '#3f6b35'], [45, '#56843d'],
      [35, '#9b9a5a'], [26, '#d2b77a'], [18, '#c9a462'], [10, '#5d8a35'], [0, '#2f7a2c'], [-10, '#3a7d30'],
      [-20, '#a8955a'], [-28, '#c8a96b'], [-38, '#6c8f45'], [-50, '#557a3c'], [-60, '#cfd9dd'], [-90, '#f4f8fa']];
    for (const [la, col] of stops) lg.addColorStop((90 - la) / 180, col);
    c.fillStyle = lg;
    c.fillRect(0, 0, TEX_W, TEX_H);
    // טקסטורת שטח: הרים, יערות ומדבריות
    // מצוירת בקטן ומוגדלת: ההגדלה מטשטשת בחינם
    const rnd = seeded(1234567);
    const nz = document.createElement('canvas');
    nz.width = 512; nz.height = 256;
    const n = nz.getContext('2d');
    for (let i = 0; i < 5000; i++) {
      const x = rnd() * 512, y = rnd() * 256, s = 0.8 + rnd() * 3.2;
      const t = rnd();
      n.fillStyle = t < 0.45 ? `rgba(20,50,15,${0.06 + rnd() * 0.1})`
        : t < 0.75 ? `rgba(255,240,200,${0.04 + rnd() * 0.06})`
        : `rgba(90,70,45,${0.05 + rnd() * 0.08})`;
      n.beginPath(); n.ellipse(x, y, s * (1 + rnd()), s, rnd() * Math.PI, 0, Math.PI * 2); n.fill();
    }
    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = 'high';
    c.drawImage(nz, 0, 0, TEX_W, TEX_H);
    // כיפות קרח
    const ice = c.createLinearGradient(0, 0, 0, TEX_H);
    ice.addColorStop(0, 'rgba(245,250,255,1)'); ice.addColorStop(lat2y(68) / TEX_H, 'rgba(245,250,255,0)');
    ice.addColorStop(lat2y(-62) / TEX_H, 'rgba(245,250,255,0)'); ice.addColorStop(1, 'rgba(245,250,255,1)');
    c.fillStyle = ice; c.fillRect(0, 0, TEX_W, TEX_H);
    c.restore();

    // קווי חוף וגבולות
    c.lineJoin = 'round';
    c.strokeStyle = 'rgba(255,255,255,0.22)';
    c.lineWidth = 1.6;
    for (const off of [-TEX_W, 0, TEX_W]) {
      for (const r of world.countries) { c.beginPath(); addRing(c, r, TEX_W, TEX_H, off, false); c.stroke(); }
    }
    c.strokeStyle = 'rgba(190,230,255,0.35)';
    c.lineWidth = 2;
    landPath(c, world.land, TEX_W, TEX_H, false);
    c.stroke();
    // קו המשווה וקווי רוחב עדינים
    c.strokeStyle = 'rgba(255,255,255,0.05)';
    c.lineWidth = 1;
    for (let la = -60; la <= 60; la += 30) { c.beginPath(); c.moveTo(0, lat2y(la)); c.lineTo(TEX_W, lat2y(la)); c.stroke(); }
    return tex;
  }

  function buildMask(world) {
    const m = document.createElement('canvas');
    m.width = MASK_W; m.height = MASK_H;
    const c = m.getContext('2d', { willReadFrequently: true });
    c.fillStyle = '#000'; c.fillRect(0, 0, MASK_W, MASK_H);
    c.fillStyle = '#fff';
    landPath(c, world.land, MASK_W, MASK_H);
    c.fill('evenodd');
    mask = c.getImageData(0, 0, MASK_W, MASK_H).data;
  }

  function uploadTexture(tex) {
    const t = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.uniform1i(uni.uTex, 0);
    gl.uniform1f(uni.uHasTex, 1);
  }

  async function loadWorld() {
    try {
      const r = await fetch('/countries-110m.json');
      const world = decodeTopo(await r.json());
      // נותן לדפדפן לצייר פריים לפני העבודה הכבדה
      await new Promise((ok) => setTimeout(ok, 30));
      buildMask(world);
      uploadTexture(buildTexture(world));
    } catch (e) {
      console.warn('מפת העולם לא נטענה, משתמש בכוכב מדומה', e);
    }
    ready = true;
  }

  // ---------------- הטלה ----------------
  // lat/lon במעלות -> נקודה על המסך (פיקסלים של CSS). z>0 = הצד הנראה
  function project(lat, lon, alt = 1) {
    const f = lat * DEG, l = lon * DEG, a = view.lon * DEG, b = view.lat * DEG;
    const x = Math.cos(f) * Math.sin(l), y = Math.sin(f), z = Math.cos(f) * Math.cos(l);
    const x1 = x * Math.cos(a) - z * Math.sin(a);
    const z1 = x * Math.sin(a) + z * Math.cos(a);
    const y2 = y * Math.cos(b) - z1 * Math.sin(b);
    const z2 = y * Math.sin(b) + z1 * Math.cos(b);
    return { x: cx + x1 * R * alt, y: cy - y2 * R * alt, z: z2 };
  }

  function unproject(sx, sy) {
    const nx = (sx - cx) / R, ny = (cy - sy) / R;
    const r2 = nx * nx + ny * ny;
    if (r2 > 1) return null;
    const nz = Math.sqrt(1 - r2);
    const a = view.lon * DEG, b = view.lat * DEG;
    const y = ny * Math.cos(b) + nz * Math.sin(b);
    const z1 = -ny * Math.sin(b) + nz * Math.cos(b);
    const x = nx * Math.cos(a) + z1 * Math.sin(a);
    const z = -nx * Math.sin(a) + z1 * Math.cos(a);
    return { lat: Math.asin(Math.max(-1, Math.min(1, y))) / DEG, lon: Math.atan2(x, z) / DEG };
  }

  // נקודה במרחק זוויתי dist ובכיוון bearing ממרכז
  function offset(lat, lon, bearing, dist) {
    const f1 = lat * DEG, l1 = lon * DEG, br = bearing * DEG, d = dist * DEG;
    const f2 = Math.asin(Math.sin(f1) * Math.cos(d) + Math.cos(f1) * Math.sin(d) * Math.cos(br));
    const l2 = l1 + Math.atan2(Math.sin(br) * Math.sin(d) * Math.cos(f1), Math.cos(d) - Math.sin(f1) * Math.sin(f2));
    return [f2 / DEG, l2 / DEG];
  }

  // אינטרפולציה על מעגל גדול
  function slerp(lat1, lon1, lat2, lon2, t) {
    const v = (la, lo) => [Math.cos(la * DEG) * Math.cos(lo * DEG), Math.cos(la * DEG) * Math.sin(lo * DEG), Math.sin(la * DEG)];
    const A = v(lat1, lon1), B = v(lat2, lon2);
    const dot = Math.max(-1, Math.min(1, A[0] * B[0] + A[1] * B[1] + A[2] * B[2]));
    const om = Math.acos(dot);
    if (om < 1e-6) return [lat1, lon1];
    const s1 = Math.sin((1 - t) * om) / Math.sin(om), s2 = Math.sin(t * om) / Math.sin(om);
    const P = [A[0] * s1 + B[0] * s2, A[1] * s1 + B[1] * s2, A[2] * s1 + B[2] * s2];
    return [Math.asin(P[2]) / DEG, Math.atan2(P[1], P[0]) / DEG];
  }

  function isLand(lat, lon) {
    if (!mask) return true;
    const x = Math.floor(((lon + 180) / 360) * MASK_W) % MASK_W;
    const y = Math.min(MASK_H - 1, Math.max(0, Math.floor(((90 - lat) / 180) * MASK_H)));
    return mask[(y * MASK_W + x) * 4] > 127;
  }

  // ---------------- תנועה ----------------
  function flyTo(lat, lon, zoom = view.zoom, dur = 1200) {
    let dl = ((lon - view.lon + 540) % 360) - 180;
    anim.from = { lat: view.lat, lon: view.lon, zoom: view.zoom };
    anim.to = { lat: Math.max(-80, Math.min(80, lat)), lon: view.lon + dl, zoom };
    anim.t0 = performance.now();
    anim.dur = dur;
    view.autoSpin = false;
  }

  function stepAnim(t) {
    if (!anim.to) return;
    let k = Math.min(1, (t - anim.t0) / anim.dur);
    const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
    view.lat = anim.from.lat + (anim.to.lat - anim.from.lat) * e;
    view.lon = anim.from.lon + (anim.to.lon - anim.from.lon) * e;
    view.zoom = anim.from.zoom + (anim.to.zoom - anim.from.zoom) * e;
    if (k >= 1) anim.to = null;
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    for (const c of [glCanvas, overlay]) {
      c.width = Math.floor(W * dpr); c.height = Math.floor(H * dpr);
      c.style.width = W + 'px'; c.style.height = H + 'px';
    }
  }

  function frame(t) {
    stepAnim(t);
    if (view.autoSpin && !drag.active) view.lon += 0.04;
    R = Math.min(W, H) * 0.40 * view.zoom;
    cx = W / 2 + (api.shiftX || 0);
    cy = H / 2 + 10;
    const time = (t - t0) / 1000;
    gl.viewport(0, 0, glCanvas.width, glCanvas.height);
    gl.uniform2f(uni.uRes, glCanvas.width, glCanvas.height);
    gl.uniform2f(uni.uCenter, cx * dpr, (H - cy) * dpr);
    gl.uniform1f(uni.uR, R * dpr);
    gl.uniform1f(uni.uLon, view.lon * DEG);
    gl.uniform1f(uni.uLat, view.lat * DEG);
    gl.uniform1f(uni.uTime, time);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    try {
      if (api.onDraw) api.onDraw(ctx, time);
    } catch (e) {
      console.error(e);
      ctx.setLineDash([]); ctx.globalAlpha = 1;
    }
    requestAnimationFrame(frame);
  }

  // ---------------- עכבר ומגע ----------------
  const drag = { active: false, moved: 0, x: 0, y: 0, pointers: new Map(), pinch: 0 };
  function bindInput() {
    overlay.addEventListener('pointerdown', (e) => {
      overlay.setPointerCapture(e.pointerId);
      drag.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      drag.active = true; drag.moved = 0; drag.x = e.clientX; drag.y = e.clientY;
      anim.to = null;
      if (drag.pointers.size === 2) {
        const [a, b] = [...drag.pointers.values()];
        drag.pinch = Math.hypot(a.x - b.x, a.y - b.y);
      }
    });
    overlay.addEventListener('pointermove', (e) => {
      if (!drag.active) {
        if (api.onHover) api.onHover(e.clientX, e.clientY);
        return;
      }
      drag.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (drag.pointers.size === 2) {
        const [a, b] = [...drag.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (drag.pinch) setZoom(view.zoom * d / drag.pinch);
        drag.pinch = d;
        drag.moved += 10;
        return;
      }
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.moved += Math.abs(dx) + Math.abs(dy);
      drag.x = e.clientX; drag.y = e.clientY;
      const k = 57.3 / R;
      view.lon -= dx * k;
      view.lat = Math.max(-80, Math.min(80, view.lat + dy * k));
      if (drag.moved > 4) view.autoSpin = false;
    });
    const up = (e) => {
      drag.pointers.delete(e.pointerId);
      if (drag.pointers.size) return;
      if (drag.active && drag.moved < 6 && api.onClick) {
        api.onClick(e.clientX, e.clientY, unproject(e.clientX, e.clientY));
      }
      drag.active = false;
      drag.pinch = 0;
    };
    overlay.addEventListener('pointerup', up);
    overlay.addEventListener('pointercancel', up);
    overlay.addEventListener('wheel', (e) => {
      e.preventDefault();
      anim.to = null;
      setZoom(view.zoom * Math.pow(1.0015, -e.deltaY));
    }, { passive: false });
  }

  function setZoom(z) { view.zoom = Math.max(0.7, Math.min(6, z)); }

  // ---------------- התחלה ----------------
  api.init = (glEl, overlayEl) => {
    glCanvas = glEl; overlay = overlayEl;
    ctx = overlay.getContext('2d');
    initGL();
    resize();
    window.addEventListener('resize', resize);
    bindInput();
    requestAnimationFrame(frame);
    return loadWorld();
  };
  Object.assign(api, {
    project, unproject, offset, slerp, isLand, flyTo, setZoom,
    get radius() { return R; },
    get center() { return { x: cx, y: cy }; },
    get size() { return { w: W, h: H }; },
    get ready() { return ready; },
  });
  return api;
})();
