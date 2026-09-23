// First/third-person player: pointer-lock mouse look, AABB-vs-voxel physics, swimming,
// creative flight, block breaking/placing and camera effects (bob, sprint FOV).
import * as THREE from 'three';
import { B, SOLID, KIND, K, stairBoxes } from './blocks.js';

const HW = 0.3, HEIGHT = 1.8, EYE = 1.62;

export class Player {
  constructor(camera, world, dom) {
    this.camera = camera; this.world = world; this.dom = dom;
    this.pos = new THREE.Vector3(0, 80, 0);
    this.vel = new THREE.Vector3();
    this.yaw = -Math.PI * 0.75; this.pitch = -0.1;
    this.onGround = false; this.flying = false; this.inWater = false; this.headInWater = false;
    this.keys = new Set();
    this.view = 0; // 0 first person, 1 back, 2 front
    this.bob = 0; this.bobAmt = 0; this.fov = 72; this.baseFov = 72;
    this.lastSpace = 0;
    this.eyeSmooth = 0;
    this.speed = 0;
    this.locked = false;
    this.sens = 0.0022;

    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === dom; });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.yaw -= e.movementX * this.sens;
      this.pitch = Math.max(-1.55, Math.min(1.55, this.pitch - e.movementY * this.sens));
    });
    window.addEventListener('keydown', (e) => {
      if (!this.locked) return;
      if (e.code === 'Space' && !e.repeat) {
        const now = performance.now();
        if (now - this.lastSpace < 280) { this.flying = !this.flying; this.vel.y = 0; }
        this.lastSpace = now;
      }
      if (e.code === 'KeyF' && !e.repeat) { this.flying = !this.flying; this.vel.y = 0; }
      if ((e.code === 'KeyV' || e.code === 'F5') && !e.repeat) { this.view = (this.view + 1) % 3; e.preventDefault(); }
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  forward() { return new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)); }
  lookDir() {
    const cp = Math.cos(this.pitch);
    return new THREE.Vector3(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
  }
  eye() { return new THREE.Vector3(this.pos.x, this.pos.y + EYE, this.pos.z); }

  collides(px, py, pz) {
    const w = this.world;
    const x0 = Math.floor(px - HW), x1 = Math.floor(px + HW - 1e-6);
    const y0 = Math.floor(py), y1 = Math.floor(py + HEIGHT - 1e-6);
    const z0 = Math.floor(pz - HW), z1 = Math.floor(pz + HW - 1e-6);
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      const b = w.getBlock(x, y, z);
      if (!SOLID[b]) continue;
      if (KIND[b] !== K.STAIRS) return true;
      for (const q of stairBoxes(b)) {
        if (px + HW > x + q[0] && px - HW < x + q[3] && py + HEIGHT > y + q[1] && py < y + q[4] && pz + HW > z + q[2] && pz - HW < z + q[5]) return true;
      }
    }
    return false;
  }

  moveAxis(axis, amount) {
    if (amount === 0) return false;
    const p = this.pos;
    const steps = Math.ceil(Math.abs(amount) / 0.4);
    const d = amount / steps;
    const at = (t) => [axis === 0 ? p.x + t : p.x, axis === 1 ? p.y + t : p.y, axis === 2 ? p.z + t : p.z];
    for (let i = 0; i < steps; i++) {
      if (this.collides(...at(d))) {
        // bisect to the contact point (handles half-height shapes like stairs)
        let lo = 0, hi = d;
        for (let k = 0; k < 10; k++) { const m = (lo + hi) / 2; if (this.collides(...at(m))) hi = m; else lo = m; }
        const r = at(lo);
        p.set(r[0], r[1], r[2]);
        return true;
      }
      const r = at(d);
      p.set(r[0], r[1], r[2]);
    }
    return false;
  }

  // Horizontal move with automatic step-up onto ledges up to 0.6 high (stairs, slabs).
  moveHoriz(axis, amount) {
    const hit = this.moveAxis(axis, amount);
    if (!hit || !this.onGround || this.flying || this.inWater) return hit;
    const p = this.pos;
    if (this.collides(p.x, p.y + 0.6, p.z)) return hit;
    const saved = p.clone();
    p.y += 0.6;
    const hit2 = this.moveAxis(axis, amount);
    const moved = Math.abs((axis === 0 ? p.x - saved.x : p.z - saved.z));
    if (hit2 && moved < 0.05) { p.copy(saved); return hit; }
    this.moveAxis(1, -0.6);
    this.eyeSmooth -= p.y - saved.y;
    return false;
  }

  update(dt) {
    const k = this.keys, w = this.world;
    const fwd = this.forward(), right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const wish = new THREE.Vector3();
    if (k.has('KeyW')) wish.add(fwd);
    if (k.has('KeyS')) wish.sub(fwd);
    if (k.has('KeyD')) wish.add(right);
    if (k.has('KeyA')) wish.sub(right);
    if (wish.lengthSq() > 0) wish.normalize();
    const sprint = k.has('ShiftLeft') || k.has('ShiftRight') || k.has('ControlLeft');

    const feet = w.getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y + 0.4), Math.floor(this.pos.z));
    const head = w.getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y + EYE), Math.floor(this.pos.z));
    this.inWater = feet === B.WATER || head === B.WATER;
    this.headInWater = head === B.WATER;

    let speed;
    if (this.flying) {
      speed = sprint ? 22 : 11;
      const up = (k.has('Space') ? 1 : 0) - (k.has('ShiftLeft') || k.has('ShiftRight') ? 1 : 0);
      const target = wish.clone().multiplyScalar(k.has('ControlLeft') ? 22 : 11);
      const a = 1 - Math.exp(-dt * 8);
      this.vel.x += (target.x - this.vel.x) * a;
      this.vel.z += (target.z - this.vel.z) * a;
      this.vel.y += (up * 9 - this.vel.y) * a;
    } else if (this.inWater) {
      speed = 2.6;
      const a = 1 - Math.exp(-dt * 4);
      this.vel.x += (wish.x * speed - this.vel.x) * a;
      this.vel.z += (wish.z * speed - this.vel.z) * a;
      this.vel.y -= 9 * dt;
      if (k.has('Space')) this.vel.y += 22 * dt;
      this.vel.y = Math.max(-3.5, Math.min(3.6, this.vel.y * (1 - dt * 1.5)));
    } else {
      speed = sprint ? 5.9 : 4.3;
      const a = 1 - Math.exp(-dt * (this.onGround ? 16 : 3.2));
      this.vel.x += (wish.x * speed - this.vel.x) * a;
      this.vel.z += (wish.z * speed - this.vel.z) * a;
      this.vel.y -= 30 * dt;
      this.vel.y = Math.max(this.vel.y, -60);
      if (k.has('Space') && this.onGround) { this.vel.y = 8.6; this.onGround = false; }
    }

    const hitX = this.moveHoriz(0, this.vel.x * dt);
    if (hitX) this.vel.x = 0;
    const hitZ = this.moveHoriz(2, this.vel.z * dt);
    if (hitZ) this.vel.z = 0;
    const vy = this.vel.y;
    const hitY = this.moveAxis(1, vy * dt);
    this.onGround = hitY && vy < 0;
    if (hitY) this.vel.y = 0;
    // Hop out of water onto a ledge when pushing against it.
    if (this.inWater && (hitX || hitZ) && k.has('Space')) this.vel.y = 5.2;
    if (this.flying && this.onGround) this.flying = false;

    if (this.pos.y < -30) { this.pos.y = 110; this.vel.set(0, 0, 0); }

    this.eyeSmooth *= Math.exp(-dt * 14);
    this.speed = Math.hypot(this.vel.x, this.vel.z);
    const moving = this.onGround && this.speed > 0.5;
    this.bobAmt += ((moving ? Math.min(1, this.speed / 5) : 0) - this.bobAmt) * Math.min(1, dt * 8);
    this.bob += dt * this.speed * 1.9;
    const targetFov = this.baseFov + (sprint && this.speed > 4.8 ? 9 : 0) + (this.flying && this.speed > 12 ? 6 : 0);
    this.fov += (targetFov - this.fov) * Math.min(1, dt * 8);
  }

  updateCamera() {
    const cam = this.camera;
    const eye = this.eye();
    eye.y += this.eyeSmooth;
    if (cam.fov !== this.fov) { cam.fov = this.fov; cam.updateProjectionMatrix(); }
    if (this.view === 0) {
      const b = this.bobAmt;
      eye.y += Math.abs(Math.sin(this.bob)) * 0.07 * b;
      const r = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      eye.addScaledVector(r, Math.sin(this.bob) * 0.035 * b);
      cam.position.copy(eye);
      cam.rotation.set(this.pitch, this.yaw, Math.sin(this.bob) * 0.006 * b, 'YXZ');
    } else {
      const dir = this.lookDir();
      const back = this.view === 1 ? dir.clone().negate() : dir.clone();
      let dist = 4.2;
      const hit = this.world.raycast(eye, back, dist + 0.3);
      if (hit) dist = Math.max(0.6, hit.t - 0.3);
      cam.position.copy(eye).addScaledVector(back, dist);
      cam.lookAt(eye);
    }
  }
}
