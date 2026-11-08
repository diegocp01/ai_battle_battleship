import * as THREE from 'three';
import { WALL } from './wall.js';

// Interactive water, after Tessendorf's iWave (the method the sea reference uses for its short waves): a
// height field over the battle area where every splash, blast, landing droplet, piece of falling debris and
// moving hull pushes the water. The push spreads as rings with deep-water dispersion, so long ripples outrun
// short ones; rings interfere and reflect off hulls and the barrier, and soak away at the edges of the area.
// A second field carries the white water those disturbances leave: thrown out by a strike, raised where the
// rings run steep, slowly spreading and fading.

export const RIPPLE_BOUNDS = {minX: -13.5, minZ: -7, sizeX: 27, sizeZ: 14};
const NX = 576, NZ = 300;
const CELL = RIPPLE_BOUNDS.sizeX / NX;
const MAX_SPLATS = 48, MAX_HULLS = 10;
// Gravity in squares per second squared (75 m squares), raised twelvefold: the rings spread about 3.5 times faster
// than real ones would at this scale. At true speed a shell's rings crawl less than a square in six seconds,
// invisible from a camera kilometres away; this is the one deliberate exaggeration in the water.
const G = 9.81 / 75 * 12;

// Fourier-synthesised stencil for |k|, the operator that gives deep-water waves their dispersion. Off-centre
// weights stay negative so no wavelength is amplified, and they sum to zero so calm water stays calm.
function rippleKernel(radius = 4, sigma = .25, samples = 96) {
    const weights = [];
    for (let j = 1; j <= radius; j++) for (let i = 0; i <= j; i++) {
        if (i * i + j * j > radius * radius + 1) continue;
        let g = 0;
        for (let b = 0; b < samples; b++) for (let a = 0; a < samples; a++) {
            const kx = (a + .5) / samples * 2 * Math.PI - Math.PI, ky = (b + .5) / samples * 2 * Math.PI - Math.PI, k = Math.hypot(kx, ky);
            g += k * Math.exp(-sigma * k * k) * Math.cos(kx * i + ky * j);
        }
        g = Math.min(g / (samples * samples), 0);
        const offsets = i === j ? [[i, j], [i, -j], [-i, j], [-i, -j]] : i === 0 ? [[0, j], [0, -j], [j, 0], [-j, 0]] : [[i, j], [i, -j], [-i, j], [-i, -j], [j, i], [j, -i], [-j, i], [-j, -i]];
        weights.push({g, offsets, rim: i * i + j * j > (radius - 1) * (radius - 1)});
    }
    // The |k| stencil falls off as 1/r³: lump the part beyond the radius onto the outer ring so short
    // ripples keep their correct speed.
    const rim = weights.filter(w => w.rim), rimCount = rim.reduce((n, w) => n + w.offsets.length, 0);
    for (const w of rim) w.g -= 1 / radius / rimCount;
    let sum = 0;
    for (const w of weights) sum += w.g * w.offsets.length;
    return {centre: -sum, weights};
}

function kernelGLSL(kernel) {
    const f = (a, b) => `texelFetch(uPrev, clamp(c + ivec2(${a}, ${b}), ivec2(0), hi), 0).r`;
    const lines = [`float s = ${kernel.centre.toFixed(8)} * texelFetch(uPrev, c, 0).r;`];
    for (const {g, offsets} of kernel.weights) lines.push(`s += ${g.toFixed(8)} * (${offsets.map(([a, b]) => f(a, b)).join(' + ')});`);
    return lines.join('\n    ') + '\n    return s;';
}

const VERTEX = /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`;

// Shared: where a texel is in the world, the barrier, and the hulls (soft capsules).
const COMMON = /* glsl */`
uniform vec4 uBounds;
uniform vec4 uHulls[${MAX_HULLS}];    // x, z, heading, half length
uniform vec4 uHulls2[${MAX_HULLS}];   // half beam, presence (0–1), unused, unused
varying vec2 vUv;
vec2 worldAt(vec2 uv) { return uBounds.xy + uv * uBounds.zw; }
float hullMask(vec2 p) {
    float m = 0.;
    for (int i = 0; i < ${MAX_HULLS}; i++) {
        vec4 h = uHulls[i], h2 = uHulls2[i];
        if (h2.y <= 0.) continue;
        vec2 d = p - h.xy;
        float c = cos(h.z), s = sin(h.z);
        vec2 local = vec2(d.x * c + d.y * s, -d.x * s + d.y * c);
        float capsule = length(vec2(max(abs(local.x) - (h.w - h2.x), 0.), local.y)) - h2.x;
        m = max(m, (1. - smoothstep(-${(CELL * .8).toFixed(4)}, ${(CELL * .8).toFixed(4)}, capsule)) * h2.y);
    }
    return m;
}
float wallMask(vec2 p) {
    return (1. - smoothstep(${WALL.baseHalf.toFixed(3)} - ${(CELL * .5).toFixed(4)}, ${WALL.baseHalf.toFixed(3)} + ${(CELL * .5).toFixed(4)}, abs(p.x))) * step(${WALL.zMin.toFixed(1)}, p.y) * step(p.y, ${WALL.zMax.toFixed(1)});
}
`;

// One step of the wave field. R: height now, G: height one step earlier.
const SIM = /* glsl */`
uniform sampler2D uPrev;
uniform vec4 uSplats[${MAX_SPLATS}];  // x, z, radius, height impulse
uniform float uSplatCount, uDt, uDamping;
${COMMON}
float vertical(ivec2 c) {
    ivec2 hi = textureSize(uPrev, 0) - ivec2(1);
    ${kernelGLSL(rippleKernel())}
}
void main() {
    ivec2 c = ivec2(gl_FragCoord.xy);
    vec2 r = texelFetch(uPrev, c, 0).rg;
    vec2 p = worldAt(vUv);
    float a = uDamping * uDt;
    float next = (r.x * (2. - a) - r.y - uDt * uDt * ${G.toFixed(5)} * vertical(c) / ${CELL.toFixed(5)}) / (1. + a);
    // Long, slow swell belongs to the Gerstner waves: this layer relaxes back to a level mean.
    next -= uDt * .25 * r.x;
    for (int i = 0; i < ${MAX_SPLATS}; i++) {
        if (float(i) >= uSplatCount) break;
        vec4 s = uSplats[i];
        vec2 d = (p - s.xy) / s.z;
        next -= s.w * exp(-dot(d, d));
    }
    // Hulls and the barrier are solid: the water beside them reflects, a moving hull pushes it aside.
    float solid = max(hullMask(p), wallMask(p));
    next *= 1. - solid;
    // A soft sponge at the edges of the area lets rings run out instead of bouncing back.
    vec2 edge = min(vUv, 1. - vUv) * uBounds.zw;
    next *= mix(.94, 1., smoothstep(0., 1.6, min(edge.x, edge.y)));
    next = clamp(next, -.2, .2);
    gl_FragColor = vec4(next, r.x * (1. - solid), 0., 1.);
}`;

// White water. R: foam amount (0 to about 1.5).
const FOAM = /* glsl */`
uniform sampler2D uPrevFoam, uWaves;
uniform vec4 uFoams[${MAX_SPLATS}];   // x, z, radius, amount
uniform vec4 uRings[${MAX_SPLATS}];   // ring radius (0 for a blob), ring width, unused, unused
uniform float uFoamCount, uDt;
uniform vec2 uTexel, uDrift;
${COMMON}
float hash(vec2 p) { vec3 q = fract(vec3(p.xyx) * .1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3. - 2. * f);
    return mix(mix(hash(i), hash(i + vec2(1., 0.)), f.x), mix(hash(i + vec2(0., 1.)), hash(i + vec2(1.)), f.x), f.y);
}
void main() {
    vec2 uv = vUv - uDrift * uDt / uBounds.zw;
    float centre = texture2D(uPrevFoam, uv).r;
    float around = (texture2D(uPrevFoam, uv + vec2(uTexel.x, 0.)).r + texture2D(uPrevFoam, uv - vec2(uTexel.x, 0.)).r
                  + texture2D(uPrevFoam, uv + vec2(0., uTexel.y)).r + texture2D(uPrevFoam, uv - vec2(0., uTexel.y)).r) * .25;
    // It spreads a little as it ages.
    float foam = mix(centre, around, min(1., uDt * 1.));
    vec2 p = worldAt(vUv);
    // Where the rings run steep, their crests break into white.
    float hE = texture2D(uWaves, vUv + vec2(uTexel.x, 0.)).r, hW = texture2D(uWaves, vUv - vec2(uTexel.x, 0.)).r;
    float hN = texture2D(uWaves, vUv + vec2(0., uTexel.y)).r, hS = texture2D(uWaves, vUv - vec2(0., uTexel.y)).r;
    float steep = length(vec2(hE - hW, hN - hS)) / (2. * ${CELL.toFixed(5)});
    foam += smoothstep(.3, .75, steep) * uDt * 1.5;
    // White water arrives torn and uneven: its edge wanders and it lands in clots, never as a clean disc.
    float torn = noise(p * 5.3) * .62 + noise(p * 14.7) * .38;
    for (int i = 0; i < ${MAX_SPLATS}; i++) {
        if (float(i) >= uFoamCount) break;
        vec4 f = uFoams[i];
        vec4 ring = uRings[i];
        float d = length(p - f.xy);
        float shape = ring.x > 0. ? exp(-pow((d - ring.x + (torn - .5) * ring.y * 3.) / max(ring.y, .01), 2.)) : exp(-pow(d / (f.z * (.7 + torn * .6)), 2.));
        foam += f.w * shape * (.45 + torn * 1.1);
    }
    // A fresh boil collapses fast (its big bubbles burst); the thin lace it leaves lingers. Nothing survives
    // under a hull or against the barrier.
    foam *= exp(-uDt * mix(.26, .75, smoothstep(.35, 1.2, foam)));
    foam *= 1. - max(hullMask(p), wallMask(p)) * .9;
    gl_FragColor = vec4(clamp(foam, 0., 1.6), 0., 0., 1.);
}`;

export class Ripples {
    constructor(renderer) {
        this.renderer = renderer;
        const linear = renderer.extensions.has('OES_texture_float_linear');
        const type = linear ? THREE.FloatType : THREE.HalfFloatType;
        const target = (w, h) => new THREE.WebGLRenderTarget(w, h, {type, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, stencilBuffer: false, wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping});
        this.waves = [target(NX, NZ), target(NX, NZ)];
        this.foam = [target(NX, NZ), target(NX, NZ)];
        this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        this.scene = new THREE.Scene();
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
        this.quad = new THREE.Mesh(geometry);
        this.quad.frustumCulled = false;
        this.scene.add(this.quad);
        const bounds = new THREE.Vector4(RIPPLE_BOUNDS.minX, RIPPLE_BOUNDS.minZ, RIPPLE_BOUNDS.sizeX, RIPPLE_BOUNDS.sizeZ);
        const hulls = Array.from({length: MAX_HULLS}, () => new THREE.Vector4());
        const hulls2 = Array.from({length: MAX_HULLS}, () => new THREE.Vector4());
        const vec4s = () => Array.from({length: MAX_SPLATS}, () => new THREE.Vector4());
        this.hulls = hulls;
        this.hulls2 = hulls2;
        this.simMaterial = new THREE.ShaderMaterial({
            vertexShader: VERTEX, fragmentShader: SIM, depthTest: false, depthWrite: false,
            uniforms: {uPrev: {value: null}, uSplats: {value: vec4s()}, uSplatCount: {value: 0}, uDt: {value: 1 / 60}, uDamping: {value: .18}, uBounds: {value: bounds}, uHulls: {value: hulls}, uHulls2: {value: hulls2}},
        });
        this.foamMaterial = new THREE.ShaderMaterial({
            vertexShader: VERTEX, fragmentShader: FOAM, depthTest: false, depthWrite: false,
            uniforms: {uPrevFoam: {value: null}, uWaves: {value: null}, uFoams: {value: vec4s()}, uRings: {value: vec4s()}, uFoamCount: {value: 0}, uDt: {value: 1 / 60}, uTexel: {value: new THREE.Vector2(1 / NX, 1 / NZ)}, uDrift: {value: new THREE.Vector2(.012, -.004)}, uBounds: {value: bounds}, uHulls: {value: hulls}, uHulls2: {value: hulls2}},
        });
        this.clearMaterial = new THREE.ShaderMaterial({vertexShader: VERTEX, fragmentShader: 'void main() { gl_FragColor = vec4(0.); }', depthTest: false, depthWrite: false});
        this.splats = [];
        this.foams = [];
        this.scheduled = [];
        this.time = 0;
        // What the ocean shader reads.
        this.uniforms = {
            uRipple: {value: this.waves[0].texture},
            uRippleFoam: {value: this.foam[0].texture},
            uRippleBounds: {value: bounds},
            uRippleTexel: {value: new THREE.Vector2(1 / NX, 1 / NZ)},
        };
        this.clear();
    }

    inside(x, z, margin = 0) {
        const b = RIPPLE_BOUNDS;
        return x > b.minX - margin && x < b.minX + b.sizeX + margin && z > b.minZ - margin && z < b.minZ + b.sizeZ + margin;
    }

    // Push the water down at a point (a crater the rings spread from). Strength is roughly a shell splash = 1.
    push(x, z, strength = 1, radius = .1) {
        if (!this.inside(x, z, radius * 2) || this.splats.length >= MAX_SPLATS) return;
        this.splats.push([x, z, radius, .016 * strength]);
    }

    // Add white water: a blob, or a ring of a given radius and width.
    whiten(x, z, amount, radius = .15, ring = 0, width = .06) {
        if (!this.inside(x, z, radius + ring) || this.foams.length >= MAX_SPLATS) return;
        this.foams.push([x, z, radius, amount, ring, width]);
    }

    // A strike on the water: the crater, the white water thrown out, and the boil that rings outward from it.
    splash(x, z, strength = 1) {
        const s = Math.max(.1, strength);
        this.push(x, z, s, .1 + .09 * Math.sqrt(s));
        this.whiten(x, z, .45 * Math.min(s, 1.6), .1 + .1 * Math.sqrt(s));
        for (const [delay, radius, amount] of [[.18, .16, .2], [.45, .3, .14], [.9, .48, .09], [1.6, .7, .05]]) {
            this.scheduled.push({at: this.time + delay, x, z, radius: radius * Math.sqrt(s), amount: amount * Math.min(s, 1.5)});
        }
    }

    // Each frame: where the hulls are (soft solid capsules that the water reflects off and a moving hull pushes).
    setHulls(list) {
        for (let i = 0; i < MAX_HULLS; i++) {
            const h = list[i];
            if (!h) {
                this.hulls2[i].y = 0;
                continue;
            }
            this.hulls[i].set(h.x, h.z, h.heading, h.halfLength);
            this.hulls2[i].set(h.halfBeam, h.presence ?? 1, 0, 0);
        }
    }

    pass(material, target) {
        this.quad.material = material;
        this.renderer.setRenderTarget(target);
        this.renderer.render(this.scene, this.camera);
    }

    clear() {
        for (const t of [...this.waves, ...this.foam]) this.pass(this.clearMaterial, t);
        this.renderer.setRenderTarget(null);
        this.splats = [];
        this.foams = [];
        this.scheduled = [];
    }

    step(dt) {
        if (dt <= 0) return;
        this.time += dt;
        const due = this.scheduled.filter(item => item.at <= this.time);
        if (due.length) {
            this.scheduled = this.scheduled.filter(item => item.at > this.time);
            for (const item of due) this.whiten(item.x, item.z, item.amount, .05, item.radius, .05 + item.radius * .12);
        }
        const previous = this.renderer.getRenderTarget();
        // Fixed substeps keep the waves the same at any frame rate or battle speed.
        const steps = Math.min(4, Math.max(1, Math.round(dt / (1 / 60))));
        const h = dt / steps;
        const sim = this.simMaterial.uniforms;
        for (let i = 0; i < steps; i++) {
            const splats = i === 0 ? this.splats : [];
            splats.forEach((s, k) => sim.uSplats.value[k].set(s[0], s[1], s[2], s[3]));
            sim.uSplatCount.value = splats.length;
            sim.uDt.value = h;
            sim.uPrev.value = this.waves[0].texture;
            this.pass(this.simMaterial, this.waves[1]);
            this.waves.reverse();
        }
        const foam = this.foamMaterial.uniforms;
        this.foams.forEach((f, k) => {
            foam.uFoams.value[k].set(f[0], f[1], f[2], f[3]);
            foam.uRings.value[k].set(f[4], f[5], 0, 0);
        });
        foam.uFoamCount.value = this.foams.length;
        foam.uDt.value = dt;
        foam.uPrevFoam.value = this.foam[0].texture;
        foam.uWaves.value = this.waves[0].texture;
        this.pass(this.foamMaterial, this.foam[1]);
        this.foam.reverse();
        this.renderer.setRenderTarget(previous);
        this.splats = [];
        this.foams = [];
        this.uniforms.uRipple.value = this.waves[0].texture;
        this.uniforms.uRippleFoam.value = this.foam[0].texture;
    }
}

// The bubble net foam gathers into (from the sea reference): bubbles collect along the walls of cells, which is
// what turns real foam into lace. RG: direction up the distance field, B: distance to the nearest wall,
// A: fine bubble speckle. Baked once, tiling.
const FOAM_WEB = /* glsl */`
varying vec2 vUv;
vec2 hash2(vec2 p) { vec3 q = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); q += dot(q, q.yzx + 33.33); return fract((q.xx + q.yz) * q.zy); }
vec2 cells(vec2 uv, float n) {
    vec2 p = uv * n, i = floor(p), f = p - i;
    float a = 9., b = 9.;
    for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
        vec2 o = vec2(x, y), c = o + hash2(mod(i + o, n) + n) - f;
        float d = dot(c, c);
        if (d < a) { b = a; a = d; } else if (d < b) b = d;
    }
    return sqrt(vec2(a, b));
}
const float TAU = 6.2831853;
float field(vec2 uv) {
    vec2 warp = .018 * vec2(sin(TAU * (3. * uv.y + 2. * uv.x)) + .5 * sin(TAU * (7. * uv.x - 4. * uv.y)), sin(TAU * (3. * uv.x - uv.y)) + .5 * sin(TAU * (5. * uv.y + 6. * uv.x)));
    vec2 a = cells(uv + warp, 17.), b = cells(uv + warp * .6, 47.);
    return min(a.y - a.x, (b.y - b.x) + .09);
}
void main() {
    float e = 1. / 1024., c = field(vUv);
    vec2 g = vec2(field(vUv + vec2(e, 0.)) - field(vUv - vec2(e, 0.)), field(vUv + vec2(0., e)) - field(vUv - vec2(0., e))) / (2. * e);
    vec2 s = cells(vUv, 160.);
    gl_FragColor = vec4(g / (length(g) + 1.), c, s.y - s.x);
}`;

export function bakeFoamWeb(renderer) {
    const target = new THREE.WebGLRenderTarget(1024, 1024, {type: THREE.HalfFloatType, format: THREE.RGBAFormat, wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: true, depthBuffer: false, anisotropy: Math.min(8, renderer.capabilities.getMaxAnisotropy())});
    const scene = new THREE.Scene();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
    const material = new THREE.ShaderMaterial({vertexShader: VERTEX, fragmentShader: FOAM_WEB, depthTest: false, depthWrite: false});
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    scene.add(mesh);
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    renderer.render(scene, new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1));
    renderer.setRenderTarget(previous);
    geometry.dispose();
    material.dispose();
    return target.texture;
}
