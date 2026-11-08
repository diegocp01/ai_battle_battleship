import * as THREE from 'three';
import { WALL } from './wall.js';
import { Ripples, bakeFoamWeb } from './ripples.js';

// The open sea. Gerstner swells displace a dense grid around the battlefield (and the same waves are
// evaluated on the CPU so ships and buoys ride them); four layers of a baked wave spectrum add the fine chop,
// each moving at the phase speed of its own wavelength. Over the battle area a live ripple simulation adds the
// rings every strike, droplet and hull pushes into the water, and carries the white water they leave, drawn
// as a lace of bubbles. Shading combines a planar mirror (ships, fire and sky all reflect), Fresnel, light scattered
// through the wave crests, a sharp sun glitter path, cloud shadows, whitecaps, foam where waves meet a
// hull or a shell lands, oil slicks over wrecks, and the two 10 × 10 target grids projected on the water.
const MAX_SLICKS = 10, MAX_SHIPS = 10, MAX_LIGHTS = 6;
export const NO_REFLECTION_LAYER = 2;

// Real sea state at 75 m per square: a long swell of about 650 m and wind waves down to ~50 m, 3–4 m from
// trough to crest at most, travelling at the speeds deep-water gravity waves really have.
const WAVES = [
    // direction x, direction z, steepness, wavelength (squares)
    [1, .32, .016, 8.8],
    [.82, -.48, .017, 5.1],
    [.35, .9, .019, 3.1],
    [1, -.1, .022, 1.9],
    [-.3, 1, .024, 1.1],
    [.7, .55, .024, .68],
];
const GRAVITY = 9.81 / 75;

const vertexShader = /* glsl */`
uniform float uTime;
uniform vec4 uWaves[6];
uniform sampler2D uRipple;
uniform vec4 uRippleBounds;
varying vec3 vWorld;
varying vec3 vFlat;
varying vec3 vMacroNormal;
varying float vCrest;
#include <common>
#include <logdepthbuf_pars_vertex>

vec3 gerstner(vec4 wave, vec2 p, inout vec3 tangent, inout vec3 binormal, inout float crest) {
    float k = 6.2831853 / wave.w;
    float c = sqrt(${GRAVITY.toFixed(4)} / k);
    vec2 d = normalize(wave.xy);
    float f = k * (dot(d, p) - c * uTime);
    float a = wave.z / k;
    float sf = sin(f), cf = cos(f);
    tangent += vec3(-d.x * d.x * wave.z * sf, d.x * wave.z * cf, -d.x * d.y * wave.z * sf);
    binormal += vec3(-d.x * d.y * wave.z * sf, d.y * wave.z * cf, -d.y * d.y * wave.z * sf);
    crest += wave.z * sf;
    return vec3(d.x * a * cf, a * sf, d.y * a * cf);
}

void main() {
    vec4 world = modelMatrix * vec4(position, 1.);
    vec2 p = world.xz;
    float fade = 1. - smoothstep(70., 260., length(p));
    vec3 tangent = vec3(1., 0., 0.), binormal = vec3(0., 0., 1.), offset = vec3(0.);
    float crest = 0.;
    for (int i = 0; i < 6; i++) offset += gerstner(uWaves[i], p, tangent, binormal, crest);
    vFlat = world.xyz;
    world.xyz += offset * fade;
    vec2 ruv = (p - uRippleBounds.xy) / uRippleBounds.zw;
    if (ruv.x > 0. && ruv.x < 1. && ruv.y > 0. && ruv.y < 1.) world.y += textureLod(uRipple, ruv, 0.).r;
    vMacroNormal = normalize(mix(vec3(0., 1., 0.), normalize(cross(binormal, tangent)), fade));
    vCrest = crest / .122 * fade;
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
    #include <logdepthbuf_vertex>
}
`;

const fragmentShader = /* glsl */`
uniform float uTime;
uniform sampler2D uNormalMap;
uniform sampler2D uFoamMap;
uniform sampler2D uReflection;
uniform sampler2D uGridState;
uniform mat4 uTextureMatrix;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uDeep;
uniform vec3 uScatter;
uniform vec3 uSkyLight;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uGridOpacity;
uniform sampler2D uRipple;
uniform sampler2D uRippleFoam;
uniform sampler2D uFoamWeb;
uniform vec4 uRippleBounds;
uniform vec2 uRippleTexel;
uniform vec4 uSlicks[${MAX_SLICKS}];
uniform vec4 uShips[${MAX_SHIPS}];
uniform vec4 uShips2[${MAX_SHIPS}];
uniform vec4 uLights[${MAX_LIGHTS}];
uniform vec3 uLightColors[${MAX_LIGHTS}];
uniform vec4 uGrids[2];
uniform vec3 uGridColors[2];
uniform vec4 uTarget;
uniform vec3 uTargetColor;
varying vec3 vWorld;
varying vec3 vFlat;
varying vec3 vMacroNormal;
varying float vCrest;
#include <common>
#include <logdepthbuf_pars_fragment>

vec2 slopeAt(vec2 uv) {
    vec4 t = texture2D(uNormalMap, uv);
    return vec2(t.r * 2. - 1., t.g * 2. - 1.) / max(t.b, .3);
}

void main() {
    #include <logdepthbuf_fragment>
    vec3 toEye = cameraPosition - vWorld;
    float dist = length(toEye);
    vec3 V = toEye / dist;
    vec2 p = vFlat.xz;
    vec3 sunDir = normalize(uSunDir);

    // Oil slicks calm the surface and darken it.
    float slick = 0.;
    float slickPhase = 0.;
    for (int i = 0; i < ${MAX_SLICKS}; i++) {
        vec4 s = uSlicks[i];
        if (s.w <= 0.) continue;
        float grow = clamp((uTime - s.z) / 7. + .25, 0., 1.);
        float wobble = texture2D(uFoamMap, p * .18 + float(i) * .37).g - .5;
        float d = length(p - s.xy) + wobble * s.w * .7;
        float m = smoothstep(s.w * grow, s.w * grow * .45, d);
        if (m > slick) { slick = m; slickPhase = d * 3.1 + wobble * 4.; }
    }

    // The live ripple field: rings from strikes, droplets and hulls (their slopes), and the white water they
    // leave behind.
    vec2 ripple = vec2(0.);
    float foam = 0.;
    vec2 ruv = (p - uRippleBounds.xy) / uRippleBounds.zw;
    if (ruv.x > 0. && ruv.x < 1. && ruv.y > 0. && ruv.y < 1.) {
        vec2 e = uRippleTexel;
        float hE = texture2D(uRipple, ruv + vec2(e.x, 0.)).r, hW = texture2D(uRipple, ruv - vec2(e.x, 0.)).r;
        float hN = texture2D(uRipple, ruv + vec2(0., e.y)).r, hS = texture2D(uRipple, ruv - vec2(0., e.y)).r;
        vec2 cell = uRippleBounds.zw * e;
        vec2 edgeFade = smoothstep(vec2(0.), vec2(.04), min(ruv, 1. - ruv));
        // Slopes steepened for the screen: the rings must read in the sky they mirror from far above.
        ripple = vec2(hE - hW, hN - hS) / (2. * cell) * edgeFade.x * edgeFade.y * 2.2;
        foam += texture2D(uRippleFoam, ruv).r;
    }

    // Detail normals: four scales drifting in different directions; fine layers fade with distance.
    float near = 1. - smoothstep(25., 150., dist);
    float closeUp = 1. - smoothstep(4., 32., dist);
    vec2 slope = slopeAt(p * .072 + uTime * vec2(.0125, .0056)) * .95
               + slopeAt(p * .16 + uTime * vec2(-.0102, .0177)) * .75
               + slopeAt(p * .41 + uTime * vec2(.0276, -.0172)) * .5 * near
               + slopeAt(p * 1.15 + uTime * vec2(-.0451, -.0306)) * .32 * closeUp;
    slope *= .62 * (1. - slick * .8);
    slope += ripple;
    vec3 macro = normalize(vMacroNormal);
    vec3 N = normalize(vec3(macro.x / macro.y - slope.x, 1., macro.z / macro.y - slope.y));

    // Cloud shadows drifting across the sea.
    float cloud = texture2D(uFoamMap, p * .0045 + uTime * vec2(.0011, .0006)).g;
    float sunlit = mix(.62, 1., smoothstep(.36, .62, cloud));

    // Reflection: the mirrored scene, nudged by the surface normal.
    vec4 projected = uTextureMatrix * vec4(vFlat.x, 0., vFlat.z, 1.);
    // The mirror image, nudged by the waves (gently: strong distortion breaks it into hard-edged shards) and
    // softened by a small disc of taps, as a slightly rough sea blurs what it reflects.
    vec2 reflectUv = projected.xy / projected.w + N.xz * (.016 + .014 * near);
    vec2 spread = vec2(.0025, .0035) * (.6 + clamp(length(N.xz) * 6., 0., 1.));
    vec3 reflection = texture2D(uReflection, reflectUv).rgb * .36
        + texture2D(uReflection, reflectUv + spread * vec2(1., .3)).rgb * .16
        + texture2D(uReflection, reflectUv + spread * vec2(-.3, 1.)).rgb * .16
        + texture2D(uReflection, reflectUv + spread * vec2(-1., -.3)).rgb * .16
        + texture2D(uReflection, reflectUv + spread * vec2(.3, -1.)).rgb * .16;

    float cosTheta = clamp(dot(N, V), 0., 1.);
    float fresnel = .02 + .98 * pow(1. - cosTheta, 5.);

    // Body color with light scattered through the crests when looking toward the sun.
    float towardSun = pow(clamp(dot(-V, sunDir) * .5 + .5, 0., 1.), 4.);
    float crest = clamp(vCrest * .5 + .5, 0., 1.);
    float diffuse = clamp(dot(N, sunDir), 0., 1.);
    vec3 body = uDeep * (uSkyLight + diffuse * .25 * uSunColor * sunlit);
    body += uScatter * (towardSun * (.25 + crest * 1.25) * .8 + crest * .18) * sunlit * uSunColor * .35;
    body = mix(body, body * vec3(.35, .32, .3), slick);

    vec3 color = mix(body, reflection, fresnel);

    // Sun glitter: a needle-sharp lobe for sparkles and a broad sheen.
    vec3 H = normalize(sunDir + V);
    float nh = clamp(dot(N, H), 0., 1.);
    float glitter = pow(nh, 1900.) * 38. + pow(nh, 300.) * .45 + pow(nh, 60.) * .025;
    color += uSunColor * glitter * sunlit * (1. - slick * .5);

    // Oil sheen.
    color += slick * (.5 + .5 * cos(6.2831 * (vec3(0., .33, .67) + slickPhase))) * .05 * (.4 + fresnel);

    // Fire and flashes light the water around them.
    for (int i = 0; i < ${MAX_LIGHTS}; i++) {
        vec4 L = uLights[i];
        if (L.w <= 0.) continue;
        vec3 toLight = L.xyz - vWorld;
        float d2 = dot(toLight, toLight);
        vec3 l = toLight * inversesqrt(d2);
        float spec = pow(clamp(dot(N, normalize(l + V)), 0., 1.), 90.);
        color += uLightColors[i] * L.w / (d2 + .35) * (clamp(dot(N, l), 0., 1.) * .05 + spec * 1.4);
    }

    // Whitecaps, hull contact foam, wakes and sinking turbulence.
    // Small, scattered whitecaps riding the crests.
    float capField = texture2D(uFoamMap, p * .17 + uTime * vec2(.006, .003)).g + texture2D(uFoamMap, p * .61 - uTime * .004).b * .35 - .17;
    float caps = smoothstep(.72, .9, capField + vCrest * .12) * smoothstep(-.2, .6, vCrest);
    foam += caps * .22;
    for (int i = 0; i < ${MAX_SHIPS}; i++) {
        vec4 s = uShips[i];
        if (s.w <= 0.) continue;
        vec4 s2 = uShips2[i];
        vec2 d = p - s.xy;
        float c = cos(s.z), sn = sin(s.z);
        vec2 local = vec2(d.x * c + d.y * sn, -d.x * sn + d.y * c);
        float halfBeam = s2.x;
        float capsule = length(vec2(max(abs(local.x) - (s.w - halfBeam), 0.), local.y)) - halfBeam;
        float outside = max(capsule, 0.);
        foam += exp(-outside * 38.) * smoothstep(-.03, .0, capsule) * (.28 + s2.z * .5);
        // Under way: a turbulent band straight behind the stern, the thin arms of the Kelvin wedge, a bow wave.
        float behind = -local.x - s.w * .85;
        if (s2.y > .01 && behind > 0.) {
            float width = halfBeam * (1.1 + behind * .25);
            vec2 flow = vec2(local.x + uTime * .13, local.y);
            float churn = texture2D(uFoamMap, flow * 1.15).r * .6 + texture2D(uFoamMap, flow * 2.9 + 3.1).r * .5;
            float turbulent = exp(-pow(local.y / width, 2.)) * exp(-behind * .75) * (.45 + churn);
            float arms = exp(-pow((abs(local.y) - behind * .34 - halfBeam * .4) / (.035 + behind * .02), 2.)) * exp(-behind * .95) * .38;
            foam += (turbulent + arms) * s2.y * 1.3;
        }
        if (s2.y > .01) foam += exp(-max(length(local - vec2(s.w * .95, 0.)) - halfBeam * .8, 0.) * 16.) * s2.y * .9;
        foam += s2.w * exp(-outside * 7.) * .9;
    }
    vec2 warp = (texture2D(uFoamMap, p * .23 + uTime * .003).gb - .5) * .9;
    // The swell washing along the barrier and its floats.
    {
        float d = max(abs(p.x) - ${(WALL.baseHalf + .1).toFixed(3)}, max(${WALL.zMin.toFixed(1)} - p.y, p.y - ${WALL.zMax.toFixed(1)}));
        foam += exp(-max(d, 0.) * 18.) * smoothstep(-.03, 0., d) * (.45 + .35 * sin(uTime * 1.4 + p.y * 2.3 + vCrest * 3.));
    }
    // Foam as a lace of bubbles, after the sea reference: a little foam only traces the walls of the bubble net,
    // more thickens the lines and fills its cells, and only churned-up water closes over solid white. Thick foam
    // folds, so the net's walls become blue creases between lit clumps. Too fine for the pixel, it averages out.
    vec2 webUv = p * .85 + warp * .12 + uTime * vec2(.0021, -.0013);
    vec4 webA = texture2D(uFoamWeb, webUv);
    vec4 webB = texture2D(uFoamWeb, webUv * 2.7 + .37);
    float patchy = .7 + .6 * texture2D(uFoamMap, p * .21 + warp * .2).g;
    float amount = 1. - exp(-foam * patchy * 1.7);
    float net = min(webA.b, webB.b + .09);
    // Even where it is thickest it stays a lace with water showing through, closing over only in patches.
    float reach = min(min(amount * .2 - .045, .05) + smoothstep(.42, .84, amount) * .5 + smoothstep(.8, 1.3, foam) * .16, .2 + .24 * texture2D(uFoamMap, p * .9 + warp * .3).r);
    float aa = max(.006, fwidth(net) * .9);
    float lace = (1. - smoothstep(reach - aa, reach + aa, net)) * step(.0005, reach);
    float resolved = 1. - smoothstep(.2, .7, fwidth(webUv.x) * 17.);
    float cover = mix(smoothstep(.12, .95, amount) * .85, lace, resolved) * (1. - slick * .6);
    float thick = smoothstep(0., .14, reach - net);
    vec2 dome = webA.xy * .55 + webB.xy * .45;
    float lit = .62 + .5 * clamp(dot(normalize(vec3(-dome.x * .9, 1., -dome.y * .9)), sunDir), 0., 1.);
    float folds = mix(.55 + .45 * smoothstep(0., .14, webA.b), 1., 1. - thick);
    vec3 foamColor = mix(vec3(.46, .62, .74), vec3(.92, .95, .98), mix(.6, 1., thick) * folds) * (uSkyLight * 1.3 + uSunColor * (diffuse * .45 + .12) * sunlit) * mix(1., lit, resolved);
    // Water full of bubbles glows pale under and around the foam.
    color += vec3(.03, .085, .1) * (uSkyLight + uSunColor * .15) * clamp(amount * amount * .8, 0., .7) * (1. - cover);
    color = mix(color, foamColor, cover);

    // The two target grids, projected onto the water from above like neon light: a thin bright core on the
    // border, a soft halo that catches the wave facets, and faint cell lines. All widths are in world units and
    // antialiased against the pixel footprint, so they stay smooth however far away the camera is.
    float px = max(length(fwidth(p)) * .7, 1e-4);
    float facet = clamp(.55 + dot(N.xz, vec2(.6, .8)) * 4. + vCrest * .25, .25, 1.6);
    for (int g = 0; g < 2; g++) {
        vec2 local = p - uGrids[g].xy;
        vec2 q = abs(local - 5.) - 5.;
        float signedDist = length(max(q, 0.)) + min(max(q.x, q.y), 0.);
        float d = abs(signedDist);
        // Skip only water well outside the board; everything inside it draws (cell lines and markers).
        if (signedDist > 3.) continue;
        bool inside = signedDist < 0.;
        vec3 gridColor = uGridColors[g];
        float distanceFade = 1. - smoothstep(40., 80., dist);
        // Border: core line (a sub-pixel line dims instead of breaking up) and the light spilling around it.
        float coreWidth = .02;
        float w = max(coreWidth, px * .8);
        float core = (1. - smoothstep(w - px * .6, w + px * .6, d)) * min(1., coreWidth / w * 1.4);
        float halo = exp(-d / .045) * .8 + exp(-d / .16) * .1;
        vec3 neon = mix(gridColor, vec3(1.), .14);
        color += (neon * core * 2.6 + gridColor * gridColor * halo * facet * 1.25 * (inside ? 1. : .8)) * uGridOpacity * distanceFade;
        if (inside) {
            // Cell lines: thin, cool white, fading out before they could shimmer.
            vec2 f = fract(local);
            vec2 e = min(f, 1. - f);
            float lineDist = min(e.x, e.y);
            float lw = max(.005, px * .6);
            float line = (1. - smoothstep(lw - px * .5, lw + px * .5, lineDist)) * min(1., .005 / lw * 1.8);
            float lineGlow = exp(-lineDist / .04) * .05 * facet;
            float lineFade = 1. - smoothstep(.12, .3, px);
            color += mix(vec3(.8, .88, 1.), gridColor, .35) * (line * .3 + lineGlow) * lineFade * uGridOpacity * distanceFade;
            ivec2 cell = ivec2(clamp(floor(local), 0., 9.));
            vec4 state = texelFetch(uGridState, ivec2(cell.x + g * 10, cell.y), 0);
            vec2 c = f - .5;
            float r = length(c);
            // Miss: a white ring of light. Hit: a warm red cell. Last shot: the cell's rim pulses.
            color += vec3(.9, .95, 1.) * state.r * exp(-pow((r - .2) / .03, 2.)) * .42 * uGridOpacity;
            float rim = 1. - smoothstep(.0, .1, min(min(f.x, 1. - f.x), min(f.y, 1. - f.y)));
            color = mix(color, color * vec3(1.2, .45, .35) + vec3(.25, .03, .01), state.g * (.3 + rim * .4) * uGridOpacity);
            float pulse = .5 + .5 * sin(uTime * 5.);
            color += gridColor * state.a * rim * (.6 + pulse * .6) * uGridOpacity;
        }
    }

    // Target lock: the cell under fire pulses in the shooter's color.
    if (uTarget.w > 0.) {
        vec2 rel = abs(p - uTarget.xy);
        float box = max(rel.x, rel.y);
        float pulse = .5 + .5 * sin(uTime * 14.);
        float fill = (1. - smoothstep(.44, .5, box)) * (.12 + pulse * .1);
        float edge = exp(-pow((box - .47) / .025, 2.)) * (.9 + pulse * .6);
        color += uTargetColor * (fill + edge) * uTarget.w;
    }

    // Aerial perspective toward the horizon.
    float haze = 1. - exp(-pow(dist * uFogDensity, 1.4));
    color = mix(color, uFogColor, clamp(haze, 0., 1.));

    gl_FragColor = vec4(color, 1.);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}
`;

// A square grid whose spacing grows smoothly away from the middle: ~0.2 units over the battlefield,
// hundreds of units at the edge, with no seams.
function oceanGeometry(segments = 420, inner = 24, outer = 4000) {
    const a = .6;
    const slope = inner / a;
    let low = .01, high = 60;
    for (let i = 0; i < 80; i++) {
        const c = (low + high) / 2;
        const value = inner + slope * (Math.exp(c * (1 - a)) - 1) / c;
        if (value > outer) high = c; else low = c;
    }
    const c = (low + high) / 2;
    const map = (t) => {
        const s = Math.abs(t);
        const v = s <= a ? s * slope : inner + slope * (Math.exp(c * (s - a)) - 1) / c;
        return Math.sign(t) * v;
    };
    const count = segments + 1;
    const positions = new Float32Array(count * count * 3);
    const coords = Array.from({length: count}, (_, i) => map(i / segments * 2 - 1));
    for (let j = 0; j < count; j++) for (let i = 0; i < count; i++) {
        const k = (j * count + i) * 3;
        positions[k] = coords[i];
        positions[k + 2] = coords[j];
    }
    const indices = new Uint32Array(segments * segments * 6);
    let n = 0;
    for (let j = 0; j < segments; j++) for (let i = 0; i < segments; i++) {
        const a0 = j * count + i, b0 = a0 + 1, c0 = a0 + count, d0 = c0 + 1;
        indices.set([a0, c0, b0, b0, c0, d0], n);
        n += 6;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), outer * 1.5);
    return geometry;
}

export class Ocean {
    constructor(renderer, env, {normalMap, foamMap, grids, gridColors}) {
        this.renderer = renderer;
        this.waves = WAVES.map(([x, z, steepness, wavelength]) => {
            const d = new THREE.Vector2(x, z).normalize();
            const k = Math.PI * 2 / wavelength;
            return {dx: d.x, dz: d.y, steepness, k, c: Math.sqrt(GRAVITY / k), a: steepness / k};
        });
        this.reflectionTarget = new THREE.WebGLRenderTarget(512, 512, {type: THREE.HalfFloatType, samples: 0});
        this.reflectionTarget.texture.generateMipmaps = false;
        this.mirrorCamera = new THREE.PerspectiveCamera();
        this.mirrorCamera.layers.set(0);
        this.mirrorCamera.layers.enable(3);   // fire, smoke and spray reflect too
        this.textureMatrix = new THREE.Matrix4();
        this.gridData = new Uint8Array(20 * 10 * 4);
        this.gridState = new THREE.DataTexture(this.gridData, 20, 10, THREE.RGBAFormat);
        this.gridState.needsUpdate = true;
        this.slickIndex = 0;
        const vec4s = (n) => Array.from({length: n}, () => new THREE.Vector4(0, 0, 0, 0));
        this.ripples = new Ripples(renderer);
        this.uniforms = {
            ...this.ripples.uniforms,
            uFoamWeb: {value: bakeFoamWeb(renderer)},
            uTime: {value: 0},
            uWaves: {value: WAVES.map(w => new THREE.Vector4(...w))},
            uNormalMap: {value: normalMap},
            uFoamMap: {value: foamMap},
            uReflection: {value: this.reflectionTarget.texture},
            uGridState: {value: this.gridState},
            uTextureMatrix: {value: this.textureMatrix},
            uSunDir: {value: env.sun},
            uSunColor: {value: env.sunColor},
            uDeep: {value: new THREE.Color(.004, .02, .068)},
            uScatter: {value: new THREE.Color(.0, .11, .22)},
            uSkyLight: {value: new THREE.Color(.45, .55, .7)},
            uFogColor: {value: new THREE.Color(.6, .68, .78)},
            uFogDensity: {value: .0062},
            uGridOpacity: {value: 1},
            uSlicks: {value: vec4s(MAX_SLICKS)},
            uShips: {value: vec4s(MAX_SHIPS)},
            uShips2: {value: vec4s(MAX_SHIPS)},
            uLights: {value: vec4s(MAX_LIGHTS)},
            uLightColors: {value: Array.from({length: MAX_LIGHTS}, () => new THREE.Color())},
            uGrids: {value: grids.map(([x, z]) => new THREE.Vector4(x, z, 0, 0))},
            uGridColors: {value: gridColors.map(c => new THREE.Color(c))},
            uTarget: {value: new THREE.Vector4(0, 0, 0, 0)},
            uTargetColor: {value: new THREE.Color()},
        };
        const material = new THREE.ShaderMaterial({vertexShader, fragmentShader, uniforms: this.uniforms});
        this.mesh = new THREE.Mesh(oceanGeometry(), material);
        this.mesh.frustumCulled = false;
        this.mesh.receiveShadow = false;
        this.mesh.renderOrder = -1;
        this.mesh.onBeforeRender = (r, scene, camera) => this.renderReflection(r, scene, camera);
        this.enabled = true;
        this.tmp = {plane: new THREE.Plane(), clip: new THREE.Vector4(), q: new THREE.Vector4(), view: new THREE.Vector3(), target: new THREE.Vector3(), look: new THREE.Vector3(), cam: new THREE.Vector3(), rotation: new THREE.Matrix4()};
    }

    setSize(width, height) {
        this.reflectionTarget.setSize(Math.max(2, Math.round(width * .7)), Math.max(2, Math.round(height * .7)));
    }

    // Height of the sea surface at (x, z), matching the vertex shader.
    height(x, z, time) {
        const fade = 1 - THREE.MathUtils.smoothstep(Math.hypot(x, z), 70, 260);
        let h = 0;
        for (const w of this.waves) h += w.a * Math.sin(w.k * (w.dx * x + w.dz * z - w.c * time));
        return h * fade;
    }

    // A strike on the water: the ripple field takes the push and the white water.
    addImpact(x, z, strength = 1) {
        this.ripples.splash(x, z, strength);
    }

    addSlick(x, z, radius) {
        const slot = this.uniforms.uSlicks.value[this.slickIndex++ % MAX_SLICKS];
        slot.set(x, z, this.uniforms.uTime.value, radius);
    }

    clearMarks() {
        this.ripples.clear();
        for (const v of this.uniforms.uSlicks.value) v.set(0, 0, 0, 0);
        this.gridData.fill(0);
        this.gridState.needsUpdate = true;
    }

    // Per cell: miss, hit, sunk and "last shot" flags for one grid (0 = GPT's waters, 1 = Claude's).
    setCell(grid, col, row, {miss, hit, sunk, last} = {}) {
        const i = (row * 20 + col + grid * 10) * 4;
        if (miss !== undefined) this.gridData[i] = miss ? 255 : 0;
        if (hit !== undefined) this.gridData[i + 1] = hit ? 255 : 0;
        if (sunk !== undefined) this.gridData[i + 2] = sunk ? 255 : 0;
        if (last !== undefined) this.gridData[i + 3] = last ? 255 : 0;
        this.gridState.needsUpdate = true;
    }

    clearLast() {
        for (let i = 3; i < this.gridData.length; i += 4) this.gridData[i] = 0;
        this.gridState.needsUpdate = true;
    }

    setTarget(x, z, color, strength) {
        this.uniforms.uTarget.value.set(x, z, 0, strength);
        if (color) this.uniforms.uTargetColor.value.set(color);
    }

    setShips(ships) {
        const a = this.uniforms.uShips.value, b = this.uniforms.uShips2.value;
        for (let i = 0; i < MAX_SHIPS; i++) {
            const s = ships[i];
            if (!s) { a[i].set(0, 0, 0, 0); continue; }
            a[i].set(s.x, s.z, s.heading, s.halfLength);
            b[i].set(s.halfBeam, s.speed, s.foam, s.sinking);
        }
        // Hulls are solid to the ripples (a sinking one less and less so).
        this.ripples.setHulls(ships.map(s => ({x: s.x, z: s.z, heading: -s.heading, halfLength: s.halfLength * .96, halfBeam: s.halfBeam * .9, presence: 1 - Math.min(1, s.sinking * 1.4)})));
    }

    setLights(lights) {
        const a = this.uniforms.uLights.value, colors = this.uniforms.uLightColors.value;
        for (let i = 0; i < MAX_LIGHTS; i++) {
            const light = lights[i];
            if (!light || light.intensity <= 0) { a[i].w = 0; continue; }
            a[i].set(light.position.x, light.position.y, light.position.z, light.intensity);
            colors[i].copy(light.color);
        }
    }

    update(time) {
        const dt = this.lastTime === undefined ? 0 : time - this.lastTime;
        this.lastTime = time;
        this.uniforms.uTime.value = time;
        if (dt > 0 && dt < 1) this.ripples.step(dt);
    }

    renderReflection(renderer, scene, camera) {
        if (!this.enabled || camera === this.mirrorCamera) return;
        const {view, target, look, cam, rotation, plane, clip, q} = this.tmp;
        const mirror = this.mirrorCamera;
        const normal = new THREE.Vector3(0, 1, 0);
        cam.setFromMatrixPosition(camera.matrixWorld);
        view.set(cam.x, -cam.y, cam.z);
        rotation.extractRotation(camera.matrixWorld);
        look.set(0, 0, -1).applyMatrix4(rotation).add(cam);
        target.set(look.x, -look.y, look.z);
        mirror.position.copy(view);
        mirror.up.set(0, 1, 0).applyMatrix4(rotation).reflect(normal);
        mirror.lookAt(target);
        mirror.far = camera.far;
        mirror.near = camera.near;
        mirror.updateMatrixWorld();
        mirror.projectionMatrix.copy(camera.projectionMatrix);
        this.textureMatrix.set(.5, 0, 0, .5, 0, .5, 0, .5, 0, 0, .5, .5, 0, 0, 0, 1);
        this.textureMatrix.multiply(mirror.projectionMatrix).multiply(mirror.matrixWorldInverse);
        // Oblique near plane at the water line, so nothing under the sea shows in the reflection.
        plane.setFromNormalAndCoplanarPoint(normal, new THREE.Vector3(0, -.01, 0)).applyMatrix4(mirror.matrixWorldInverse);
        clip.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
        const projection = mirror.projectionMatrix.elements;
        q.x = (Math.sign(clip.x) + projection[8]) / projection[0];
        q.y = (Math.sign(clip.y) + projection[9]) / projection[5];
        q.z = -1;
        q.w = (1 + projection[10]) / projection[14];
        clip.multiplyScalar(2 / clip.dot(q));
        projection[2] = clip.x;
        projection[6] = clip.y;
        projection[10] = clip.z + 1;
        projection[14] = clip.w;
        const previousTarget = renderer.getRenderTarget();
        const autoUpdate = renderer.shadowMap.autoUpdate;
        this.mesh.visible = false;
        renderer.shadowMap.autoUpdate = false;
        renderer.setRenderTarget(this.reflectionTarget);
        renderer.state.buffers.depth.setMask(true);
        if (renderer.autoClear === false) renderer.clear();
        this.beforeReflect?.();
        renderer.render(scene, mirror);
        this.afterReflect?.();
        this.mesh.visible = true;
        renderer.shadowMap.autoUpdate = autoUpdate;
        renderer.setRenderTarget(previousTarget);
        const viewport = camera.viewport;
        if (viewport !== undefined) renderer.state.viewport(viewport);
    }
}
