(function () {
  'use strict';

  var CELL = 82, BLOCK = 64, ROAD = 18, N = 6;
  var HALF = N * CELL / 2;
  var BOUND = HALF + ROAD / 2 + 8;
  var MAX_SPEED = 52, ACC = 21, BRAKE = 30, REV_MAX = 12;
  var TOTAL_CP = 11;
  var BEST_KEY = 'mtable.cityRacer.best';

  var $ = function (id) { return document.getElementById(id); };
  var sceneEl = $('scene');
  var hudEl = $('hud');
  var timeEl = $('timeEl'), cpEl = $('cpEl'), progEl = $('progEl'), kmhEl = $('kmhEl');
  var driftBox = $('driftBox'), driftEl = $('driftEl'), comboEl = $('comboEl'), driftTotalEl = $('driftTotalEl');
  var arrowEl = $('arrow'), countdownEl = $('countdown'), flashEl = $('flash');
  var startScreen = $('startScreen'), pauseScreen = $('pauseScreen'), resultScreen = $('resultScreen');
  var bestEl = $('bestEl'), hintEl = $('hint');
  var rTime = $('rTime'), rDrift = $('rDrift'), rBonus = $('rBonus'), rTotal = $('rTotal'), newRecordEl = $('newRecord');

  var renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputEncoding = THREE.sRGBEncoding;
  sceneEl.appendChild(renderer.domElement);

  var scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x5a3d68, 170, 640);
  var camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 1600);
  camera.position.set(0, 20, -40);

  var skyGeo = new THREE.SphereGeometry(1400, 24, 16);
  var skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      cTop: { value: new THREE.Color(0x150d2e) },
      cMid: { value: new THREE.Color(0x4a2a6a) },
      cBot: { value: new THREE.Color(0xff8c5a) }
    },
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'varying vec3 vP; uniform vec3 cTop; uniform vec3 cMid; uniform vec3 cBot; void main(){ float h = normalize(vP).y; vec3 c = h > 0.18 ? mix(cMid, cTop, smoothstep(0.18, 0.75, h)) : mix(cBot, cMid, smoothstep(-0.05, 0.18, h)); gl_FragColor = vec4(c, 1.0); }'
  });
  scene.add(new THREE.Mesh(skyGeo, skyMat));

  var sunDir = new THREE.DirectionalLight(0xffb070, 1.25);
  sunDir.position.set(420, 130, 260);
  scene.add(sunDir);
  scene.add(new THREE.HemisphereLight(0x8a7ab8, 0x2a2438, 0.65));
  var sunBall = new THREE.Mesh(new THREE.SphereGeometry(34, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffd9a0, fog: false }));
  sunBall.position.set(1050, 190, 660);
  scene.add(sunBall);

  var ground = new THREE.Mesh(new THREE.PlaneGeometry(BOUND * 2 + 260, BOUND * 2 + 260), new THREE.MeshLambertMaterial({ color: 0x2b2b31 }));
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  var dummy = new THREE.Object3D();
  var rects = [];
  var padMat = new THREE.MeshLambertMaterial({ color: 0x4a4a54 });
  var padMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), padMat, N * N);
  padMesh.position.y = 0;
  scene.add(padMesh);

  var buildPal = [0x3a4a6a, 0x5a4a7a, 0x6a5a8a, 0x465878, 0x7a6a5a, 0x52466e];
  var buildMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0.05, flatShading: true }), 200);
  var winMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xffd27a }), 1500);
  scene.add(buildMesh); scene.add(winMesh);

  var bi = 0, wi = 0, tmpColor = new THREE.Color();
  function addBuilding(cx, cz, w, d, h) {
    dummy.position.set(cx, h / 2, cz);
    dummy.scale.set(w, h, d);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    buildMesh.setMatrixAt(bi, dummy.matrix);
    tmpColor.setHex(buildPal[(Math.random() * buildPal.length) | 0]);
    tmpColor.offsetHSL(0, 0, (Math.random() - 0.5) * 0.08);
    buildMesh.setColorAt(bi, tmpColor);
    bi++;
    var nWin = Math.min(2 + (h * 0.14) | 0, 8);
    for (var k = 0; k < nWin && wi < 1500; k++) {
      var side = (Math.random() * 4) | 0;
      var u = (Math.random() - 0.5) * 0.7;
      var wy = 2 + Math.random() * Math.max(1, h - 3.5);
      if (side < 2) {
        dummy.position.set(cx + u * w, wy, cz + (side === 0 ? d / 2 + 0.06 : -d / 2 - 0.06));
        dummy.scale.set(1.1, 1.4, 0.12);
      } else {
        dummy.position.set(cx + (side === 2 ? w / 2 + 0.06 : -w / 2 - 0.06), wy, cz + u * d);
        dummy.scale.set(0.12, 1.4, 1.1);
      }
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      winMesh.setMatrixAt(wi, dummy.matrix);
      tmpColor.setHSL(0.11 + Math.random() * 0.04, 0.75, 0.55 + Math.random() * 0.2);
      winMesh.setColorAt(wi, tmpColor);
      wi++;
    }
  }

  var pi = 0;
  for (var gx = 0; gx < N; gx++) {
    for (var gz = 0; gz < N; gz++) {
      var cx = gx * CELL + CELL / 2 - HALF;
      var cz = gz * CELL + CELL / 2 - HALF;
      dummy.position.set(cx, 0.3, cz);
      dummy.scale.set(BLOCK, 0.6, BLOCK);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      padMesh.setMatrixAt(pi, dummy.matrix);
      pi++;
      rects.push({ minX: cx - BLOCK / 2, maxX: cx + BLOCK / 2, minZ: cz - BLOCK / 2, maxZ: cz + BLOCK / 2 });
      var inset = 7, A = BLOCK - inset * 2;
      var x0 = cx - A / 2, z0 = cz - A / 2;
      var distC = Math.hypot(cx, cz) / 300;
      var hBase = 9 + Math.max(0, 1 - distC) * 24;
      var t = Math.random();
      if (t < 0.3) {
        addBuilding(cx, cz, A - 6, A - 6, hBase + Math.random() * 22);
      } else if (t < 0.6) {
        addBuilding(x0 + (A / 2 - 2) / 2, cz, A / 2 - 2, A - 4, hBase + Math.random() * 20);
        addBuilding(x0 + A / 2 + 2 + (A / 2 - 2) / 2, cz, A / 2 - 2, A - 4, hBase + Math.random() * 20);
      } else {
        var q = A / 2 - 3;
        addBuilding(x0 + q / 2 + 1, z0 + q / 2 + 1, q, q, hBase + Math.random() * 18);
        addBuilding(x0 + A - q / 2 - 1, z0 + q / 2 + 1, q, q, hBase + Math.random() * 18);
        addBuilding(x0 + q / 2 + 1, z0 + A - q / 2 - 1, q, q, hBase + Math.random() * 18);
        if (Math.random() < 0.7) addBuilding(x0 + A - q / 2 - 1, z0 + A - q / 2 - 1, q, q, hBase + Math.random() * 18);
      }
    }
  }
  buildMesh.count = bi; winMesh.count = wi;
  if (buildMesh.instanceColor) buildMesh.instanceColor.needsUpdate = true;
  if (winMesh.instanceColor) winMesh.instanceColor.needsUpdate = true;

  var dashGeoX = new THREE.BoxGeometry(3.2, 0.04, 0.3);
  var dashMat = new THREE.MeshBasicMaterial({ color: 0xd8b23a });
  var dashMesh = new THREE.InstancedMesh(dashGeoX, dashMat, 760);
  scene.add(dashMesh);
  var di = 0;
  for (var li = 0; li <= N; li++) {
    var lc = li * CELL - HALF;
    for (var s = -BOUND + 8; s < BOUND - 8; s += 12) {
      if (di >= 760) break;
      dummy.position.set(lc, 0.03, s);
      dummy.rotation.set(0, Math.PI / 2, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      dashMesh.setMatrixAt(di, dummy.matrix); di++;
      dummy.position.set(s, 0.03, lc);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      dashMesh.setMatrixAt(di, dummy.matrix); di++;
    }
  }
  dashMesh.count = di;

  var lampCap = 120, palmCap = 48;
  var poleMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.14, 0.18, 6.4, 5), new THREE.MeshLambertMaterial({ color: 0x33323c }), lampCap);
  var lampHeadMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.42, 6, 5), new THREE.MeshBasicMaterial({ color: 0xffe0a0 }), lampCap);
  var trunkMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.22, 0.34, 5.2, 6), new THREE.MeshLambertMaterial({ color: 0x6a4a32 }), palmCap);
  var leafMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1.9, 0), new THREE.MeshLambertMaterial({ color: 0x3f7a4a, flatShading: true }), palmCap);
  scene.add(poleMesh, lampHeadMesh, trunkMesh, leafMesh);
  var li2 = 0, pj = 0;
  for (gx = 0; gx < N; gx++) {
    for (gz = 0; gz < N; gz++) {
      cx = gx * CELL + CELL / 2 - HALF;
      cz = gz * CELL + CELL / 2 - HALF;
      var e = BLOCK / 2 + 2.6;
      var corners = [[cx - e, cz - e], [cx + e, cz + e]];
      for (var c2 = 0; c2 < 2 && li2 < lampCap; c2++) {
        dummy.position.set(corners[c2][0], 3.2, corners[c2][1]);
        dummy.scale.set(1, 1, 1); dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix(); poleMesh.setMatrixAt(li2, dummy.matrix);
        dummy.position.set(corners[c2][0], 6.5, corners[c2][1]);
        dummy.updateMatrix(); lampHeadMesh.setMatrixAt(li2, dummy.matrix);
        li2++;
      }
      if (Math.random() < 0.4 && pj < palmCap) {
        var pe = BLOCK / 2 + 3.4;
        var sx2 = cx + (Math.random() < 0.5 ? -pe : pe);
        var sz2 = cz + (Math.random() - 0.5) * BLOCK * 0.6;
        dummy.position.set(sx2, 2.6, sz2); dummy.scale.set(1, 1, 1); dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix(); trunkMesh.setMatrixAt(pj, dummy.matrix);
        dummy.position.set(sx2, 5.8, sz2);
        dummy.scale.set(1, 0.62, 1);
        dummy.rotation.set(0, Math.random() * 3, 0);
        dummy.updateMatrix(); leafMesh.setMatrixAt(pj, dummy.matrix);
        pj++;
      }
    }
  }
  poleMesh.count = li2; lampHeadMesh.count = li2; trunkMesh.count = pj; leafMesh.count = pj;

  var GATES = [
    { x: -164, z: -246, h: Math.PI / 2 },
    { x: 41, z: -246, h: Math.PI / 2 },
    { x: 246, z: -82, h: 0 },
    { x: 164, z: 82, h: -Math.PI / 2 },
    { x: 82, z: 164, h: 0 },
    { x: -82, z: 246, h: -Math.PI / 2 },
    { x: -246, z: 82, h: Math.PI },
    { x: -164, z: -82, h: Math.PI / 2 },
    { x: -82, z: -123, h: Math.PI },
    { x: -123, z: -164, h: -Math.PI / 2 },
    { x: -164, z: -205, h: Math.PI }
  ];

  var gates = [];
  var pillarGeo = new THREE.CylinderGeometry(0.4, 0.5, 7, 8);
  var curtainGeo = new THREE.PlaneGeometry(ROAD - 2, 5.4);
  for (var gi2 = 0; gi2 < GATES.length; gi2++) {
    var g = GATES[gi2];
    var grp = new THREE.Group();
    grp.position.set(g.x, 0, g.z);
    grp.rotation.y = g.h;
    var pMat = new THREE.MeshBasicMaterial({ color: 0x6a4a9a });
    var cMat = new THREE.MeshBasicMaterial({ color: 0x8a5aff, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false });
    var pw = ROAD / 2 + 1.2;
    var p1 = new THREE.Mesh(pillarGeo, pMat); p1.position.set(pw, 3.5, 0);
    var p2 = new THREE.Mesh(pillarGeo, pMat); p2.position.set(-pw, 3.5, 0);
    var cur = new THREE.Mesh(curtainGeo, cMat); cur.position.y = 2.7;
    grp.add(p1, p2, cur);
    scene.add(grp);
    gates.push({ x: g.x, z: g.z, h: g.h, grp: grp, pMat: pMat, cMat: cMat, flash: 0 });
  }

  var car = { x: -190, z: -246, h: Math.PI / 2, vx: 0, vz: 0 };
  var carGroup = new THREE.Group();
  var bodyTilt = new THREE.Group();
  carGroup.add(bodyTilt);
  scene.add(carGroup);
  var paint = new THREE.MeshStandardMaterial({ color: 0xe63a6a, roughness: 0.3, metalness: 0.55 });
  var glassMat = new THREE.MeshStandardMaterial({ color: 0x1a2438, roughness: 0.15, metalness: 0.7 });
  var body = new THREE.Mesh(new THREE.BoxGeometry(2, 0.55, 4.4), paint); body.position.y = 0.62;
  var cabin = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.5, 2.1), glassMat); cabin.position.set(0, 1.1, -0.25);
  var spoiler = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.1, 0.5), paint); spoiler.position.set(0, 1.12, -2.15);
  var hlMat = new THREE.MeshBasicMaterial({ color: 0xfff2c8 });
  var tlMat = new THREE.MeshBasicMaterial({ color: 0xff3030 });
  var hl1 = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.16, 0.1), hlMat); hl1.position.set(0.6, 0.68, 2.2);
  var hl2 = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.16, 0.1), hlMat); hl2.position.set(-0.6, 0.68, 2.2);
  var tl1 = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.14, 0.1), tlMat); tl1.position.set(0.62, 0.7, -2.2);
  var tl2 = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.14, 0.1), tlMat); tl2.position.set(-0.62, 0.7, -2.2);
  bodyTilt.add(body, cabin, spoiler, hl1, hl2, tl1, tl2);
  var headGlow = new THREE.PointLight(0xffe8b0, 0.7, 26); headGlow.position.set(0, 1, 4); carGroup.add(headGlow);

  var wheelGeo = new THREE.CylinderGeometry(0.44, 0.44, 0.32, 14);
  wheelGeo.rotateZ(Math.PI / 2);
  var wheelMat = new THREE.MeshStandardMaterial({ color: 0x15151a, roughness: 0.9 });
  var hubMat = new THREE.MeshStandardMaterial({ color: 0xc0c4cc, metalness: 0.8, roughness: 0.3 });
  var wheels = [];
  var wpos = [[0.98, 1.38], [-0.98, 1.38], [0.98, -1.42], [-0.98, -1.42]];
  for (var wI = 0; wI < 4; wI++) {
    var pivot = new THREE.Group();
    pivot.position.set(wpos[wI][0], 0.44, wpos[wI][1]);
    var wm = new THREE.Mesh(wheelGeo, wheelMat);
    var hub = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.34, 8).rotateZ(Math.PI / 2), hubMat);
    wm.add(hub);
    pivot.add(wm);
    bodyTilt.add(pivot);
    wheels.push({ pivot: pivot, mesh: wm, front: wI < 2 });
  }
  var shadow = new THREE.Mesh(new THREE.CircleGeometry(2.5, 16), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.02; shadow.scale.set(0.85, 1.4, 1);
  carGroup.add(shadow);

  var skidMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.36, 1.0), new THREE.MeshBasicMaterial({ color: 0x0a0a0e, transparent: true, opacity: 0.5, depthWrite: false }), 480);
  skidMesh.count = 0;
  scene.add(skidMesh);
  var skidIdx = 0, skidTotal = 0;
  function addSkid(x, z, h) {
    dummy.position.set(x, 0.035, z);
    dummy.rotation.set(-Math.PI / 2, 0, -h);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    skidMesh.setMatrixAt(skidIdx, dummy.matrix);
    skidIdx = (skidIdx + 1) % 480;
    skidTotal++;
    skidMesh.count = Math.min(skidTotal, 480);
    skidMesh.instanceMatrix.needsUpdate = true;
  }

  var SMAX = 260;
  var smokeTex = (function () {
    var c = document.createElement('canvas'); c.width = c.height = 64;
    var g = c.getContext('2d');
    var gr = g.createRadialGradient(32, 32, 2, 32, 32, 30);
    gr.addColorStop(0, 'rgba(255,255,255,0.9)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  var smokeGeo = new THREE.BufferGeometry();
  var sPos = new Float32Array(SMAX * 3), sCol = new Float32Array(SMAX * 3);
  var sVel = new Float32Array(SMAX * 3), sLife = new Float32Array(SMAX);
  for (var si = 0; si < SMAX; si++) { sPos[si * 3 + 1] = -100; }
  smokeGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
  smokeGeo.setAttribute('color', new THREE.BufferAttribute(sCol, 3));
  var smoke = new THREE.Points(smokeGeo, new THREE.PointsMaterial({ size: 1.6, map: smokeTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }));
  smoke.frustumCulled = false;
  scene.add(smoke);
  var sHead = 0;
  function spawnSmoke(x, y, z) {
    var i = sHead; sHead = (sHead + 1) % SMAX;
    sPos[i * 3] = x + (Math.random() - 0.5) * 0.5;
    sPos[i * 3 + 1] = y;
    sPos[i * 3 + 2] = z + (Math.random() - 0.5) * 0.5;
    sVel[i * 3] = (Math.random() - 0.5) * 2.5;
    sVel[i * 3 + 1] = 1.6 + Math.random() * 1.6;
    sVel[i * 3 + 2] = (Math.random() - 0.5) * 2.5;
    sLife[i] = 0.9 + Math.random() * 0.4;
  }

  var audio = null;
  function initAudio() {
    if (audio) return;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    var ctx = new AC();
    var master = ctx.createGain(); master.gain.value = 0.5; master.connect(ctx.destination);
    var engOsc = ctx.createOscillator(); engOsc.type = 'sawtooth'; engOsc.frequency.value = 70;
    var engOsc2 = ctx.createOscillator(); engOsc2.type = 'square'; engOsc2.frequency.value = 35;
    var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 650;
    var engGain = ctx.createGain(); engGain.gain.value = 0;
    engOsc.connect(lp); engOsc2.connect(lp); lp.connect(engGain); engGain.connect(master);
    engOsc.start(); engOsc2.start();
    var nb = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    var nd = nb.getChannelData(0);
    for (var i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    var nSrc = ctx.createBufferSource(); nSrc.buffer = nb; nSrc.loop = true;
    var bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1300; bp.Q.value = 0.8;
    var driftGain = ctx.createGain(); driftGain.gain.value = 0;
    nSrc.connect(bp); bp.connect(driftGain); driftGain.connect(master);
    nSrc.start();
    audio = { ctx: ctx, master: master, engOsc: engOsc, engOsc2: engOsc2, engGain: engGain, lp: lp, driftGain: driftGain, noiseBuf: nb };
  }
  function blip(freq, dur, vol, type) {
    if (!audio) return;
    var t = audio.ctx.currentTime;
    var o = audio.ctx.createOscillator(); o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t);
    var g = audio.ctx.createGain();
    g.gain.setValueAtTime(vol || 0.3, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + (dur || 0.25));
    o.connect(g); g.connect(audio.master);
    o.start(t); o.stop(t + (dur || 0.25) + 0.02);
  }
  function thud(power) {
    if (!audio) return;
    var t = audio.ctx.currentTime;
    var s = audio.ctx.createBufferSource(); s.buffer = audio.noiseBuf;
    var f = audio.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 220;
    var g = audio.ctx.createGain();
    g.gain.setValueAtTime(Math.min(0.5, 0.15 + power * 0.02), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    s.connect(f); f.connect(g); g.connect(audio.master);
    s.start(t); s.stop(t + 0.32);
    blip(70, 0.2, 0.25, 'triangle');
  }
  function fanfare() {
    if (!audio) return;
    [523, 659, 784, 1046].forEach(function (f, i) { setTimeout(function () { blip(f, 0.4, 0.3, 'triangle'); }, i * 130); });
  }

  var keys = {};
  window.addEventListener('keydown', function (e) {
    var k = e.code;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].indexOf(k) >= 0) e.preventDefault();
    keys[k] = true;
    if (k === 'Escape') togglePause();
    if (k === 'KeyR' && state !== 'menu') startRun();
  });
  window.addEventListener('keyup', function (e) { keys[e.code] = false; });

  var state = 'menu';
  var cdT = 0, runTime = 0, shake = 0, wallHitCool = 0;
  var nextCp = 1, passed = 0;
  var driftRun = 0, driftTotal = 0, comboTime = 0, combo = 1, driftGrace = 0, drifting = false;
  var skidCool = 0, smokeCool = 0, wheelSpin = 0, steerVis = 0;
  var camPos = new THREE.Vector3(0, 20, -40);
  var lookAt = new THREE.Vector3();
  var projV = new THREE.Vector3();

  function fmtTime(ms) {
    var t = Math.max(0, ms);
    var m = Math.floor(t / 60000), s = Math.floor(t / 1000) % 60, mm = Math.floor(t % 1000);
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s + '.' + (mm < 100 ? (mm < 10 ? '00' : '0') : '') + mm;
  }
  function loadBest() {
    try { return JSON.parse(localStorage.getItem(BEST_KEY)); } catch (e) { return null; }
  }
  function showBest() {
    var b = loadBest();
    bestEl.innerHTML = b ? ('最佳纪录：<b>' + b.score + '</b> 分 · 用时 <b>' + fmtTime(b.time) + '</b>') : '最佳纪录：暂无';
  }
  showBest();

  function resetCar() {
    car.x = -190; car.z = -246; car.h = Math.PI / 2; car.vx = 0; car.vz = 0;
    carGroup.position.set(car.x, 0, car.z);
    carGroup.rotation.y = car.h;
    bodyTilt.rotation.set(0, 0, 0);
    for (var i = 0; i < gates.length; i++) { gates[i].flash = 0; }
    skidIdx = 0; skidTotal = 0; skidMesh.count = 0;
    for (i = 0; i < SMAX; i++) { sLife[i] = 0; sPos[i * 3 + 1] = -100; sCol[i * 3] = sCol[i * 3 + 1] = sCol[i * 3 + 2] = 0; }
    var back = -8;
    camPos.set(car.x - Math.sin(car.h) * back, 5, car.z - Math.cos(car.h) * back);
    shake = 0;
  }

  function startRun() {
    state = 'countdown';
    cdT = 3.6; runTime = 0;
    nextCp = 1; passed = 0;
    driftRun = 0; driftTotal = 0; comboTime = 0; combo = 1; driftGrace = 0;
    resumeTo = 'countdown'; lastCdShown = -1;
    resetCar();
    startScreen.classList.add('hidden');
    pauseScreen.classList.add('hidden');
    resultScreen.classList.add('hidden');
    hudEl.style.display = 'block';
    hintEl.style.display = 'none';
    countdownEl.style.display = 'block';
    if (audio && audio.ctx.state === 'suspended') audio.ctx.resume();
  }

  function togglePause() {
    if (state === 'running' || state === 'countdown') {
      state = 'paused';
      pauseScreen.classList.remove('hidden');
      if (audio) audio.ctx.suspend();
    } else if (state === 'paused') {
      state = resumeTo;
      pauseScreen.classList.add('hidden');
      if (audio) audio.ctx.resume();
    }
  }
  var resumeTo = 'running';

  function finishRun() {
    state = 'finished';
    var bonus = Math.max(0, Math.round((240 - runTime / 1000) * 15));
    var total = Math.round(driftTotal) + bonus;
    rTime.textContent = fmtTime(runTime);
    rDrift.textContent = Math.round(driftTotal);
    rBonus.textContent = bonus;
    rTotal.textContent = total;
    var best = loadBest();
    var isNew = !best || total > best.score;
    newRecordEl.style.display = isNew ? 'block' : 'none';
    if (isNew) { try { localStorage.setItem(BEST_KEY, JSON.stringify({ score: total, time: Math.round(runTime) })); } catch (e) { } }
    resultScreen.classList.remove('hidden');
    hudEl.style.display = 'none';
    fanfare();
    showBest();
  }

  $('startBtn').addEventListener('click', function () { initAudio(); startRun(); });
  $('resumeBtn').addEventListener('click', togglePause);
  $('restartBtn').addEventListener('click', function () { pauseScreen.classList.add('hidden'); startRun(); });
  $('againBtn').addEventListener('click', function () { startRun(); });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden && (state === 'running' || state === 'countdown')) togglePause();
  });

  function stepCar(dt) {
    var h = car.h;
    var fx = Math.sin(h), fz = Math.cos(h);
    var rx = Math.cos(h), rz = -Math.sin(h);
    var vfx = car.vx * fx + car.vz * fz;
    var vlat = car.vx * rx + car.vz * rz;
    var up = keys['KeyW'] || keys['ArrowUp'];
    var down = keys['KeyS'] || keys['ArrowDown'];
    var left = keys['KeyA'] || keys['ArrowLeft'];
    var right = keys['KeyD'] || keys['ArrowRight'];
    var hb = keys['Space'];
    if (up) vfx += ACC * dt * Math.max(0.25, 1 - Math.abs(vfx) / MAX_SPEED * 0.75);
    if (down) {
      if (vfx > 0.5) vfx -= BRAKE * dt;
      else vfx = Math.max(vfx - ACC * 0.55 * dt, -REV_MAX);
    }
    if (!up && !down) vfx *= Math.exp(-0.55 * dt);
    if (vfx > MAX_SPEED) vfx = MAX_SPEED;
    vlat *= Math.exp(-(hb ? 1.3 : 6.8) * dt);
    var steer = (left ? 1 : 0) - (right ? 1 : 0);
    var sf = Math.min(Math.abs(vfx) / 9, 1);
    var yaw = steer * 2.15 * sf * (1.15 - Math.min(Math.abs(vfx) / MAX_SPEED, 1) * 0.62);
    if (vfx < -0.5) yaw = -yaw;
    if (hb && Math.abs(vfx) > 6) yaw *= 1.4;
    var slip = Math.atan2(vlat, Math.abs(vfx) + 1);
    var speed = Math.hypot(car.vx, car.vz);
    drifting = speed > 12 && Math.abs(slip) > 0.24;
    if (drifting) {
      driftRun += Math.abs(slip) * speed * dt * 9;
      comboTime += dt;
      combo = 1 + Math.min(comboTime * 0.55, 4);
      driftGrace = 0.3;
    } else if (driftRun > 0) {
      driftGrace -= dt;
      if (driftGrace <= 0) {
        driftTotal += driftRun * combo;
        blip(660, 0.12, 0.12, 'sine');
        driftRun = 0; comboTime = 0; combo = 1;
      }
    }
    car.vx = vfx * fx + vlat * rx;
    car.vz = vfx * fz + vlat * rz;
    h += yaw * dt;
    car.h = h;
    car.x += car.vx * dt;
    car.z += car.vz * dt;
    var r = 2.1;
    for (var i = 0; i < rects.length; i++) {
      var rc = rects[i];
      if (car.x < rc.minX - r || car.x > rc.maxX + r || car.z < rc.minZ - r || car.z > rc.maxZ + r) continue;
      var qx = Math.max(rc.minX, Math.min(car.x, rc.maxX));
      var qz = Math.max(rc.minZ, Math.min(car.z, rc.maxZ));
      var dx = car.x - qx, dz = car.z - qz;
      var d2 = dx * dx + dz * dz;
      if (d2 < r * r) {
        var d = Math.sqrt(d2), nx, nz;
        if (d > 0.001) { nx = dx / d; nz = dz / d; }
        else {
          var ox = Math.min(car.x - rc.minX, rc.maxX - car.x);
          var oz = Math.min(car.z - rc.minZ, rc.maxZ - car.z);
          if (ox < oz) { nx = car.x > (rc.minX + rc.maxX) / 2 ? 1 : -1; nz = 0; }
          else { nx = 0; nz = car.z > (rc.minZ + rc.maxZ) / 2 ? 1 : -1; }
        }
        car.x = qx + nx * r;
        car.z = qz + nz * r;
        var vn = car.vx * nx + car.vz * nz;
        if (vn < 0) {
          car.vx -= 1.55 * vn * nx;
          car.vz -= 1.55 * vn * nz;
          var imp = -vn;
          if (imp > 3) {
            shake = Math.min(shake + imp * 0.016, 0.6);
            if (wallHitCool <= 0) { thud(imp); wallHitCool = 0.18; }
          }
        }
      }
    }
    wallHitCool -= dt;
    if (car.x > BOUND) { car.x = BOUND; if (car.vx > 0) { shake = Math.min(shake + car.vx * 0.01, 0.5); car.vx *= -0.3; } }
    if (car.x < -BOUND) { car.x = -BOUND; if (car.vx < 0) { shake = Math.min(shake - car.vx * 0.01, 0.5); car.vx *= -0.3; } }
    if (car.z > BOUND) { car.z = BOUND; if (car.vz > 0) { shake = Math.min(shake + car.vz * 0.01, 0.5); car.vz *= -0.3; } }
    if (car.z < -BOUND) { car.z = -BOUND; if (car.vz < 0) { shake = Math.min(shake - car.vz * 0.01, 0.5); car.vz *= -0.3; } }
    return { speed: speed, vfx: vfx, yaw: yaw, slip: slip };
  }

  function checkGates() {
    var g = gates[nextCp];
    var dx = car.x - g.x, dz = car.z - g.z;
    if (dx * dx + dz * dz < (ROAD * 0.62) * (ROAD * 0.62)) {
      g.flash = 0.5;
      passed++;
      blip(nextCp === 0 ? 1046 : 880, 0.22, 0.3);
      flashEl.style.transition = 'none';
      flashEl.style.opacity = '0.5';
      requestAnimationFrame(function () {
        flashEl.style.transition = 'opacity 0.35s';
        flashEl.style.opacity = '0';
      });
      if (nextCp === 0) { finishRun(); return; }
      nextCp = (nextCp + 1) % TOTAL_CP;
    }
  }

  function updateCarVisual(dt, info) {
    carGroup.position.set(car.x, 0, car.z);
    carGroup.rotation.y = car.h;
    var targetRoll = THREE.MathUtils.clamp(-info.slip * 0.55, -0.32, 0.32);
    var targetPitch = THREE.MathUtils.clamp((keys['KeyS'] || keys['ArrowDown'] ? 0.05 : 0) - (keys['KeyW'] || keys['ArrowUp'] ? 0.03 : 0), -0.05, 0.06);
    bodyTilt.rotation.z += (targetRoll - bodyTilt.rotation.z) * Math.min(1, 8 * dt);
    bodyTilt.rotation.x += (targetPitch - bodyTilt.rotation.x) * Math.min(1, 6 * dt);
    var steerT = ((keys['KeyA'] || keys['ArrowLeft'] ? 1 : 0) - (keys['KeyD'] || keys['ArrowRight'] ? 1 : 0)) * 0.5;
    steerVis += (steerT - steerVis) * Math.min(1, 10 * dt);
    wheelSpin += (info.vfx / 0.44) * dt;
    for (var i = 0; i < 4; i++) {
      wheels[i].pivot.rotation.y = wheels[i].front ? steerVis : 0;
      wheels[i].mesh.rotation.x = wheelSpin;
    }
    skidCool -= dt; smokeCool -= dt;
    var hb = keys['Space'];
    if ((drifting || (hb && info.speed > 8)) && skidCool <= 0) {
      skidCool = 0.03;
      var fx = Math.sin(car.h), fz = Math.cos(car.h), rx = Math.cos(car.h), rz = -Math.sin(car.h);
      addSkid(car.x - fx * 1.42 + rx * 0.98, car.z - fz * 1.42 + rz * 0.98, car.h);
      addSkid(car.x - fx * 1.42 - rx * 0.98, car.z - fz * 1.42 - rz * 0.98, car.h);
    }
    if (drifting && smokeCool <= 0) {
      smokeCool = 0.025;
      var fx2 = Math.sin(car.h), fz2 = Math.cos(car.h), rx2 = Math.cos(car.h), rz2 = -Math.sin(car.h);
      spawnSmoke(car.x - fx2 * 1.42 + rx2 * 0.98, 0.35, car.z - fz2 * 1.42 + rz2 * 0.98);
      spawnSmoke(car.x - fx2 * 1.42 - rx2 * 0.98, 0.35, car.z - fz2 * 1.42 - rz2 * 0.98);
    }
  }

  function updateSmoke(dt) {
    for (var i = 0; i < SMAX; i++) {
      if (sLife[i] <= 0) continue;
      sLife[i] -= dt;
      var k = sLife[i] / 1.2;
      if (k <= 0) { sPos[i * 3 + 1] = -100; sCol[i * 3] = sCol[i * 3 + 1] = sCol[i * 3 + 2] = 0; continue; }
      sPos[i * 3] += sVel[i * 3] * dt;
      sPos[i * 3 + 1] += sVel[i * 3 + 1] * dt;
      sPos[i * 3 + 2] += sVel[i * 3 + 2] * dt;
      var c = Math.min(1, k) * 0.55;
      sCol[i * 3] = c * 0.9; sCol[i * 3 + 1] = c * 0.85; sCol[i * 3 + 2] = c;
    }
    smokeGeo.attributes.position.needsUpdate = true;
    smokeGeo.attributes.color.needsUpdate = true;
  }

  function updateGates(t) {
    for (var i = 0; i < gates.length; i++) {
      var g = gates[i];
      if (g.flash > 0) {
        g.flash -= 0.02;
        g.pMat.color.setHex(0x7dffc8);
        g.cMat.color.setHex(0x7dffc8);
        g.cMat.opacity = 0.15 + g.flash * 0.7;
      } else if (i === nextCp) {
        var p = 0.5 + 0.5 * Math.sin(t * 6);
        g.pMat.color.setHex(0x5df2c8);
        g.cMat.color.setHex(0x5df2c8);
        g.cMat.opacity = 0.1 + p * 0.12;
      } else {
        g.pMat.color.setHex(0x6a4a9a);
        g.cMat.color.setHex(0x8a5aff);
        g.cMat.opacity = 0.07;
      }
    }
  }

  function updateCamera(dt, info) {
    var back = 8.6 + info.speed * 0.06;
    var tx = car.x - Math.sin(car.h) * back;
    var tz = car.z - Math.cos(car.h) * back;
    var a = 1 - Math.exp(-7 * dt);
    camPos.x += (tx - camPos.x) * a;
    camPos.z += (tz - camPos.z) * a;
    camPos.y += (5.2 - camPos.y) * a;
    shake *= Math.exp(-4 * dt);
    var sx = 0, sy = 0;
    if (shake > 0.005) {
      sx = (Math.random() - 0.5) * shake * 2.2;
      sy = (Math.random() - 0.5) * shake * 1.6;
    }
    camera.position.set(camPos.x + sx, camPos.y + sy, camPos.z);
    lookAt.set(car.x + Math.sin(car.h) * 6 + car.vx * 0.12, 1.4, car.z + Math.cos(car.h) * 6 + car.vz * 0.12);
    camera.lookAt(lookAt);
    var targetFov = 62 + Math.min(info.speed / MAX_SPEED, 1) * 15;
    camera.fov += (targetFov - camera.fov) * Math.min(1, 4 * dt);
    camera.updateProjectionMatrix();
  }

  var W = window.innerWidth, H = window.innerHeight;
  function updateArrow() {
    var g = gates[nextCp];
    projV.set(g.x, 2.2, g.z).project(camera);
    var behind = projV.z > 1;
    var nx = behind ? -projV.x : projV.x;
    var ny = behind ? projV.y : -projV.y;
    var px = (nx * 0.5 + 0.5) * W;
    var py = (ny * 0.5 + 0.5) * H;
    var cx2 = W / 2, cy2 = H / 2;
    var m = 56;
    if (px < m || px > W - m || py < m || py > H - m || behind) {
      var ang = Math.atan2(py - cy2, px - cx2);
      var dx = Math.max(Math.abs(Math.cos(ang)), 0.001);
      var dy = Math.max(Math.abs(Math.sin(ang)), 0.001);
      var rad = Math.min((W / 2 - m) / dx, (H / 2 - m) / dy);
      px = cx2 + Math.cos(ang) * rad;
      py = cy2 + Math.sin(ang) * rad;
      arrowEl.style.opacity = behind ? '0.9' : '0.8';
    } else {
      arrowEl.style.opacity = '0.45';
    }
    var rot = Math.atan2(py - cy2, px - cx2) * 180 / Math.PI + 90;
    arrowEl.style.display = 'flex';
    arrowEl.style.transform = 'translate(-50%,-50%) translate(' + (px - W / 2) + 'px,' + (py - H / 2) + 'px) rotate(' + rot + 'deg)';
  }

  function updateHUD(info) {
    timeEl.textContent = fmtTime(runTime);
    kmhEl.textContent = Math.round(info.speed * 3.6);
    cpEl.textContent = '检查点 ' + passed + '/' + TOTAL_CP;
    progEl.style.width = (passed / TOTAL_CP * 100) + '%';
    if (driftRun > 0) {
      driftBox.classList.add('on');
      driftEl.textContent = '+' + Math.round(driftRun * combo);
      comboEl.textContent = '漂移中 连击 x' + combo.toFixed(1);
    } else {
      driftBox.classList.remove('on');
    }
    driftTotalEl.textContent = Math.round(driftTotal);
    updateArrow();
  }

  function updateAudio(info, paused) {
    if (!audio) return;
    if (paused) return;
    if (state === 'finished' || state === 'menu') {
      audio.engGain.gain.setTargetAtTime(0, audio.ctx.currentTime, 0.1);
      audio.driftGain.gain.setTargetAtTime(0, audio.ctx.currentTime, 0.1);
      return;
    }
    var sr = Math.min(info.speed / MAX_SPEED, 1);
    var rev = (keys['KeyW'] || keys['ArrowUp']) ? 1 : 0;
    var f = 62 + sr * 150 + rev * 30;
    audio.engOsc.frequency.setTargetAtTime(f, audio.ctx.currentTime, 0.06);
    audio.engOsc2.frequency.setTargetAtTime(f * 0.5, audio.ctx.currentTime, 0.06);
    audio.lp.frequency.setTargetAtTime(500 + sr * 900, audio.ctx.currentTime, 0.1);
    audio.engGain.gain.setTargetAtTime(0.05 + sr * 0.1 + rev * 0.03, audio.ctx.currentTime, 0.08);
    audio.driftGain.gain.setTargetAtTime(drifting ? 0.16 + Math.min(Math.abs(info.slip), 0.8) * 0.14 : 0, audio.ctx.currentTime, 0.05);
  }

  var lastCdShown = -1;
  function updateCountdown(dt) {
    cdT -= dt;
    var n = Math.ceil(cdT);
    if (cdT <= 0) {
      countdownEl.textContent = 'GO!';
      countdownEl.style.color = '#5df2c8';
      if (lastCdShown !== 0) { blip(1320, 0.3, 0.35, 'triangle'); lastCdShown = 0; }
      if (cdT < -0.7) {
        countdownEl.style.display = 'none';
        countdownEl.style.color = '#fff';
        state = 'running';
        resumeTo = 'running';
        lastCdShown = -1;
      }
    } else {
      countdownEl.textContent = n;
      if (n !== lastCdShown) { blip(660, 0.15, 0.25, 'square'); lastCdShown = n; }
    }
  }

  window.addEventListener('resize', function () {
    W = window.innerWidth; H = window.innerHeight;
    renderer.setSize(W, H);
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
  });

  var prev = performance.now();
  var tGlobal = 0;
  function loop(now) {
    requestAnimationFrame(loop);
    var dt = Math.min((now - prev) / 1000, 0.05);
    prev = now;
    tGlobal += dt;
    var info = { speed: 0, vfx: 0, yaw: 0, slip: 0 };
    if (state === 'countdown') {
      updateCountdown(dt);
      if (state === 'running') {
        info = stepCar(dt);
      } else {
        updateCarVisual(dt, info);
      }
    } else if (state === 'running') {
      runTime += dt * 1000;
      info = stepCar(dt);
      checkGates();
      updateCarVisual(dt, info);
      updateHUD(info);
    }
    if (state !== 'paused') {
      updateSmoke(dt);
      updateGates(tGlobal);
      updateCamera(dt, info);
      updateAudio(info, false);
    }
    if (state === 'menu') {
      var a2 = tGlobal * 0.12;
      camera.position.set(Math.sin(a2) * 320, 60, Math.cos(a2) * 320);
      camera.lookAt(0, 8, 0);
    }
    renderer.render(scene, camera);
  }
  resetCar();
  requestAnimationFrame(loop);
})();
