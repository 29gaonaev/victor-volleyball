import * as THREE from 'three';

const $ = (id) => document.getElementById(id);
const canvasRoot = $('game');
const loading = $('loading');
const errorMessage = $('error-message');
const startScreen = $('start-screen');
const pointScreen = $('point-screen');
const hud = $('hud');
const clock = new THREE.Clock();
const TAU = Math.PI * 2;
const COURT = { width: 9, halfWidth: 4.5, halfLength: 9, netHeight: 2.43 };
const COLORS = { home: 0xf07652, away: 0x4fc1bd, sand: 0xd8bd91 };

let renderer;
let scene;
let camera;
let ball;
let ballShadow;
let ballVelocity = new THREE.Vector3();
let trail;
let trailPositions;
let renderedTrailPositions;
let trailIndex = 0;
let trailPoints = 16;
let time = 0;
let phase = 'menu';
let lastTouchSide = 0;
let sideTouches = 0;
let rallyCount = 0;
let rallyStartedAt = 0;
let displayedClockSecond = -1;
let homeScore = 0;
let awayScore = 0;
let currentServer = 1;
let calloutTimer = 0;
let lastHitTime = 0;
let serveWait = 0;
let arenaTone;
let crowdLoop;
let audioContext;
let cameraMode = 0;
let cameraFocus = new THREE.Vector3(0, 0, 0);
let pendingPoint = null;

const keys = new Set();

const player = {
  side: 1, x: 0, z: 6.7, vx: 0, vz: 0, y: 0, vy: 0,
  diveTime: 0, jumpTime: 0, swingTime: 0, targetX: 0, targetZ: 5.2
};
const teammates = [
  { side: 1, x: -3.1, z: 4.8, vx: 0, vz: 0, targetX: -3.1, targetZ: 4.8, swingTime: 0, jumpTime: 0, diveTime: 0, y: 0, vy: 0, role: 'back' },
  { side: 1, x: 3.1, z: 4.4, vx: 0, vz: 0, targetX: 3.1, targetZ: 4.4, swingTime: 0, jumpTime: 0, diveTime: 0, y: 0, vy: 0, role: 'front' }
];
const opponents = [
  { side: -1, x: -3.1, z: -4.8, vx: 0, vz: 0, targetX: -3.1, targetZ: -4.8, swingTime: 0, jumpTime: 0, diveTime: 0, y: 0, vy: 0, role: 'back' },
  { side: -1, x: 3.1, z: -4.4, vx: 0, vz: 0, targetX: 3.1, targetZ: -4.4, swingTime: 0, jumpTime: 0, diveTime: 0, y: 0, vy: 0, role: 'front' },
  { side: -1, x: 0, z: -7.3, vx: 0, vz: 0, targetX: 0, targetZ: -7.3, swingTime: 0, jumpTime: 0, diveTime: 0, y: 0, vy: 0, role: 'server' }
];
const players = [player, ...teammates, ...opponents];
const playerMeshes = new Map();
function makeNoiseTexture(base, seed = 12) {
  // Procedural court detail keeps the game independent of remote texture hosts.
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas texture generation is not supported by this browser.');
  let state = seed >>> 0;
  const rand = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 5200; i++) {
    const r = 0.3 + rand() * 1.5;
    const alpha = .045 + rand() * .14;
    ctx.fillStyle = rand() > .49 ? `rgba(255,239,201,${alpha})` : `rgba(83,61,38,${alpha})`;
    ctx.beginPath();
    ctx.arc(rand() * size, rand() * size, r, 0, TAU);
    ctx.fill();
  }
  for (let i = 0; i < 56; i++) {
    ctx.strokeStyle = `rgba(255,255,255,${.015 + rand() * .035})`;
    ctx.lineWidth = .4 + rand() * .9;
    ctx.beginPath();
    const x = rand() * size;
    const y = rand() * size;
    ctx.moveTo(x, y);
    ctx.lineTo(x + rand() * 10, y + rand() * 5);
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeBallTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas texture generation is not supported by this browser.');
  const gradient = ctx.createLinearGradient(0, 0, 0, 512);
  gradient.addColorStop(0, '#fff8dc');
  gradient.addColorStop(.48, '#efdfb9');
  gradient.addColorStop(1, '#cfb986');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 1024, 512);
  ctx.fillStyle = '#e34b38';
  ctx.strokeStyle = '#e34b38';
  ctx.lineWidth = 5;
  for (const offset of [-.08, .42, .92]) {
    ctx.beginPath();
    ctx.ellipse(offset * 1024, 256, 200, 265, .25, 0, TAU);
    ctx.stroke();
  }
  for (const offset of [.17, .67]) {
    ctx.beginPath();
    ctx.moveTo(offset * 1024, -15);
    ctx.bezierCurveTo((offset - .15) * 1024, 120, (offset + .19) * 1024, 390, (offset + .04) * 1024, 527);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(255,255,255,.52)';
  ctx.beginPath();
  ctx.ellipse(340, 140, 180, 95, -.25, 0, TAU);
  ctx.fill();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function addMesh(parent, geometry, material, position, options = {}) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(position[0], position[1], position[2]);
  if (options.rotation) mesh.rotation.set(...options.rotation);
  if (options.scale) mesh.scale.set(...options.scale);
  mesh.castShadow = options.castShadow ?? true;
  mesh.receiveShadow = options.receiveShadow ?? false;
  parent.add(mesh);
  return mesh;
}

function makeMaterial(colorValue, roughness = .8, extra = {}) {
  return new THREE.MeshStandardMaterial({ color: colorValue, roughness, ...extra });
}

function makeHumanoid(teamColor, variant = 0) {
  const root = new THREE.Group();
  const uniformMat = makeMaterial(teamColor, .68);
  const shortsMat = makeMaterial(variant % 2 ? 0x172b38 : 0x192630, .84);
  const skinMat = new THREE.MeshStandardMaterial({ color: variant % 2 ? 0xb77b5c : 0xe2ad83, roughness: .82 });
  const shoesMat = makeMaterial(0xf1eee4, .58);
  const jointMat = new THREE.MeshStandardMaterial({ color: 0xc98e6d, roughness: .84 });
  const torso = addMesh(root, new THREE.CapsuleGeometry(.245, .45, 5, 9), uniformMat, [0, 1.19, 0], { scale: [.93, 1, .63] });
  torso.rotation.x = .035;
  const neck = addMesh(root, new THREE.CylinderGeometry(.075, .09, .11, 8), skinMat, [0, 1.55, 0]);
  const head = addMesh(root, new THREE.SphereGeometry(.142, 12, 10), skinMat, [0, 1.72, .014], { scale: [.88, 1.12, .98] });
  const hair = addMesh(root, new THREE.SphereGeometry(.144, 12, 7, 0, TAU, 0, Math.PI * .54), makeMaterial(variant % 3 ? 0x392b24 : 0x231e1b), [0, 1.76, -.005]);
  hair.scale.set(.9, .92, .99);
  addMesh(root, new THREE.BoxGeometry(.31, .12, .035), shoesMat, [0, 1.35, .154], { castShadow: false });
  const arms = [];
  for (const side of [-1, 1]) {
    const upperArm = addMesh(root, new THREE.CapsuleGeometry(.073, .24, 4, 7), uniformMat, [side * .30, 1.25, 0], { scale: [1, .92, 1] });
    const forearm = addMesh(root, new THREE.CapsuleGeometry(.056, .22, 4, 7), skinMat, [side * .31, .97, .035]);
    const hand = addMesh(root, new THREE.SphereGeometry(.071, 8, 7), skinMat, [side * .31, .83, .045], { scale: [.9, .65, .75] });
    arms.push({ upperArm, forearm, hand, side });
  }
  const legs = [];
  for (const side of [-1, 1]) {
    const upper = addMesh(root, new THREE.CapsuleGeometry(.105, .29, 4, 7), shortsMat, [side * .115, .72, 0]);
    const lower = addMesh(root, new THREE.CapsuleGeometry(.075, .3, 4, 7), skinMat, [side * .115, .37, 0]);
    const shoe = addMesh(root, new THREE.BoxGeometry(.16, .105, .29), shoesMat, [side * .115, .085, .045], { castShadow: false });
    legs.push({ upper, lower, shoe, side });
  }
  root.userData = { arms, legs, head, torso, homeColor: teamColor };
  return root;
}

function addCrowd() {
  const bodyGeometry = new THREE.BoxGeometry(.115, .20, .09);
  const headGeometry = new THREE.SphereGeometry(.054, 5, 4);
  const shirtColors = [0xe8e0d1, 0x476475, 0xb84d3e, 0xd0a76e, 0x657963, 0x26384d, 0xd28a69, 0xe9efed];
  const bodies = shirtColors.map((c) => {
    const material = new THREE.MeshStandardMaterial({ color: c, roughness: .9 });
    const mesh = new THREE.InstancedMesh(bodyGeometry, material, 1100);
    mesh.castShadow = false; mesh.receiveShadow = false;
    scene.add(mesh); return mesh;
  });
  const heads = new THREE.InstancedMesh(headGeometry, new THREE.MeshStandardMaterial({ color: 0xc79471, roughness: .95 }), 1100);
  heads.castShadow = false; heads.receiveShadow = false; scene.add(heads);
  const dummy = new THREE.Object3D();
  let index = 0;
  for (const side of [-1, 1]) {
    for (let row = 0; row < 7; row++) {
      for (let i = 0; i < 78; i++) {
        const x = -10.6 + i * .273 + (row % 2) * .12;
        const z = side * (11.8 + row * .49);
        const y = 2.05 + row * .36 + (Math.sin(i * 5.7 + row * 3.1) + 1) * .035;
        const variant = Math.floor(Math.abs(Math.sin(i * 12.11 + row * 17.7 + side) * 10000)) % shirtColors.length;
        dummy.position.set(x, y, z);
        dummy.rotation.set(0, (Math.sin(i * .75 + row) + 1) * .1 * side, 0);
        dummy.scale.set(1, .84 + (i % 3) * .1, 1);
        dummy.updateMatrix();
        bodies[variant].setMatrixAt(index, dummy.matrix);
        dummy.position.set(x, y + .17, z);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        heads.setMatrixAt(index, dummy.matrix);
        index++;
      }
    }
  }
  for (const mesh of bodies) mesh.instanceMatrix.needsUpdate = true;
  heads.instanceMatrix.needsUpdate = true;
}

function addStadium() {
  const structure = makeMaterial(0x48515a, .92);
  const tierMat = makeMaterial(0x727d84, .88);
  const black = makeMaterial(0x141b20, .9);
  const railMat = makeMaterial(0xe4d8c5, .52, { metalness: .22 });

  addMesh(scene, new THREE.PlaneGeometry(200, 200), makeMaterial(0x776b5b, 1), [0, -.38, 0], { rotation: [-Math.PI / 2, 0, 0], castShadow: false });
  const floor = addMesh(scene, new THREE.BoxGeometry(28, .36, 24), structure, [0, -.2, 0], { castShadow: false });
  floor.receiveShadow = true;
  for (const side of [-1, 1]) {
    for (let row = 0; row < 7; row++) {
      const z = side * (11.9 + row * .5);
      addMesh(scene, new THREE.BoxGeometry(22, .25, .46), tierMat, [0, 1.77 + row * .36, z], { castShadow: false, receiveShadow: false });
    }
    const fascia = addMesh(scene, new THREE.BoxGeometry(22.7, .72, .2), black, [0, 1.73, side * 11.45], { castShadow: false });
    fascia.material = makeMaterial(side < 0 ? 0x18323b : 0x292c30, .68, { emissive: side < 0 ? 0x081d22 : 0x17130f, emissiveIntensity: .35 });
    for (let i = -10; i <= 10; i += 2) {
      const ad = addMesh(scene, new THREE.BoxGeometry(1.76, .46, .025), makeMaterial(i % 4 === 0 ? 0xf17b51 : 0xede6d7, .76), [i, 1.74, side * 11.334], { castShadow: false });
    }
  }
  for (const x of [-11.2, 11.2]) {
    for (const z of [-11.5, 11.5]) {
      const column = addMesh(scene, new THREE.CylinderGeometry(.28, .39, 8, 8), structure, [x, 4.05, z], { castShadow: false });
      column.material = makeMaterial(0x424a51, .85);
    }
  }
  for (const z of [-12.1, 12.1]) {
    const beam = addMesh(scene, new THREE.BoxGeometry(26, .28, .32), structure, [0, 8.25, z], { castShadow: false });
    beam.material = makeMaterial(0x333d46, .72, { metalness: .26 });
  }
  for (const x of [-9.2, 9.2]) {
    const beam = addMesh(scene, new THREE.BoxGeometry(.24, .26, 22.4), structure, [x, 8.2, 0], { castShadow: false });
    beam.material = makeMaterial(0x333d46, .72, { metalness: .26 });
  }
  for (const side of [-1, 1]) {
    for (const x of [-8.4, -5.6, -2.8, 0, 2.8, 5.6, 8.4]) {
      const lamp = addMesh(scene, new THREE.BoxGeometry(.65, .21, .28), makeMaterial(0xfff0d7, .32, { emissive: 0xffd69a, emissiveIntensity: 2.3 }), [x, 7.98, side * 11.9], { castShadow: false });
      lamp.material.toneMapped = false;
    }
  }
  const clockBoard = addMesh(scene, new THREE.BoxGeometry(3.3, 1.65, .22), black, [-7.3, 6.5, -12], { castShadow: false });
  clockBoard.material = makeMaterial(0x121d20, .46, { emissive: 0x14241d, emissiveIntensity: .34 });
  const scoreMat = new THREE.MeshBasicMaterial({ color: 0xb9eeaf });
  for (let i = 0; i < 8; i++) addMesh(scene, new THREE.BoxGeometry(.11, .26, .02), scoreMat, [-8.3 + i * .26, 6.54, -11.87], { castShadow: false });
  const balcony = makeMaterial(0xc5c2b9, .48, { metalness: .52 });
  const rail = addMesh(scene, new THREE.CylinderGeometry(.035, .035, 20.5, 8), railMat, [0, 4.32, -14.6]);
  rail.rotation.z = Math.PI / 2;
  const rail2 = rail.clone();
  rail2.position.z = 14.6;
  scene.add(rail2);
  addCrowd();

  const ambient = new THREE.HemisphereLight(0xe7efff, 0x594a35, 2.05);
  scene.add(ambient);
  const keyLight = new THREE.DirectionalLight(0xffe6c6, 3.0);
  keyLight.position.set(-5.5, 15, 7.5); keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(2048, 2048);
  keyLight.shadow.camera.left = -15; keyLight.shadow.camera.right = 15;
  keyLight.shadow.camera.top = 19; keyLight.shadow.camera.bottom = -19;
  keyLight.shadow.bias = -.00025; keyLight.shadow.normalBias = .025;
  scene.add(keyLight);
  const rim = new THREE.DirectionalLight(0xb2d9ed, 1.3);
  rim.position.set(6, 9, -9); scene.add(rim);
  for (const [x, z, intensity] of [[-8, -9, 370], [8, -9, 370], [-8, 9, 300], [8, 9, 300]]) {
    const point = new THREE.PointLight(0xffdfb0, intensity, 18, 1.8);
    point.position.set(x, 7.5, z);
    scene.add(point);
  }
}

function addCourt() {
  const sandTexture = makeNoiseTexture('#cfaa74', 41);
  sandTexture.repeat.set(13, 16);
  const sandMaterial = new THREE.MeshStandardMaterial({ map: sandTexture, color: 0xf0d4a0, roughness: .96 });
  const court = addMesh(scene, new THREE.PlaneGeometry(COURT.width, 18), sandMaterial, [0, 0, 0], { rotation: [-Math.PI / 2, 0, 0], castShadow: false, receiveShadow: true });

  const borderMat = makeMaterial(0xcfaa76, .98);
  for (const x of [-COURT.halfWidth, COURT.halfWidth]) {
    addMesh(scene, new THREE.BoxGeometry(.055, .018, 18), borderMat, [x, .012, 0], { castShadow: false });
  }
  for (const z of [-COURT.halfLength, COURT.halfLength]) {
    addMesh(scene, new THREE.BoxGeometry(COURT.width, .018, .055), borderMat, [0, .012, z], { castShadow: false });
  }
  const centerLine = addMesh(scene, new THREE.BoxGeometry(COURT.width, .02, .09), makeMaterial(0xf7eedc, .9), [0, .018, 0], { castShadow: false });
  centerLine.material = makeMaterial(0x382f28, .85);
  for (const x of [-COURT.halfWidth, COURT.halfWidth]) {
    for (const z of [-COURT.halfLength, COURT.halfLength]) {
      const peg = addMesh(scene, new THREE.CylinderGeometry(.07, .07, .04, 12), makeMaterial(0xeee7d9, .7), [x, .04, z], { castShadow: false });
    }
  }
  addNet();
  return court;
}

function addNet() {
  const postMat = new THREE.MeshStandardMaterial({ color: 0xe7e1d4, roughness: .48, metalness: .2 });
  const ropeMat = new THREE.MeshStandardMaterial({ color: 0xf2eee4, roughness: .88 });
  for (const x of [-4.85, 4.85]) {
    const post = addMesh(scene, new THREE.CylinderGeometry(.062, .08, 3.16, 10), postMat, [x, 1.56, 0]);
    post.castShadow = true;
    addMesh(scene, new THREE.CylinderGeometry(.14, .14, .05, 12), makeMaterial(0x9a8d7b, .7), [x, .04, 0], { castShadow: false });
  }
  const top = addMesh(scene, new THREE.BoxGeometry(9.7, .085, .12), makeMaterial(0xf3eee3, .65), [0, COURT.netHeight, 0], { castShadow: true });
  addMesh(scene, new THREE.BoxGeometry(9.7, .07, .12), makeMaterial(0xf3eee3, .72), [0, .94, 0], { castShadow: false });
  const meshMat = new THREE.MeshStandardMaterial({ color: 0xe8e5dd, roughness: .95, transparent: true, opacity: .1, depthWrite: false, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(9.7, COURT.netHeight - 1), meshMat);
  mesh.position.set(0, (COURT.netHeight + .94) / 2, 0);
  scene.add(mesh);
  const cells = new THREE.Group();
  const lineMat = new THREE.LineBasicMaterial({ color: 0xbab8ae, transparent: true, opacity: .6 });
  for (let x = -4.8; x <= 4.8001; x += .18) {
    const points = [new THREE.Vector3(x, .98, -.015), new THREE.Vector3(x, 2.39, -.015)];
    cells.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), lineMat));
  }
  for (let y = .98; y <= 2.3901; y += .18) {
    const points = [new THREE.Vector3(-4.84, y, -.015), new THREE.Vector3(4.84, y, -.015)];
    cells.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), lineMat));
  }
  scene.add(cells);
  const antennaMat = makeMaterial(0xffffff, .42);
  for (const x of [-4.72, 4.72]) {
    addMesh(scene, new THREE.CylinderGeometry(.025, .025, 1.05, 6), antennaMat, [x, 2.87, .04]);
    for (let i = 0; i < 5; i++) {
      addMesh(scene, new THREE.CylinderGeometry(.027, .027, .105, 6), makeMaterial(i % 2 ? 0xffffff : 0xe55c4b), [x, 2.49 + i * .19, .04], { castShadow: false });
    }
  }
}

function createScene() {
  // Build the lit arena and reusable player, ball, and court meshes once at startup.
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x82919a);
  scene.fog = new THREE.Fog(0x667882, 42, 95);
  camera = new THREE.PerspectiveCamera(43, window.innerWidth / window.innerHeight, .1, 140);
  camera.position.set(0, 10.1, 22);
  camera.lookAt(0, 1.3, 0);
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.7));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.16;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.setAttribute('aria-label', '3D volleyball game arena');
  canvasRoot.insertBefore(renderer.domElement, canvasRoot.firstChild);
  addStadium();
  addCourt();
  for (const [index, athlete] of players.entries()) {
    const mesh = makeHumanoid(athlete.side === 1 ? COLORS.home : COLORS.away, index);
    mesh.position.set(athlete.x, 0, athlete.z);
    scene.add(mesh);
    playerMeshes.set(athlete, mesh);
  }
  const ballTexture = makeBallTexture();
  ball = new THREE.Mesh(
    new THREE.SphereGeometry(.22, 36, 28),
    new THREE.MeshStandardMaterial({ map: ballTexture, color: 0xffffff, roughness: .47, metalness: 0 })
  );
  ball.castShadow = true;
  scene.add(ball);
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(.33, 24), new THREE.MeshBasicMaterial({ color: 0x29241e, transparent: true, opacity: .22, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = .024;
  shadow.material.toneMapped = false;
  scene.add(shadow);
  ballShadow = shadow;
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xffd5a5, transparent: true, opacity: .19, depthWrite: false }));
  glow.scale.set(.85, .85, .85);
  ball.add(glow);

  trailPoints = 14;
  trailPositions = new Float32Array(trailPoints * 3);
  renderedTrailPositions = new Float32Array(trailPoints * 3);
  const trailGeo = new THREE.BufferGeometry();
  trailGeo.setAttribute('position', new THREE.BufferAttribute(renderedTrailPositions, 3));
  trailGeo.setDrawRange(0, 0);
  trail = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ color: 0xffe0b0, transparent: true, opacity: .32, depthWrite: false }));
  scene.add(trail);

  const grain = new THREE.Group();
  const dustMat = new THREE.MeshBasicMaterial({ color: 0xe8c99c, transparent: true, opacity: .48 });
  const dustGeo = new THREE.SphereGeometry(.028, 5, 4);
  for (let i = 0; i < 60; i++) {
    const particle = new THREE.Mesh(dustGeo, dustMat);
    particle.position.set((Math.sin(i * 44.1) * 4.6), -.3, Math.sin(i * 13.7) * 8.7);
    particle.visible = false;
    grain.add(particle);
  }
  scene.add(grain);
  window.addEventListener('resize', onResize);
}

function onResize() {
  if (!renderer || !camera) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.7));
}

function beginMatch() {
  unlockAudio();
  homeScore = awayScore = rallyCount = 0;
  currentServer = 1;
  $('home-score').textContent = '00';
  $('away-score').textContent = '00';
  $('set-number').textContent = '01';
  $('match-status').textContent = 'LIVE';
  startScreen.classList.add('hidden');
  hud.classList.remove('hidden');
  startPoint();
}

function startPoint() {
  phase = 'serve';
  pendingPoint = null;
  $('match-status').textContent = 'LIVE';
  $('point-callout').classList.remove('show');
  calloutTimer = 0;
  pointScreen.classList.add('hidden');
  $('rally-label').textContent = currentServer === 1 ? 'YOUR SERVE' : 'OPPONENT SERVES';
  $('touch-count').textContent = '0 / 3';
  rallyCount = 0;
  sideTouches = 0;
  rallyStartedAt = time;
  displayedClockSecond = -1;
  lastTouchSide = 0;
  serveWait = 0;
  player.x = 0;
  player.z = currentServer === 1 ? 7.8 : 5.2;
  player.vx = player.vz = player.vy = 0;
  player.y = 0;
  for (const athlete of [...teammates, ...opponents]) {
    athlete.vx = athlete.vz = athlete.vy = 0;
    athlete.y = 0;
    athlete.swingTime = athlete.jumpTime = athlete.diveTime = 0;
  }
  if (currentServer === 1) {
    ball.position.set(player.x + .28, 1.48, player.z - .32);
  } else {
    const server = opponents[2];
    ball.position.set(server.x, 1.6, server.z - .3);
    serveWait = .9;
  }
  ballVelocity.set(0, 0, 0);
  trail.geometry.setDrawRange(0, 0);
  updateHud();
  updateRallyClock();
}

function scorePoint(winner, reason) {
  if (phase === 'point' || phase === 'matchOver') return;
  pendingPoint = null;
  phase = 'point';
  if (winner === 1) homeScore++;
  else awayScore++;
  currentServer = winner;
  updateHud();
  const wonSet = Math.max(homeScore, awayScore) >= 15 && Math.abs(homeScore - awayScore) >= 2;
  const score = winner === 1 ? homeScore : awayScore;
  $('point-message').textContent = winner === 1 ? 'HARBOR SCORES' : 'SOLAR SCORES';
  $('point-detail').textContent = reason || 'A moment to reset.';
  $('match-status').textContent = wonSet ? 'SET POINT' : 'POINT';
  $('set-number').textContent = '01';
  $('continue-button').innerHTML = wonSet ? 'PLAY AGAIN <span>↻</span>' : 'NEXT SERVE <span>→</span>';
  pointScreen.classList.remove('hidden');
  beep(winner === 1 ? 660 : 440, .13);
  updateRallyClock();
  if (score >= 15 && Math.abs(homeScore - awayScore) >= 2) {
    $('point-kicker').textContent = 'MATCH POINT';
    $('point-message').textContent = winner === 1 ? 'HARBOR WIN' : 'SOLAR WIN';
    $('continue-button').innerHTML = 'PLAY AGAIN <span>↻</span>';
  } else {
    $('point-kicker').textContent = 'POINT';
  }
}

function updateHud() {
  $('home-score').textContent = String(homeScore).padStart(2, '0');
  $('away-score').textContent = String(awayScore).padStart(2, '0');
  $('touch-count').textContent = `${lastTouchSide === 1 ? sideTouches : 0} / 3`;
  $('rally-label').textContent = phase === 'serve'
    ? (currentServer === 1 ? 'YOUR SERVE' : 'OPPONENT SERVES')
    : `${rallyCount} ${rallyCount === 1 ? 'TOUCH' : 'TOUCHES'}`;
}

function updateRallyClock() {
  const seconds = phase === 'rally' ? Math.floor(time - rallyStartedAt) : 0;
  if (seconds === displayedClockSecond) return;
  displayedClockSecond = seconds;
  const minutes = Math.floor(seconds / 60);
  $('rally-time').textContent = `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function beginRally() {
  if (phase !== 'serve') return;
  phase = 'rally';
  rallyStartedAt = time;
  displayedClockSecond = -1;
  rallyCount++;
  sideTouches = 1;
  lastTouchSide = currentServer;
  $('rally-label').textContent = 'RALLY IN PLAY';
  $('touch-count').textContent = '1 / 3';
  updateHud();
  beep(780, .07);
}

function serveBall(athlete, side) {
  if (phase !== 'serve' || side !== currentServer) return;
  beginRally();
  athlete.swingTime = .3;
  const targetX = (Math.random() - .5) * 4.8;
  const targetZ = -side * (7.2 + Math.random() * 1.1);
  ball.position.set(athlete.x + (side === 1 ? .23 : -.23), Math.max(athlete.y + 1.65, 1.55), athlete.z - side * .35);
  const flight = 1.25;
  ballVelocity.set(
    (targetX - ball.position.x) / flight,
    (.24 - ball.position.y + .5 * 9.81 * flight * flight) / flight,
    (targetZ - ball.position.z) / flight
  );
  ballVelocity.x += athlete.vx * .16;
  lastHitTime = time;
  beep(340, .11, .06);
}

function tryHit(athlete, kind = 'hit') {
  // Successful contacts reset the rally arc and enforce the three-touch limit.
  if (phase !== 'rally' || pendingPoint || time - lastHitTime < .29) return false;
  const hitPoint = new THREE.Vector3(athlete.x, athlete.y + (kind === 'set' ? 1.85 : 2.45), athlete.z);
  const reach = kind === 'dive' ? 1.55 : kind === 'set' ? 1.38 : 1.68;
  if (ball.position.distanceTo(hitPoint) > reach || ball.position.y < .45) return false;
  const onSameSide = Math.sign(ball.position.z || athlete.side) === athlete.side;
  if (!onSameSide && Math.abs(ball.position.z) > .48) return false;
  if (lastTouchSide === athlete.side && sideTouches >= 3) {
    scorePoint(-athlete.side, 'Too many touches.');
    return true;
  }
  if (lastTouchSide !== athlete.side) sideTouches = 0;
  sideTouches++;
  lastTouchSide = athlete.side;
  rallyCount++;
  lastHitTime = time;
  athlete.swingTime = .36;
  if (kind === 'dive') athlete.diveTime = .52;
  else if (ball.position.y > 1.9 && kind !== 'set') athlete.jumpTime = Math.max(athlete.jumpTime, .43);

  const opponentsSide = athlete.side === 1 ? opponents : teammates;
  const target = kind === 'set'
    ? new THREE.Vector3(
      THREE.MathUtils.clamp(athlete.x - athlete.side * 1.2 + (Math.random() - .5) * .7, -3.8, 3.8),
      3.25 + Math.random() * .25,
      athlete.side * (2.1 + Math.random() * .6)
    )
    : (() => {
      const targetX = athlete.side === 1 ? (Math.random() - .5) * 7.8 : (Math.random() - .5) * 7.8;
      const targetZ = -athlete.side * (7.5 + Math.random() * 2.3);
      const desiredTime = kind === 'spike' ? .84 : 1.0;
      return new THREE.Vector3(targetX, .25, targetZ + .5 * 9.81 * desiredTime * desiredTime);
    })();

  const flight = kind === 'set' ? .8 : kind === 'spike' ? .78 : 1.0 + Math.min(.25, ball.position.y * .035);
  ballVelocity.set(
    (target.x - ball.position.x) / flight,
    (target.y - ball.position.y + .5 * 9.81 * flight * flight) / flight,
    (target.z - ball.position.z) / flight
  );
  ballVelocity.y = Math.max(kind === 'spike' ? -2.1 : 2.6, Math.min(kind === 'spike' ? 2.8 : 7.4, ballVelocity.y));
  if (kind !== 'set') {
    ballVelocity.x += athlete.vx * .12;
    ballVelocity.z += athlete.vz * .12;
  }
  if (kind === 'spike') {
    ballVelocity.z = -athlete.side * 12.0;
    ballVelocity.y = Math.min(ballVelocity.y, 3.5);
  }
  if (Math.abs(ball.position.z) < 1 && ball.position.y > 1.9) {
    const blockers = opponentsSide.filter((p) => Math.abs(p.x - ball.position.x) < 1.15 && p.role === 'front');
    if (blockers.length && kind !== 'set') {
      ballVelocity.z = -athlete.side * 3.1;
      ballVelocity.y = Math.max(ballVelocity.y, 4.8);
      ballVelocity.x *= .55;
      for (const blocker of blockers) {
        blocker.jumpTime = .56;
        blocker.swingTime = .25;
      }
      showCallout('BLOCKED', .8);
    }
  }
  updateHud();
  soundHit(kind);
  return true;
}

function updatePlayer(dt) {
  const forward = (keys.has('w') || keys.has('arrowup') ? -1 : 0) + (keys.has('s') || keys.has('arrowdown') ? 1 : 0);
  const sideways = (keys.has('a') || keys.has('arrowleft') ? -1 : 0) + (keys.has('d') || keys.has('arrowright') ? 1 : 0);
  let inputX = sideways;
  let inputZ = forward;
  const magnitude = Math.hypot(inputX, inputZ) || 1;
  inputX /= magnitude; inputZ /= magnitude;
  const moving = !!(forward || sideways);
  const sprint = keys.has('shift');
  const maxSpeed = sprint ? 8.2 : 5.35;
  const accel = moving ? 24 : 13;
  player.vx += (inputX * maxSpeed - player.vx) * Math.min(1, accel * dt / maxSpeed);
  player.vz += (inputZ * maxSpeed - player.vz) * Math.min(1, accel * dt / maxSpeed);
  player.x = THREE.MathUtils.clamp(player.x + player.vx * dt, -4.14, 4.14);
  player.z = THREE.MathUtils.clamp(player.z + player.vz * dt, .5, 8.65);
  if (player.y > 0 || player.vy > 0) {
    player.vy -= 17.5 * dt;
    player.y += player.vy * dt;
    if (player.y <= 0) { player.y = 0; player.vy = 0; }
  }
  if (player.diveTime > 0) {
    player.diveTime = Math.max(0, player.diveTime - dt);
    player.vx *= Math.max(0, 1 - dt * 2.2);
    player.vz *= Math.max(0, 1 - dt * 2.2);
  }
}

function updateAI(dt, group) {
  // Teammates cover formation zones; the closest defender anticipates the landing spot.
  for (const athlete of group) {
    const ballOnTheirSide = ball.position.z * athlete.side > -.4 || ballVelocity.z * athlete.side > 0;
    if (phase === 'serve' && athlete.side === currentServer && athlete.role === 'server') {
      athlete.targetX = 0; athlete.targetZ = athlete.side * 7.5;
    } else if (phase === 'serve') {
      athlete.targetX = athlete.role === 'front' ? athlete.side * 2.7 : athlete.role === 'back' ? -athlete.side * 2.7 : 0;
      athlete.targetZ = athlete.side * (athlete.role === 'front' ? 2.2 : 6.7);
    } else if (phase === 'rally') {
      const landingTime = THREE.MathUtils.clamp((ballVelocity.y + Math.sqrt(Math.max(0, ballVelocity.y ** 2 + 19.62 * Math.max(ball.position.y - .2, 0)))) / 9.81, .12, 1.5);
      const landingX = THREE.MathUtils.clamp(ball.position.x + ballVelocity.x * landingTime, -4.3, 4.3);
      const team = athlete.side === -1 ? opponents : teammates;
      const nearest = team.reduce((best, item) => {
        const dist = Math.abs(item.x - landingX) + Math.abs(item.z - ball.position.z) * .55;
        return dist < best.distance ? { item, distance: dist } : best;
      }, { item: athlete, distance: Infinity }).item;
      if (ballOnTheirSide && nearest === athlete) {
        const lead = Math.min(.32, landingTime * .24);
        athlete.targetX = THREE.MathUtils.clamp(ball.position.x + ballVelocity.x * lead, -4.05, 4.05);
        athlete.targetZ = THREE.MathUtils.clamp(ball.position.z + ballVelocity.z * lead - athlete.side * .45, athlete.side * 8.35, athlete.side * .65);
      } else {
        const baseX = athlete.role === 'front' ? athlete.side * 2.6 : -athlete.side * 2.6;
        athlete.targetX = THREE.MathUtils.clamp(baseX + ball.position.x * .15, -3.85, 3.85);
        athlete.targetZ = athlete.side * (athlete.role === 'front' ? 2.1 : 5.7);
      }
      if (athlete.role === 'front' && Math.abs(ball.position.z) < 3.8 && ball.position.y > 1.8 && ballVelocity.z * athlete.side < .5) {
        athlete.targetX = THREE.MathUtils.clamp(ball.position.x, -3.6, 3.6);
        athlete.targetZ = athlete.side * 1.35;
      }
    }
    const dx = athlete.targetX - athlete.x;
    const dz = athlete.targetZ - athlete.z;
    const dist = Math.hypot(dx, dz) || 1;
    const maxSpeed = athlete.role === 'server' ? 4.5 : 6.4;
    const desiredVx = (dx / dist) * Math.min(maxSpeed, dist * 3.1);
    const desiredVz = (dz / dist) * Math.min(maxSpeed, dist * 3.1);
    const blend = Math.min(1, dt * 4.8);
    athlete.vx += (desiredVx - athlete.vx) * blend;
    athlete.vz += (desiredVz - athlete.vz) * blend;
    athlete.x = THREE.MathUtils.clamp(athlete.x + athlete.vx * dt, -4.15, 4.15);
    athlete.z = athlete.side === 1
      ? THREE.MathUtils.clamp(athlete.z + athlete.vz * dt, .5, 8.75)
      : THREE.MathUtils.clamp(athlete.z + athlete.vz * dt, -8.75, -.5);
    if (athlete.y > 0 || athlete.vy > 0) {
      athlete.vy -= 17.5 * dt;
      athlete.y += athlete.vy * dt;
      if (athlete.y <= 0) { athlete.y = 0; athlete.vy = 0; }
    }
  }
}

function aiTouches(dt) {
  if (phase === 'serve' && currentServer === -1) {
    serveWait -= dt;
    if (serveWait <= 0) serveBall(opponents[2], -1);
    return;
  }
  if (phase !== 'rally' || pendingPoint || time - lastHitTime < .42) return;
  const group = ball.position.z < 0 ? opponents : teammates;
  const nearest = group.reduce((best, athlete) => {
    const d = ball.position.distanceTo(new THREE.Vector3(athlete.x, athlete.y + 1.25, athlete.z));
    return d < best.distance ? { athlete, distance: d } : best;
  }, { athlete: group[0], distance: Infinity });
  if (nearest.distance > 1.65 || ball.position.y < .42) return;
  if (nearest.athlete.side === 1) return;
  const isSet = sideTouches === 1 && Math.random() < .80;
  const hitKind = isSet ? 'set' : (ball.position.y > 2.6 ? 'spike' : 'hit');
  tryHit(nearest.athlete, hitKind);
}

function updateBall(dt) {
  // Integrate gravity, air drag, spin, net/player contact, and the scoring bounce.
  if (pendingPoint) {
    const elapsed = Math.min(time - pendingPoint.started, pendingPoint.duration);
    ball.position.y = .23 + ballVelocity.y * elapsed - .5 * 9.81 * elapsed * elapsed;
    if (time - pendingPoint.started >= pendingPoint.duration) scorePoint(pendingPoint.winner, pendingPoint.reason);
    return;
  }
  if (phase === 'serve' && currentServer === 1) {
    ball.position.set(player.x + .24, player.y + 1.48 + Math.sin(time * 2.8) * .025, player.z - .32);
    return;
  }
  if (phase === 'serve' && currentServer === -1) {
    const server = opponents[2];
    ball.position.set(server.x, 1.6 + Math.sin(time * 2.4) * .02, server.z - .3);
    return;
  }
  if (phase !== 'rally') return;

  ballVelocity.y -= 9.81 * dt;
  ballVelocity.multiplyScalar(1 - .014 * dt);
  const sideSpin = ball.rotation.y * ballVelocity.z * .009;
  ballVelocity.x += sideSpin * dt;
  ball.position.addScaledVector(ballVelocity, dt);
  ball.rotation.x += ballVelocity.z * dt * 1.8;
  ball.rotation.z -= ballVelocity.x * dt * 1.8;

  if (ball.position.z > -COURT.halfLength && ball.position.z < COURT.halfLength && Math.abs(ball.position.x) < COURT.halfWidth && ball.position.y < .23 && ballVelocity.y < 0) {
    ball.position.y = .23;
    ballVelocity.y = Math.max(.8, Math.abs(ballVelocity.y) * .3);
    ballVelocity.x *= .48;
    ballVelocity.z *= .48;
    pendingPoint = {
      winner: lastTouchSide === 1 ? -1 : 1,
      reason: lastTouchSide === 1 ? 'Down on Harbor’s side.' : 'Down on Solar’s side.',
      started: time,
      duration: (ballVelocity.y * 2) / 9.81
    };
    soundHit('ground');
    return;
  }

  if (ball.position.y < .22 && Math.abs(ball.position.x) > COURT.halfWidth && Math.abs(ball.position.z) < 10) {
    scorePoint(-lastTouchSide || 1, 'Out of bounds.');
    return;
  }
  if (Math.abs(ball.position.z) > 12.5 || Math.abs(ball.position.x) > 11 || ball.position.y > 15) {
    scorePoint(-lastTouchSide || 1, 'Out of bounds.');
    return;
  }

  const netRadius = .19;
  if (Math.abs(ball.position.z) < netRadius && ball.position.y - .22 < COURT.netHeight && ball.position.y + .22 > .91 && Math.abs(ball.position.x) < 4.9) {
    const wasForward = Math.abs(ballVelocity.z) > .05;
    const pushDirection = Math.sign(ballVelocity.z) || lastTouchSide;
    ball.position.z = pushDirection * (netRadius + .002);
    ballVelocity.z *= -.42;
    ballVelocity.x *= .83;
    ballVelocity.y *= .77;
    if (wasForward && ballVelocity.y < 1.4) ballVelocity.y = 1.4;
    soundHit('net');
  }

  for (const athlete of players) {
    const dx = ball.position.x - athlete.x;
    const dz = ball.position.z - athlete.z;
    const dy = ball.position.y - (athlete.y + 1.07);
    const distance = Math.sqrt(dx * dx + dz * dz + dy * dy);
    if (distance < .37 && time - lastHitTime > .4 && phase === 'rally') {
      ballVelocity.x += dx * 3.1;
      ballVelocity.z += dz * 3.1;
      ballVelocity.y = Math.max(ballVelocity.y, 4.0);
      athlete.swingTime = .22;
    }
  }

  if (lastTouchSide && phase === 'rally') {
    const otherSide = -lastTouchSide;
    const hasCrossed = ball.position.z * otherSide > .35;
    const farSide = hasCrossed && ball.position.z * otherSide > 1.2;
    if (farSide && ball.position.y < COURT.netHeight + .18) {
      const attacker = players.filter((athlete) => athlete.side === lastTouchSide).find((athlete) =>
        ball.position.distanceTo(new THREE.Vector3(athlete.x, athlete.y + 1.48, athlete.z)) < 1.55
      );
      if (attacker && ball.position.y > 1.1) tryHit(attacker, 'hit');
    }
  }
}

function updateTrail() {
  if (!trail) return;
  if (phase === 'rally') {
    const point = trailIndex % trailPoints;
    trailPositions[point * 3] = ball.position.x;
    trailPositions[point * 3 + 1] = ball.position.y;
    trailPositions[point * 3 + 2] = ball.position.z;
    trailIndex++;
    const points = Math.min(trailIndex, trailPoints);
    const position = trail.geometry.attributes.position;
    for (let i = 0; i < points; i++) {
      const idx = (trailIndex - points + i + trailPoints) % trailPoints;
      position.array.set(trailPositions.subarray(idx * 3, idx * 3 + 3), i * 3);
    }
    position.needsUpdate = true;
    trail.geometry.setDrawRange(0, points);
  } else {
    trailIndex = 0;
    trail.geometry.setDrawRange(0, 0);
  }
}

function animatePlayers(dt) {
  for (const athlete of players) {
    const mesh = playerMeshes.get(athlete);
    if (!mesh) continue;
    const speed = Math.hypot(athlete.vx, athlete.vz);
    const running = Math.min(1, speed / 5.5);
    const animationTime = time * (7.2 + running * 6.5);
    mesh.position.set(athlete.x, athlete.y + (running > .06 && athlete.y === 0 ? Math.abs(Math.sin(animationTime)) * .035 * running : 0), athlete.z);
    mesh.rotation.y = Math.atan2(athlete.side === 1 ? ball.position.x - athlete.x : athlete.x - ball.position.x, Math.abs(ball.position.z - athlete.z) + 1);
    const isDiving = athlete.diveTime > 0;
    mesh.rotation.z = THREE.MathUtils.clamp(-athlete.vx * .04, -.24, .24) + (isDiving ? athlete.side * .78 : 0);
    const swing = athlete.swingTime > 0 ? Math.sin((athlete.swingTime / .38) * Math.PI) : 0;
    athlete.swingTime = Math.max(0, athlete.swingTime - dt);
    const jump = athlete.y > 0 ? athlete.y * .48 : 0;
    const { arms, legs } = mesh.userData;
    for (const arm of arms) {
      const isLead = arm.side === (athlete.side === 1 ? 1 : -1);
      arm.upperArm.rotation.z = (arm.side * -.14) + (swing ? arm.side * (1.25 + swing * .95) : 0) + (jump ? arm.side * .92 : 0);
      arm.upperArm.rotation.x = -running * .34 * Math.sin(animationTime + arm.side);
      arm.forearm.rotation.z = arm.side * (swing ? .38 : -.08) + (jump ? arm.side * .6 : 0);
      arm.hand.rotation.z = arm.side * (swing * .2);
      if (isLead) arm.upperArm.rotation.x += swing * -.3;
    }
    for (const leg of legs) {
      const phaseOffset = leg.side < 0 ? Math.PI : 0;
      const stride = running * Math.sin(animationTime + phaseOffset) * .58;
      leg.upper.rotation.x = stride - jump * .8;
      leg.lower.rotation.x = Math.max(0, -stride) * .75 - jump * .25;
      leg.shoe.rotation.x = leg.upper.rotation.x * .45;
    }
    mesh.userData.torso.rotation.x = .04 - running * .1 + (isDiving ? .43 : 0) - jump * .1;
  }
}

function updateCamera(dt) {
  const target = phase === 'rally' ? ball.position : new THREE.Vector3(0, 0, 0);
  const desiredX = cameraMode === 1 ? 0 : THREE.MathUtils.clamp(target.x * .22, -1.5, 1.5);
  const desiredY = cameraMode === 1 ? 14 : 10.1 + Math.min(1.3, Math.max(0, target.y - 2) * .1);
  const desiredZ = cameraMode === 1 ? 27 : 21.7 + Math.max(0, target.z) * .05;
  const blend = 1 - Math.exp(-1.6 * dt);
  camera.position.lerp(new THREE.Vector3(desiredX, desiredY, desiredZ), blend);
  const focus = phase === 'rally'
    ? new THREE.Vector3(target.x * .42, Math.max(1.3, target.y * .46), target.z * .37)
    : new THREE.Vector3(0, 1.3, 0);
  cameraFocus.lerp(focus, 1 - Math.exp(-2.2 * dt));
  camera.lookAt(cameraFocus);
  if (ballShadow) {
    ballShadow.position.set(ball.position.x, .027, ball.position.z);
    ballShadow.material.opacity = Math.max(.035, .22 - ball.position.y * .018);
    const scale = 1 + Math.min(ball.position.y * .08, .55);
    ballShadow.scale.set(scale, scale, scale);
  }
}

function showCallout(text, duration = 1.15) {
  const el = $('point-callout');
  el.textContent = text;
  el.classList.add('show');
  calloutTimer = duration;
}

function update(dt) {
  time += dt;
  updateRallyClock();
  if (phase === 'point') {
    updateCamera(dt);
    animatePlayers(dt);
    return;
  }
  updatePlayer(dt);
  updateAI(dt, teammates);
  updateAI(dt, opponents);
  updateBall(dt);
  if (phase !== 'point' && phase !== 'matchOver') aiTouches(dt);
  if (keys.has('space') && phase === 'serve' && currentServer === 1) {
    if (serveWait <= 0) serveBall(player, 1);
  }
  if (calloutTimer > 0) {
    calloutTimer -= dt;
    if (calloutTimer <= 0) $('point-callout').classList.remove('show');
  }
  animatePlayers(dt);
  updateCamera(dt);
  updateTrail();
}

function render() {
  const dt = Math.min(clock.getDelta(), .035);
  update(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(render);
}

function jump() {
  if (player.y === 0) {
    player.vy = 7.3;
    player.jumpTime = .4;
  }
  if (phase === 'serve' && currentServer === 1) {
    serveBall(player, 1);
  } else if (phase === 'rally') {
    if (!tryHit(player, 'spike')) tryHit(player, 'hit');
  }
}

function setOrHit() {
  if (phase === 'serve' && currentServer === 1) serveBall(player, 1);
  else if (phase === 'rally') tryHit(player, 'set');
}

function dive() {
  if (player.diveTime > 0) return;
  player.diveTime = .5;
  const direction = new THREE.Vector3(player.vx, 0, player.vz);
  if (direction.lengthSq() < .03) {
    direction.set(ball.position.x - player.x, 0, ball.position.z - player.z);
  }
  if (direction.lengthSq() > .001) direction.normalize();
  player.vx += direction.x * 7;
  player.vz += direction.z * 7;
  if (!tryHit(player, 'dive') && phase === 'rally') {
    setTimeout(() => {
      if (phase === 'rally') tryHit(player, 'dive');
    }, 140);
  }
}

function onKeyDown(event) {
  // Keep movement keys continuous and treat jump, set, dive, and camera as one-shot actions.
  const key = event.key.toLowerCase();
  if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) event.preventDefault();
  if (key === ' ' && !event.repeat) { keys.add('space'); jump(); return; }
  if (key === 'e' && !event.repeat) { setOrHit(); return; }
  if (key === 'q' && !event.repeat) { dive(); return; }
  if (key === 'c' && !event.repeat) { cameraMode = 1 - cameraMode; return; }
  keys.add(key);
}

function onKeyUp(event) {
  const key = event.key.toLowerCase();
  keys.delete(key);
  if (key === ' ') keys.delete('space');
}

function soundHit(kind) {
  beep(kind === 'spike' ? 165 : kind === 'set' ? 510 : kind === 'net' ? 245 : 290, kind === 'spike' ? .12 : .055, kind === 'spike' ? .09 : .035);
}

function unlockAudio() {
  if (audioContext) {
    if (audioContext.state === 'suspended') audioContext.resume();
    return;
  }
  try {
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) return;
    audioContext = new AudioCtor();
    arenaTone = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const filter = audioContext.createBiquadFilter();
    arenaTone.type = 'triangle';
    arenaTone.frequency.value = 83;
    filter.type = 'lowpass';
    filter.frequency.value = 150;
    gain.gain.value = .008;
    arenaTone.connect(filter);
    filter.connect(gain);
    gain.connect(audioContext.destination);
    arenaTone.start();

    const sampleCount = audioContext.sampleRate * 2;
    const noiseBuffer = audioContext.createBuffer(1, sampleCount, audioContext.sampleRate);
    const noiseData = noiseBuffer.getChannelData(0);
    let crowdTexture = 0;
    for (let i = 0; i < sampleCount; i++) {
      crowdTexture += (Math.random() * 2 - 1 - crowdTexture) * .055;
      noiseData[i] = crowdTexture * 3.5;
    }
    crowdLoop = audioContext.createBufferSource();
    crowdLoop.buffer = noiseBuffer;
    crowdLoop.loop = true;
    const crowdFilter = audioContext.createBiquadFilter();
    crowdFilter.type = 'bandpass';
    crowdFilter.frequency.value = 340;
    crowdFilter.Q.value = .65;
    const crowdGain = audioContext.createGain();
    crowdGain.gain.value = .045;
    crowdLoop.connect(crowdFilter);
    crowdFilter.connect(crowdGain);
    crowdGain.connect(audioContext.destination);
    crowdLoop.start();
  } catch (error) {
    console.warn('Ambient audio is unavailable in this browser.', error);
  }
}

function beep(frequency, duration = .08, volume = .045) {
  if (!audioContext || audioContext.state !== 'running') return;
  try {
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const filter = audioContext.createBiquadFilter();
    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(frequency, audioContext.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(45, frequency * .48), audioContext.currentTime + duration);
    filter.type = 'lowpass'; filter.frequency.value = 1250;
    gain.gain.setValueAtTime(volume, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(.001, audioContext.currentTime + duration);
    oscillator.connect(filter); filter.connect(gain); gain.connect(audioContext.destination);
    oscillator.start(); oscillator.stop(audioContext.currentTime + duration);
  } catch (error) {
    console.warn('A sound effect could not be played.', error);
  }
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else canvasRoot.requestFullscreen?.();
}

$('start-button').addEventListener('click', beginMatch);
$('continue-button').addEventListener('click', () => {
  if (Math.max(homeScore, awayScore) >= 15 && Math.abs(homeScore - awayScore) >= 2) {
    beginMatch();
  } else {
    startPoint();
  }
});
window.addEventListener('keydown', onKeyDown, { passive: false });
window.addEventListener('keyup', onKeyUp);
window.addEventListener('blur', () => keys.clear());
document.addEventListener('visibilitychange', () => { if (!document.hidden) clock.getDelta(); });
canvasRoot.addEventListener('dblclick', toggleFullscreen);

try {
  createScene();
  $('loading').classList.add('hidden');
  ball.position.set(0, 1, 0);
  render();
} catch (error) {
  console.error('Unable to initialize the volleyball game.', error);
  loading.classList.add('hidden');
  errorMessage.textContent = `Unable to start the 3D game: ${error.message}`;
  errorMessage.classList.remove('hidden');
}
