// Post-processing chain (HDR, MSAA): scene -> screen-space god rays -> first-person hand
// overlay -> bloom -> colour grade/vignette/underwater -> ACES tone map + sRGB.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

class GodRaysPass extends Pass {
  constructor() {
    super();
    this.uniforms = {
      tDiffuse: { value: null }, tDepth: { value: null },
      uSun: { value: new THREE.Vector2(0.5, 0.5) }, uStrength: { value: 0 },
      uColor: { value: new THREE.Color() }, uAspect: { value: 1 }, uFrame: { value: 0 },
    };
    this.fsQuad = new FullScreenQuad(new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: VERT, depthTest: false, depthWrite: false,
      fragmentShader: /* glsl */`
        uniform sampler2D tDiffuse, tDepth; uniform vec2 uSun; uniform float uStrength, uAspect, uFrame; uniform vec3 uColor;
        varying vec2 vUv;
        float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
        void main() {
          vec4 base = texture2D(tDiffuse, vUv);
          if (uStrength < 0.001) { gl_FragColor = base; return; }
          const int N = 48;
          vec2 delta = (uSun - vUv) * (0.92 / float(N));
          vec2 uv = vUv + delta * ign(gl_FragCoord.xy + uFrame * 5.588238);
          float acc = 0.0, decay = 1.0;
          for (int i = 0; i < N; i++) {
            vec2 suv = clamp(uv, 0.001, 0.999);
            float sky = step(0.99999, texture2D(tDepth, suv).x);
            float l = dot(texture2D(tDiffuse, suv).rgb, vec3(0.2126, 0.7152, 0.0722));
            acc += sky * min(l, 3.0) * decay;
            decay *= 0.962;
            uv += delta;
          }
          acc /= float(N);
          float dist = length((uSun - vUv) * vec2(uAspect, 1.0));
          gl_FragColor = vec4(base.rgb + uColor * acc * uStrength * exp(-dist * 1.6), base.a);
        }`,
    }));
  }
  render(renderer, writeBuffer, readBuffer) {
    this.uniforms.tDiffuse.value = readBuffer.texture;
    this.uniforms.tDepth.value = readBuffer.depthTexture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.fsQuad.render(renderer);
  }
}

class OverlayPass extends Pass {
  constructor(scene, camera) { super(); this.scene = scene; this.camera = camera; this.needsSwap = false; }
  render(renderer, writeBuffer, readBuffer) {
    const ac = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(readBuffer);
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    renderer.autoClear = ac;
  }
}

class GradePass extends Pass {
  constructor() {
    super();
    this.uniforms = { tDiffuse: { value: null }, uUnderwater: { value: 0 }, uTime: { value: 0 }, uSat: { value: 1.12 }, uVignette: { value: 0.28 } };
    this.fsQuad = new FullScreenQuad(new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: VERT, depthTest: false, depthWrite: false,
      fragmentShader: /* glsl */`
        uniform sampler2D tDiffuse; uniform float uUnderwater, uTime, uSat, uVignette; varying vec2 vUv;
        void main() {
          vec2 uv = vUv;
          if (uUnderwater > 0.5) uv += vec2(sin(uv.y * 24.0 + uTime * 2.0), cos(uv.x * 20.0 + uTime * 1.7)) * 0.0022;
          vec3 c = texture2D(tDiffuse, uv).rgb;
          float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
          c = max(mix(vec3(l), c, uSat), 0.0);
          // gentle split-tone: warm highlights, cool shadows
          c *= mix(vec3(0.96, 0.99, 1.05), vec3(1.03, 1.0, 0.96), smoothstep(0.0, 1.2, l));
          if (uUnderwater > 0.5) c *= vec3(0.55, 0.9, 1.0);
          vec2 q = vUv - 0.5;
          c *= 1.0 - uVignette * smoothstep(0.25, 0.85, dot(q, q) * 2.2);
          gl_FragColor = vec4(c, 1.0);
        }`,
    }));
  }
  render(renderer, writeBuffer, readBuffer) {
    this.uniforms.tDiffuse.value = readBuffer.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.fsQuad.render(renderer);
  }
}

export class PostFX {
  constructor(renderer, scene, camera, overlayScene, overlayCamera) {
    this.renderer = renderer; this.camera = camera;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType, samples: 4, depthTexture: new THREE.DepthTexture(size.x, size.y),
    });
    this.composer = new EffectComposer(renderer, rt);
    this.composer.addPass(new RenderPass(scene, camera));
    this.god = new GodRaysPass(); this.composer.addPass(this.god);
    this.overlay = new OverlayPass(overlayScene, overlayCamera); this.composer.addPass(this.overlay);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.32, 0.55, 1.1);
    this.composer.addPass(this.bloom);
    this.grade = new GradePass(); this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
    this.godEnabled = true;
    this._v = new THREE.Vector3();
    this.frame = 0;
  }

  setSize(w, h) {
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    const s = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    for (const t of [this.composer.renderTarget1, this.composer.renderTarget2]) {
      if (t.depthTexture) { t.depthTexture.image.width = s.x; t.depthTexture.image.height = s.y; t.depthTexture.needsUpdate = true; }
    }
  }

  update(sky, camPos, underwater, time) {
    this.frame++;
    const g = this.god.uniforms;
    g.uFrame.value = this.frame % 64;
    g.uAspect.value = this.camera.aspect;
    const sunDir = sky.sunDir.y > -0.02 ? sky.sunDir : sky.moonDir;
    const isSun = sunDir === sky.sunDir;
    const p = this._v.copy(camPos).addScaledVector(sunDir, 500).project(this.camera);
    const front = this._v.z < 1 && this.camera.getWorldDirection(new THREE.Vector3()).dot(sunDir) > 0;
    g.uSun.value.set(p.x * 0.5 + 0.5, p.y * 0.5 + 0.5);
    const elev = Math.max(0, sunDir.y);
    const lowSun = 1.0 + 0.7 * Math.exp(-elev * 6);
    const strength = !this.godEnabled || underwater || !front ? 0 : isSun ? 0.32 * lowSun * Math.min(1, sky.light.intensity / 2) : 0.2;
    g.uStrength.value = strength;
    g.uColor.value.copy(isSun ? sky.sunColor : new THREE.Color(0.5, 0.6, 0.9));
    this.grade.uniforms.uUnderwater.value = underwater ? 1 : 0;
    this.grade.uniforms.uTime.value = time;
  }

  render(dt) { this.composer.render(dt); }
}
