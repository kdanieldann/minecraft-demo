// Block materials: MeshStandardMaterial (PBR + shadows) extended with wind sway,
// underwater absorption + animated caustics and sky-coloured aerial-perspective fog.
import * as THREE from 'three';

export const SKY_GLSL = /* glsl */`
vec2 dirToSkyUv(vec3 d) {
  return vec2(atan(d.z, d.x) * 0.15915494 + 0.5, asin(clamp(d.y, -1.0, 1.0)) * 0.31830989 + 0.5);
}
`;

export const CAUSTIC_GLSL = /* glsl */`
float caustic(vec2 wp, float t) {
  vec2 p = mod(wp * 0.33, 6.2831853) - 250.0;
  vec2 i = p;
  float c = 1.0;
  const float inten = 0.005;
  for (int n = 0; n < 4; n++) {
    float tt = t * (1.0 - (3.5 / float(n + 1)));
    i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
    c += 1.0 / length(vec2(p.x / (sin(i.x + tt) / inten), p.y / (cos(i.y + tt) / inten)));
  }
  c /= 4.0;
  c = 1.17 - pow(c, 1.4);
  return clamp(pow(abs(c), 8.0), 0.0, 2.0);
}
`;

export function createSharedUniforms() {
  return {
    uTime: { value: 0 },
    uSkyTex: { value: null },
    uSea: { value: 40.9 },
    uUnderwater: { value: 0 },
    uWaterFog: { value: new THREE.Color(0.01, 0.06, 0.08) },
    uSunVis: { value: 1 },
    uWaterTint: { value: new THREE.Color(0.004, 0.03, 0.035) },
    uAerial: { value: 0.0016 },
    uFogStart: { value: 50 },
    uFogEnd: { value: 110 },
    uLightDir: { value: new THREE.Vector3(0, 1, 0) },
    uLightCol: { value: new THREE.Color() },
    uTorch: { value: 1 },
    uDaylight: { value: 1 },
  };
}

export function patchFogShader(shader, U) {
  shader.uniforms.uSkyTex = U.uSkyTex;
  shader.uniforms.uUnderwater = U.uUnderwater;
  shader.uniforms.uWaterFog = U.uWaterFog;
  shader.uniforms.uAerial = U.uAerial;
  shader.uniforms.uFogStart = U.uFogStart;
  shader.uniforms.uFogEnd = U.uFogEnd;
  shader.fragmentShader = `uniform sampler2D uSkyTex;\nuniform float uUnderwater;\nuniform vec3 uWaterFog;\nuniform float uAerial;\nuniform float uFogStart;\nuniform float uFogEnd;\nvarying vec3 vWPos;\n${SKY_GLSL}\n` + shader.fragmentShader;
  shader.fragmentShader = shader.fragmentShader.replace('#include <fog_fragment>', /* glsl */`
    #ifdef USE_FOG
      vec3 vdir = normalize(vWPos - cameraPosition);
      if (uUnderwater > 0.5) {
        float wf = 1.0 - exp(-vFogDepth * 0.11);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, uWaterFog, wf);
      } else {
        vec3 fd = normalize(vec3(vdir.x, max(vdir.y, 0.0) + 0.002, vdir.z));
        vec3 fogC = texture2D(uSkyTex, dirToSkyUv(fd)).rgb;
        float dist = length(vWPos - cameraPosition);
        float ft = clamp((dist - uFogStart) / (uFogEnd - uFogStart), 0.0, 1.0);
        float f1 = 1.0 - exp(-ft * ft * 4.6);
        float f2 = (1.0 - exp(-dist * uAerial)) * 0.5;
        gl_FragColor.rgb = mix(gl_FragColor.rgb, fogC, max(f1, f2));
      }
    #endif
  `);
  if (!shader.vertexShader.includes('varying vec3 vWPos')) {
    shader.vertexShader = 'varying vec3 vWPos;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <fog_vertex>', '#include <fog_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
  }
}

export function makeBlockMaterials(atlas, U) {
  const make = (cutout) => {
    const m = new THREE.MeshStandardMaterial({
      map: atlas.albedo, normalMap: atlas.normal, roughnessMap: atlas.rough,
      roughness: 1, metalness: 0,
      emissiveMap: atlas.emissive, emissive: new THREE.Color(1, 1, 1), emissiveIntensity: 3.2,
      vertexColors: true,
      alphaTest: cutout ? 0.5 : 0,
      side: cutout ? THREE.DoubleSide : THREE.FrontSide,
    });
    m.onBeforeCompile = (s) => {
      s.uniforms.uTime = U.uTime;
      s.uniforms.uSea = U.uSea;
      s.uniforms.uSunVis = U.uSunVis;
      s.uniforms.uWaterTint = U.uWaterTint;
      s.uniforms.uLightDir = U.uLightDir;
      s.uniforms.uLightCol = U.uLightCol;
      s.uniforms.uTorch = U.uTorch;
      s.uniforms.uDaylight = U.uDaylight;
      s.vertexShader = 'attribute vec3 aFx;\nuniform float uTime;\nvarying vec3 vFx;\nvarying vec3 vWPos;\n' + s.vertexShader;
      s.vertexShader = s.vertexShader.replace('#include <begin_vertex>', /* glsl */`
        #include <begin_vertex>
        vFx = aFx;
        if (aFx.x > 0.5) {
          vec3 wp0 = (modelMatrix * vec4(transformed, 1.0)).xyz;
          float amp = aFx.x > 1.5 ? 0.09 : 0.035;
          float ph = uTime * 1.7 + wp0.x * 0.6 + wp0.z * 0.45;
          float gust = 0.6 + 0.4 * sin(uTime * 0.35 + wp0.x * 0.05);
          transformed.x += sin(ph) * amp * gust;
          transformed.z += cos(ph * 0.83 + 1.3) * amp * 0.7 * gust;
          if (aFx.x < 1.5) transformed.y += sin(ph * 1.31) * amp * 0.3;
        }
      `);
      s.vertexShader = s.vertexShader.replace('#include <fog_vertex>', '#include <fog_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      s.fragmentShader = 'uniform float uTime;\nuniform float uSea;\nuniform float uSunVis;\nuniform vec3 uWaterTint;\nuniform vec3 uLightDir;\nuniform vec3 uLightCol;\nuniform float uTorch;\nuniform float uDaylight;\nvarying vec3 vFx;\n' + CAUSTIC_GLSL + s.fragmentShader;
      s.fragmentShader = s.fragmentShader.replace('#include <opaque_fragment>', /* glsl */`
        #include <opaque_fragment>
        if (vFx.z > 0.01) {
          // baked block light from torches / glowstone (warm, falls off like MC light levels)
          float bl = pow(vFx.z, 2.4) * uTorch;
          gl_FragColor.rgb += diffuseColor.rgb * vec3(1.0, 0.6, 0.3) * bl * (2.6 - 1.4 * uDaylight);
        }
        if (vFx.x > 0.01) {
          // foliage: light transmitted through thin leaves (forward scattering) + soft wrap
          vec3 vd = normalize(vWPos - cameraPosition);
          float fw = pow(max(dot(vd, uLightDir), 0.0), 5.0);
          float wgt = min(vFx.x, 1.0);
          gl_FragColor.rgb += diffuseColor.rgb * uLightCol * (0.07 + 0.45 * fw) * wgt;
        }
        if (vFx.y > 0.5) {
          float depth = max(uSea - vWPos.y, 0.0);
          vec3 att = exp(-depth * vec3(0.24, 0.07, 0.05));
          float c = caustic(vWPos.xz, uTime * 0.6) * exp(-depth * 0.08);
          gl_FragColor.rgb = gl_FragColor.rgb * att * (1.0 + c * 2.2 * uSunVis) + uWaterTint * (1.0 - exp(-depth * 0.15));
        }
      `);
      patchFogShader(s, U);
    };
    m.customProgramCacheKey = () => (cutout ? 'block-cutout' : 'block-opaque');
    return m;
  };
  return { opaque: make(false), cutout: make(true) };
}
