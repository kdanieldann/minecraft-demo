// Renders inventory icons from the real block models (isometric, offscreen), so stairs,
// torches and cubes all look like what gets placed. Plants use their flat sprite.
import * as THREE from 'three';
import { buildItemGeometry } from './world.js';
import { KIND, K, TEX_SIDE } from './blocks.js';

export function renderIcons(atlas, ids, size = 64) {
  const out = new Map();
  const r = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
  r.setPixelRatio(1);
  r.setSize(size, size);
  r.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, 1.1));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(0.35, 1, 0.75);
  scene.add(sun);
  const cam = new THREE.OrthographicCamera(-0.92, 0.92, 0.92, -0.92, 0.1, 10);
  cam.position.set(2, 1.64, 2);
  cam.lookAt(0, 0, 0);
  const mat = new THREE.MeshLambertMaterial({ map: atlas.albedo, emissiveMap: atlas.emissive, emissive: 0xffffff, emissiveIntensity: 0.7, alphaTest: 0.5, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
  scene.add(mesh);

  for (const id of ids) {
    const c = document.createElement('canvas'); c.width = c.height = size;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    if (KIND[id] === K.PLANT) {
      g.drawImage(atlas.tileCanvas(TEX_SIDE[id]), size * 0.12, size * 0.12, size * 0.76, size * 0.76);
    } else {
      mesh.geometry.dispose();
      mesh.geometry = buildItemGeometry(id);
      mesh.scale.setScalar(KIND[id] === K.TORCH ? 2.1 : 1);
      r.render(scene, cam);
      g.drawImage(r.domElement, 0, 0);
    }
    out.set(id, c);
  }
  mesh.geometry.dispose();
  mat.dispose();
  r.dispose();
  r.forceContextLoss();
  return out;
}
