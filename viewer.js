import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

const ORIGIN_E = 511796;
const ORIGIN_N = 4405516;
const canvas = document.querySelector('#scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.localClippingEnabled = true;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b100d);
scene.fog = new THREE.FogExp2(0x0b100d, 0.0015);
scene.add(new THREE.HemisphereLight(0xeaf4e5, 0x394238, 2.5));
const sunlight = new THREE.DirectionalLight(0xfff5dc, 2.2);
sunlight.position.set(-80, 120, 100);
scene.add(sunlight);

const perspectiveCamera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.05, 10000);
const orthographicCamera = new THREE.OrthographicCamera(-100, 100, 100, -100, 0.05, 10000);
perspectiveCamera.up.set(0, 0, 1);
orthographicCamera.up.set(0, 0, 1);
let activeCamera = perspectiveCamera;
const controls = new OrbitControls(activeCamera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.screenSpacePanning = true;

let model;
let terrainMesh;
let modelBounds;
let modelCenter = new THREE.Vector3();
let modelDiameter = 200;
let initialCamera;
let currentLayer = 'model';
let locationMarker;
let terrainData;
let wireframeEnabled = false;
const measurementGroup = new THREE.Group();
scene.add(measurementGroup);

const loading = document.querySelector('#loading');
const loadingLabel = document.querySelector('#loading-label');
const progress = document.querySelector('#progress');
const layerNote = document.querySelector('#layer-note');
const measurementResult = document.querySelector('#measurement-result');
const clipPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);
let clipEnabled = false;

function updateMaterialState() {
  const opacity = Number(document.querySelector('#opacity').value) / 100;
  if (model) model.traverse((child) => {
    if (!child.isMesh) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material) => {
      material.wireframe = wireframeEnabled;
      material.transparent = opacity < 1 || currentLayer === 'both';
      material.opacity = currentLayer === 'both' ? Math.min(opacity, 0.72) : opacity;
      material.clippingPlanes = clipEnabled ? [clipPlane] : [];
      material.needsUpdate = true;
    });
  });
  if (terrainMesh) {
    terrainMesh.material.wireframe = wireframeEnabled;
    terrainMesh.material.clippingPlanes = clipEnabled ? [clipPlane] : [];
    terrainMesh.material.needsUpdate = true;
  }
}

function updateOrthographicFrustum() {
  const aspect = window.innerWidth / window.innerHeight;
  const halfHeight = modelDiameter * 0.65;
  orthographicCamera.left = -halfHeight * aspect;
  orthographicCamera.right = halfHeight * aspect;
  orthographicCamera.top = halfHeight;
  orthographicCamera.bottom = -halfHeight;
  orthographicCamera.near = Math.max(modelDiameter / 10000, 0.01);
  orthographicCamera.far = modelDiameter * 25;
  orthographicCamera.updateProjectionMatrix();
}

function frameModel(object) {
  const box = new THREE.Box3().setFromObject(object);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  modelCenter.copy(center);
  object.position.sub(center);
  modelBounds = new THREE.Box3().setFromObject(object);
  modelDiameter = Math.max(size.x, size.y, size.z);
  perspectiveCamera.near = Math.max(modelDiameter / 10000, 0.01);
  perspectiveCamera.far = modelDiameter * 25;
  perspectiveCamera.position.set(modelDiameter * 0.78, modelDiameter * -0.9, modelDiameter * 0.65);
  perspectiveCamera.updateProjectionMatrix();
  updateOrthographicFrustum();
  controls.target.set(0, 0, 0);
  controls.minDistance = modelDiameter * 0.08;
  controls.maxDistance = modelDiameter * 6;
  controls.update();
  initialCamera = perspectiveCamera.position.clone();
  scene.fog.density = 0.7 / (modelDiameter * 5);
}

function terrainColor(ratio) {
  const low = new THREE.Color(0x244b58);
  const middle = new THREE.Color(0x9fb963);
  const high = new THREE.Color(0xf0e5c6);
  return ratio < 0.55 ? low.lerp(middle, ratio / 0.55) : middle.lerp(high, (ratio - 0.55) / 0.45);
}

async function loadTerrain() {
  terrainData = await fetch('./assets/akcakoyun-dtm.json').then((response) => response.json());
  const positions = [];
  const colors = [];
  const indices = [];
  const { width, height, z, min, max } = terrainData;
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const elevation = z[row * width + column];
      const validElevation = elevation ?? min;
      positions.push(terrainData.x0 + column * terrainData.dx - modelCenter.x, terrainData.y0 - row * terrainData.dy - modelCenter.y, validElevation - min);
      const color = terrainColor((validElevation - min) / Math.max(max - min, 0.01));
      colors.push(color.r, color.g, color.b);
    }
  }
  for (let row = 0; row < height - 1; row += 1) {
    for (let column = 0; column < width - 1; column += 1) {
      const a = row * width + column; const b = a + 1; const c = a + width; const d = c + 1;
      if (z[a] !== null && z[b] !== null && z[c] !== null) indices.push(a, c, b);
      if (z[b] !== null && z[c] !== null && z[d] !== null) indices.push(b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  terrainMesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.94, metalness: 0, side: THREE.DoubleSide }));
  terrainMesh.position.z = min - modelCenter.z;
  terrainMesh.visible = false;
  terrainMesh.name = 'DTM terrain';
  scene.add(terrainMesh);
  updateMaterialState();
}

const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/libs/draco/');
const modelLoader = new GLTFLoader();
modelLoader.setDRACOLoader(dracoLoader);
modelLoader.load(
  './assets/akcakoyun-terrain.glb',
  async (gltf) => {
    model = gltf.scene;
    model.traverse((child) => { if (child.isMesh) child.receiveShadow = true; });
    scene.add(model);
    frameModel(model);
    try { await loadTerrain(); } catch (error) { console.error('DTM load failed', error); }
    loading.classList.add('hidden');
  },
  (event) => {
    if (!event.total) return;
    const percent = Math.min(100, Math.round((event.loaded / event.total) * 100));
    progress.style.width = `${percent}%`;
    loadingLabel.textContent = `Loading model · ${percent}%`;
  },
  (error) => {
    console.error(error);
    loadingLabel.textContent = 'The model could not be loaded';
    progress.style.background = '#e36b6b';
  },
);

function setLayer(layer) {
  currentLayer = layer;
  if (model) model.visible = layer !== 'terrain';
  if (terrainMesh) terrainMesh.visible = layer !== 'model';
  document.querySelectorAll('.layer-button').forEach((button) => button.classList.toggle('active', button.dataset.layer === layer));
  const notes = {
    model: 'Hires textured surface reconstruction',
    terrain: terrainData ? `Bare-earth DTM · ${terrainData.min.toFixed(2)}–${terrainData.max.toFixed(2)} m elevation` : 'Loading bare-earth DTM…',
    both: 'DTM beneath a semi-transparent textured surface',
  };
  layerNote.textContent = notes[layer];
  updateMaterialState();
}
document.querySelectorAll('.layer-button').forEach((button) => button.addEventListener('click', () => setLayer(button.dataset.layer)));

function switchProjection(useOrthographic) {
  const next = useOrthographic ? orthographicCamera : perspectiveCamera;
  if (next === activeCamera) return;
  next.position.copy(activeCamera.position);
  next.quaternion.copy(activeCamera.quaternion);
  activeCamera = next;
  controls.object = activeCamera;
  controls.update();
  document.querySelector('#projection').textContent = useOrthographic ? 'Perspective' : 'Orthographic';
}

function setView(view) {
  if (!model) return;
  const distance = modelDiameter * 1.25;
  const positions = {
    perspective: [modelDiameter * 0.78, modelDiameter * -0.9, modelDiameter * 0.65],
    top: [0, 0, distance],
    front: [0, -distance, modelDiameter * 0.18],
    side: [distance, 0, modelDiameter * 0.18],
  };
  activeCamera.position.set(...positions[view]);
  activeCamera.up.set(0, 0, 1);
  controls.target.set(0, 0, 0);
  controls.update();
}

function resetView() {
  switchProjection(false);
  if (!initialCamera) return;
  perspectiveCamera.position.copy(initialCamera);
  controls.target.set(0, 0, 0);
  controls.update();
}
document.querySelector('#reset').addEventListener('click', resetView);
document.querySelector('#panel-reset').addEventListener('click', resetView);
document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => setView(button.dataset.view)));
document.querySelector('#projection').addEventListener('click', () => switchProjection(activeCamera !== orthographicCamera));

document.querySelector('#opacity').addEventListener('input', (event) => {
  document.querySelector('#opacity-value').textContent = `${event.target.value}%`;
  updateMaterialState();
});
document.querySelector('#exaggeration').addEventListener('input', (event) => {
  const value = Number(event.target.value) / 10;
  document.querySelector('#exaggeration-value').textContent = `${value.toFixed(1)}×`;
  if (terrainMesh) terrainMesh.scale.z = value;
});
document.querySelector('#panel-wireframe').addEventListener('change', (event) => {
  wireframeEnabled = event.target.checked;
  updateMaterialState();
});

const clipHeight = document.querySelector('#clip-height');
function updateClipPlane() {
  if (!modelBounds) return;
  const ratio = Number(clipHeight.value) / 100;
  const z = THREE.MathUtils.lerp(modelBounds.min.z, modelBounds.max.z, ratio);
  const reverse = document.querySelector('#clip-reverse').checked;
  clipPlane.normal.set(0, 0, reverse ? 1 : -1);
  clipPlane.constant = reverse ? -z : z;
  document.querySelector('#clip-value').textContent = `${(z + modelCenter.z).toFixed(1)} m`;
  updateMaterialState();
}
document.querySelector('#clip-enabled').addEventListener('change', (event) => {
  clipEnabled = event.target.checked;
  clipHeight.disabled = !clipEnabled;
  updateClipPlane();
});
clipHeight.addEventListener('input', updateClipPlane);
document.querySelector('#clip-reverse').addEventListener('change', updateClipPlane);

let measureMode = null;
let measurePoints = [];
let pointerStart;
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

function addMarker(point, color = 0xb7e36b) {
  const marker = new THREE.Mesh(new THREE.SphereGeometry(modelDiameter * 0.006, 16, 16), new THREE.MeshBasicMaterial({ color, depthTest: false }));
  marker.position.copy(point);
  marker.renderOrder = 10;
  measurementGroup.add(marker);
}

function addLine(points, closed = false) {
  const linePoints = closed ? [...points, points[0]] : points;
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(linePoints), new THREE.LineBasicMaterial({ color: 0xb7e36b, depthTest: false }));
  line.renderOrder = 9;
  measurementGroup.add(line);
}

function clearMeasurements() {
  measurePoints = [];
  while (measurementGroup.children.length) {
    const child = measurementGroup.children.pop();
    child.geometry?.dispose(); child.material?.dispose();
  }
  measurementResult.textContent = 'Choose a tool, then tap the terrain.';
}

function selectMeasureMode(mode) {
  measureMode = mode;
  measurePoints = [];
  document.querySelectorAll('[data-measure]').forEach((button) => button.classList.toggle('active', button.dataset.measure === mode));
  const prompts = { point: 'Tap once for UTM coordinates and elevation.', distance: 'Tap two points.', height: 'Tap two points.', area: 'Tap at least three corners, then Finish area.' };
  measurementResult.textContent = prompts[mode];
}
document.querySelectorAll('[data-measure]').forEach((button) => button.addEventListener('click', () => selectMeasureMode(button.dataset.measure)));
document.querySelector('#clear-measurements').addEventListener('click', clearMeasurements);

function finishArea() {
  if (measureMode !== 'area' || measurePoints.length < 3) {
    measurementResult.textContent = 'Add at least three area corners first.';
    return;
  }
  addLine(measurePoints, true);
  let twiceArea = 0;
  measurePoints.forEach((point, index) => {
    const next = measurePoints[(index + 1) % measurePoints.length];
    twiceArea += point.x * next.y - next.x * point.y;
  });
  measurementResult.textContent = `Planimetric area: ${Math.abs(twiceArea / 2).toFixed(1)} m²`;
  measurePoints = [];
}
document.querySelector('#finish-area').addEventListener('click', finishArea);

function pickTerrain(event) {
  if (!measureMode) return;
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, activeCamera);
  const hit = raycaster.intersectObjects([model, terrainMesh].filter((object) => object?.visible), true)[0];
  if (!hit) return;
  const point = hit.point.clone();
  addMarker(point);
  if (measureMode === 'point') {
    const raw = point.clone().add(modelCenter);
    measurementResult.textContent = `E ${Math.round(raw.x + ORIGIN_E)} · N ${Math.round(raw.y + ORIGIN_N)} · ${raw.z.toFixed(2)} m elevation`;
    return;
  }
  measurePoints.push(point);
  if (measureMode === 'area') {
    if (measurePoints.length > 1) addLine(measurePoints.slice(-2));
    measurementResult.textContent = `${measurePoints.length} area corner${measurePoints.length === 1 ? '' : 's'} selected`;
    return;
  }
  if (measurePoints.length === 2) {
    addLine(measurePoints);
    measurementResult.textContent = measureMode === 'distance' ? `3D distance: ${measurePoints[0].distanceTo(measurePoints[1]).toFixed(2)} m` : `Vertical difference: ${Math.abs(measurePoints[1].z - measurePoints[0].z).toFixed(2)} m`;
    measurePoints = [];
  }
}
canvas.addEventListener('pointerdown', (event) => { pointerStart = { x: event.clientX, y: event.clientY }; });
canvas.addEventListener('pointerup', (event) => {
  if (!pointerStart || Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 5) return;
  pickTerrain(event);
});

const locationStatus = document.querySelector('#location-status');
function setLocationStatus(message) { locationStatus.hidden = false; locationStatus.textContent = message; }
function latLonToUtm35(latitude, longitude) {
  const a = 6378137; const f = 1 / 298.257223563; const k0 = 0.9996; const e2 = f * (2 - f); const ep2 = e2 / (1 - e2);
  const lat = THREE.MathUtils.degToRad(latitude); const lon = THREE.MathUtils.degToRad(longitude); const lonOrigin = THREE.MathUtils.degToRad(27);
  const sinLat = Math.sin(lat); const cosLat = Math.cos(lat); const tanLat = Math.tan(lat); const n = a / Math.sqrt(1 - e2 * sinLat * sinLat);
  const t = tanLat * tanLat; const c = ep2 * cosLat * cosLat; const aa = cosLat * (lon - lonOrigin);
  const m = a * ((1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256) * lat - (3 * e2 / 8 + 3 * e2 ** 2 / 32 + 45 * e2 ** 3 / 1024) * Math.sin(2 * lat) + (15 * e2 ** 2 / 256 + 45 * e2 ** 3 / 1024) * Math.sin(4 * lat) - (35 * e2 ** 3 / 3072) * Math.sin(6 * lat));
  return { easting: k0 * n * (aa + (1 - t + c) * aa ** 3 / 6 + (5 - 18 * t + t ** 2 + 72 * c - 58 * ep2) * aa ** 5 / 120) + 500000, northing: k0 * (m + n * tanLat * (aa ** 2 / 2 + (5 - t + 9 * c + 4 * c ** 2) * aa ** 4 / 24 + (61 - 58 * t + t ** 2 + 600 * c - 330 * ep2) * aa ** 6 / 720)) };
}

function addLocationMarker(position, accuracy) {
  if (locationMarker) scene.remove(locationMarker);
  locationMarker = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.RingGeometry(Math.max(1, accuracy - 0.35), Math.max(1.35, accuracy + 0.35), 64), new THREE.MeshBasicMaterial({ color: 0x6fd7ff, transparent: true, opacity: 0.45, side: THREE.DoubleSide }));
  const dot = new THREE.Mesh(new THREE.SphereGeometry(1.15, 24, 24), new THREE.MeshBasicMaterial({ color: 0x6fd7ff }));
  ring.position.z = 0.12; dot.position.z = 7.5; locationMarker.add(ring, dot); locationMarker.position.copy(position); scene.add(locationMarker);
}

function showDevicePosition(position) {
  if (!model || !modelBounds) return setLocationStatus('The terrain is still loading. Try again when it appears.');
  const { easting, northing } = latLonToUtm35(position.coords.latitude, position.coords.longitude);
  const x = easting - ORIGIN_E - modelCenter.x; const y = northing - ORIGIN_N - modelCenter.y;
  const locator = new THREE.Raycaster(new THREE.Vector3(x, y, modelBounds.max.z + 100), new THREE.Vector3(0, 0, -1));
  const hit = locator.intersectObjects([model, terrainMesh].filter(Boolean), true)[0];
  if (!hit) return setLocationStatus(`You are outside the reconstructed area. GPS accuracy ±${Math.round(position.coords.accuracy)} m.`);
  addLocationMarker(hit.point, Math.min(Math.max(position.coords.accuracy, 1.5), 20));
  controls.target.copy(hit.point); activeCamera.position.set(hit.point.x + 35, hit.point.y - 45, hit.point.z + 40); controls.update();
  setLocationStatus(`Your approximate location is marked in blue. Phone GPS accuracy ±${Math.round(position.coords.accuracy)} m.`);
}
document.querySelector('#locate').addEventListener('click', () => {
  if (!navigator.geolocation) return setLocationStatus('Location is not supported by this browser.');
  setLocationStatus('Waiting for your phone’s GPS…');
  navigator.geolocation.getCurrentPosition(showDevicePosition, () => setLocationStatus('Location could not be determined. Check the browser’s site permission.'), { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 });
});

document.querySelector('#rotate').addEventListener('click', (event) => {
  controls.autoRotate = !controls.autoRotate; controls.autoRotateSpeed = 0.7;
  event.currentTarget.setAttribute('aria-pressed', String(controls.autoRotate));
});
document.querySelector('#fullscreen').addEventListener('click', async () => {
  if (!document.fullscreenElement) await document.documentElement.requestFullscreen(); else await document.exitFullscreen();
});

const toolPanel = document.querySelector('#tool-panel');
const panelToggle = document.querySelector('#panel-toggle');
function setPanel(open) { toolPanel.classList.toggle('closed', !open); panelToggle.setAttribute('aria-expanded', String(open)); }
panelToggle.addEventListener('click', () => setPanel(toolPanel.classList.contains('closed')));
document.querySelector('#panel-close').addEventListener('click', () => setPanel(false));
if (window.innerWidth <= 760) setPanel(false);

window.addEventListener('resize', () => {
  perspectiveCamera.aspect = window.innerWidth / window.innerHeight;
  perspectiveCamera.updateProjectionMatrix();
  updateOrthographicFrustum();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, activeCamera); });
