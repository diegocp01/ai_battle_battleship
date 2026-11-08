import * as THREE from 'three';
import { rampTexture } from './textures.js';
import { NO_REFLECTION_LAYER } from './ocean.js';
import { DEPTH_GLSL } from './postfx.js';
import { shipImpactProfile, integrateDrag, DEBRIS_GRAVITY } from './impact-physics.js';

// Fire, smoke, spray and sparks. One instanced billboard system draws every particle in a single pass with
// premultiplied alpha, so additive flames and lit, alpha-blended smoke mix correctly once sorted back to
// front. Each particle reads its color, opacity, size, additivity and glow over its life from a ramp
// texture; smoke is shaded like a sphere against the sun, and fire is bright enough to bloom.

// Ramp stops: [t, r, g, b, alpha, additive, size multiplier (0–2), emissive (0–10), fade at the waterline]
const RAMP_DEFS = {
    FIRE: [[0, 1, .86, .55, 1, 1, .55, 4.2, 0], [.12, 1, .58, .2, 1, 1, .85, 3.4, 0], [.35, 1, .36, .08, .85, .9, 1.05, 2.2, 0], [.6, .55, .17, .05, .6, .5, 1.2, .8, 0], [1, .12, .08, .06, 0, 0, 1.35, 0, 0]],
    SMOKE_DARK: [[0, .1, .09, .085, 0, 0, .5, 0, 1], [.06, .11, .1, .095, .62, 0, .65, 0, 1], [.5, .15, .14, .14, .44, 0, 1.3, 0, 1], [1, .26, .26, .27, 0, 0, 2.1, 0, 1]],
    SMOKE_FIRE: [[0, 1, .5, .18, .9, .7, .5, 2.4, 1], [.1, .55, .26, .12, .85, .25, .7, 1.2, 1], [.25, .14, .12, .11, .75, 0, .95, 0, 1], [.7, .2, .19, .19, .4, 0, 1.6, 0, 1], [1, .3, .3, .31, 0, 0, 2, 0, 1]],
    STEAM: [[0, .85, .86, .88, 0, 0, .4, 0, 1], [.08, .86, .87, .9, .55, 0, .6, 0, 1], [.6, .82, .83, .86, .3, 0, 1.4, 0, 1], [1, .8, .81, .84, 0, 0, 2, 0, 1]],
    SPRAY: [[0, .9, .94, .97, .95, 0, .5, 0, 0], [.15, .92, .95, .98, .9, 0, .9, 0, 0], [.7, .85, .9, .94, .5, 0, 1.4, 0, 0], [1, .8, .86, .9, 0, 0, 1.7, 0, 0]],
    MIST: [[0, .88, .9, .93, 0, 0, .5, 0, 0], [.1, .9, .92, .95, .45, 0, .7, 0, 0], [1, .86, .88, .92, 0, 0, 2, 0, 0]],
    SPARK: [[0, 1, .95, .8, 1, 1, 1, 9, 0], [.4, 1, .65, .25, .9, 1, .9, 6, 0], [1, 1, .3, .05, 0, 1, .6, 2, 0]],
    FLASH: [[0, 1, .96, .9, 1, 1, .6, 10, 0], [.25, 1, .8, .55, .8, 1, 1, 8, 0], [1, 1, .45, .15, 0, 1, 1.3, 2, 0]],
    MUZZLE: [[0, 1, .9, .65, 1, 1, .6, 9, 0], [.4, 1, .55, .2, .7, 1, 1.1, 5, 0], [1, .8, .25, .08, 0, 1, 1.3, 1, 0]],
    EXHAUST: [[0, 1, .95, .8, 1, 1, 1, 8, 0], [.5, 1, .6, .25, .6, 1, .7, 4, 0], [1, .9, .3, .1, 0, 1, .4, 1, 0]],
    TRAIL: [[0, .9, .9, .9, 0, 0, .85, 0, 1], [.04, .92, .92, .92, .45, 0, .95, 0, 1], [.5, .86, .86, .87, .26, 0, 1.5, 0, 1], [1, .8, .8, .82, 0, 0, 2.3, 0, 1]],
    TRACER: [[0, 1, .85, .55, 1, 1, 1, 10, 0], [1, 1, .5, .2, 0, 1, .5, 6, 0]],
    WAKE: [[0, .92, .95, .97, 0, 0, .5, 0, 0], [.1, .94, .96, .98, .75, 0, .7, 0, 0], [1, .9, .93, .95, 0, 0, 1.6, 0, 0]],
    EMBER: [[0, 1, .8, .4, 1, 1, 1, 9, 0], [.6, 1, .45, .1, .8, 1, .8, 5, 0], [1, .6, .15, .05, 0, 1, .4, 1, 0]],
    GUNSMOKE: [[0, .62, .6, .58, 0, 0, .35, 0, 1], [.05, .6, .58, .56, .7, 0, .5, 0, 1], [.5, .55, .54, .53, .4, 0, 1.3, 0, 1], [1, .6, .6, .6, 0, 0, 2, 0, 1]],
    LAUNCH_SMOKE: [[0, 1, .74, .46, .9, .45, .45, 1.5, 1], [.05, .98, .86, .7, .93, .12, .62, .45, 1], [.16, .9, .88, .84, .92, 0, .9, 0, 1], [.6, .82, .82, .81, .6, 0, 1.6, 0, 1], [1, .8, .8, .8, 0, 0, 2, 0, 1]],
    CORDITE: [[0, 1, .66, .36, .9, .5, .45, 2.2, 1], [.06, .62, .5, .36, .85, .1, .65, .3, 1], [.3, .55, .47, .38, .7, 0, 1.1, 0, 1], [1, .6, .56, .5, 0, 0, 2, 0, 1]],
    FW_GOLD: [[0, 1, .95, .7, 1, 1, 1, 9, 0], [.5, 1, .75, .3, .9, 1, .9, 7, 0], [1, 1, .45, .1, 0, 1, .5, 2, 0]],
    FW_BLUE: [[0, .85, .92, 1, 1, 1, 1, 9, 0], [.4, .35, .6, 1, .9, 1, .9, 7, 0], [1, .2, .35, 1, 0, 1, .5, 2, 0]],
    FW_ORANGE: [[0, 1, .9, .75, 1, 1, 1, 9, 0], [.4, 1, .55, .35, .9, 1, .9, 7, 0], [1, .95, .35, .2, 0, 1, .5, 2, 0]],
    FW_WHITE: [[0, 1, 1, 1, 1, 1, 1, 10, 0], [.5, .95, .95, 1, .8, 1, .8, 6, 0], [1, .8, .85, 1, 0, 1, .5, 2, 0]],
    FW_RED: [[0, 1, .85, .8, 1, 1, 1, 9, 0], [.4, 1, .25, .2, .9, 1, .9, 7, 0], [1, .8, .1, .08, 0, 1, .5, 2, 0]],
    FW_GREEN: [[0, .85, 1, .85, 1, 1, 1, 9, 0], [.4, .3, 1, .45, .9, 1, .9, 7, 0], [1, .1, .7, .25, 0, 1, .5, 2, 0]],
    // A fire's plume: oily smoke, near-black where it leaves the flames, turning a heavy brown-grey as it billows
    // up and spreads (sunlit on top, dark underneath, from the shading), and slowly thinning downwind.
    PLUME: [[0, .09, .075, .065, 0, 0, .55, 0, 1], [.05, .1, .085, .075, .82, 0, .7, 0, 1], [.3, .2, .18, .16, .74, 0, 1.25, 0, 1], [.7, .33, .32, .31, .45, 0, 1.8, 0, 1], [1, .42, .42, .42, 0, 0, 2.2, 0, 1]],
    // A tongue of flame: bright yellow-orange at the root, narrowing and reddening toward the tip, where it
    // breaks off and vanishes rather than swelling into a puff.
    TONGUE: [[0, 1, .62, .2, 1, 1, .7, 3, 0], [.2, 1, .45, .1, 1, 1, .8, 2.4, 0], [.5, .92, .28, .05, .8, 1, .65, 1.4, 0], [.78, .55, .12, .03, .35, .85, .45, .45, 0], [1, .22, .06, .02, 0, .6, .3, 0, 0]],
    // Ship fires: orange flames with darker red tips rather than a white-hot core.
    BLAZE: [[0, 1, .78, .42, 1, 1, .5, 2.7, 0], [.15, 1, .52, .16, 1, 1, .8, 2.2, 0], [.4, .95, .32, .07, .85, .85, 1, 1.3, 0], [.65, .5, .14, .04, .55, .45, 1.15, .45, 0], [1, .1, .07, .05, 0, 0, 1.3, 0, 0]],
};
export const RAMP = Object.fromEntries(Object.keys(RAMP_DEFS).map((name, index) => [name, index]));
export const FRAME = {SMOKE: [0, 1, 2, 3], FLAME: [4, 5], GLOW: 6, SPARK: 7, SPRAY: 8, COLUMN: 9, RING: 10, FLARE: 11, WISP: [12, 13], EMBER: 14, BUBBLE: 15};

const CAPACITY = 12000;
// A fresh breeze, about 13 m/s at the surface (squares are 75 m), stronger aloft (see the shear in simulate).
const WIND = new THREE.Vector3(.17, 0, -.055);
const CURL = {x: 0, y: 0, z: 0};

// Turbulent eddies: the curl of drifting sine potentials, two octaves. A curl field has no divergence, so smoke
// carried by it billows and curls without bunching up or thinning out, and neighbouring puffs move together.
function curl(x, y, z, t, out) {
    let cx = 0, cy = 0, cz = 0;
    for (let o = 0, f = 3.2, a = 1; o < 2; o++, f *= 2.6, a *= .45) {
        const X = x * f, Y = y * f, Z = z * f, T = t * (.35 + o * .25);
        const dzy = Math.cos(Y * 1.27 + T * 1.4 + 1.3) * 1.27, dyz = Math.cos(Z * .93 + T * 1.1 + 4.1) * .93;
        const dxz = Math.cos(Z * 1.11 - T * 1.3 + 2.2) * 1.11, dzx = Math.cos(X * 1.05 - T * .8 + .7) * 1.05;
        const dyx = Math.cos(X * 1.33 + T * .7 + 5.3) * 1.33, dxy = Math.cos(Y * .87 + T * .9 + 3.6) * .87;
        cx += (dzy - dyz) * a; cy += (dxz - dzx) * a; cz += (dyx - dxy) * a;
    }
    out.x = cx; out.y = cy; out.z = cz;
}

const vertexShader = /* glsl */`
attribute vec3 iPos;
attribute vec4 iA;   // size, rotation, life (0–1), ramp
attribute vec4 iB;   // frame, alpha, intensity, stretch
attribute vec3 iVel;
uniform sampler2D uRamp;
uniform float uRampRows;
varying vec2 vUv;
varying vec3 vRight;
varying vec3 vUp;
varying vec3 vForward;
varying float vViewZ;
varying float vSize;
varying vec4 vColor;
varying vec4 vParams;
varying vec3 vWorld;
varying float vFrame;
varying float vAlpha;
varying float vIntensity;
void main() {
    float row = iA.w * 2.;
    vec4 color = texture2D(uRamp, vec2(iA.z, (row + .5) / uRampRows));
    vec4 params = texture2D(uRamp, vec2(iA.z, (row + 1.5) / uRampRows));
    float size = iA.x * params.y * 2.;
    vec2 corner = position.xy;
    // The camera drawing this pass (main view, mirror, or the sun's shadow camera) from its view matrix.
    vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    vec3 camForward = -vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
    vec3 offset;
    if (iB.w > 0.) {
        float speed = length(iVel);
        vec3 dir = speed > 1e-4 ? iVel / speed : camUp;
        vec3 along = dir - dot(dir, camForward) * camForward;
        float l = length(along);
        along = l > 1e-4 ? along / l : camUp;
        vec3 side = normalize(cross(along, camForward));
        offset = along * corner.y * (size + speed * iB.w) + side * corner.x * size;
    } else {
        float c = cos(iA.y), s = sin(iA.y);
        vec2 r = vec2(corner.x * c - corner.y * s, corner.x * s + corner.y * c) * size;
        offset = camRight * r.x + camUp * r.y;
    }
    vWorld = iPos + offset;
    vec4 view = viewMatrix * vec4(vWorld, 1.);
    gl_Position = projectionMatrix * view;
    vViewZ = view.z;
    vSize = size;
    vRight = camRight;
    vUp = camUp;
    vForward = camForward;
    vUv = uv;
    vColor = color;
    vParams = params;
    vFrame = iB.x;
    vAlpha = iB.y;
    vIntensity = iB.z;
}
`;

const fragmentShader = /* glsl */`
uniform sampler2D uAtlas;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uAmbient;
uniform vec4 uFires[4];
uniform sampler2D uDepth;
uniform vec2 uScreen;
uniform float uSoft, uNear, uFar;
varying vec3 vRight;
varying vec3 vUp;
varying vec3 vForward;
varying float vViewZ;
varying float vSize;
${DEPTH_GLSL}
uniform vec3 uFireColor;
varying vec2 vUv;
varying vec4 vColor;
varying vec4 vParams;
varying vec3 vWorld;
varying float vFrame;
varying float vAlpha;
varying float vIntensity;
void main() {
    vec2 cell = vec2(mod(vFrame, 4.), floor(vFrame / 4.));
    vec4 tex = texture2D(uAtlas, (cell + vUv) / 4.);
    float additive = vParams.x;
    float alpha = tex.a * vColor.a * vAlpha;
    if (vParams.w > .5) alpha *= smoothstep(-.01, .1, vWorld.y);
    // Soft particles: fade out as the billboard nears the surface behind it, instead of cutting a hard line
    // where smoke meets the sea, a deck or the wall. Flames add light, so a sharp edge there doesn't show:
    // they fade over a much shorter distance and stay bright right down on the deck where they burn.
    if (uSoft > .5) {
        float sceneZ = -viewZFromDepth(texture2D(uDepth, gl_FragCoord.xy / uScreen).x, uNear, uFar);
        alpha *= clamp((sceneZ + vViewZ) / (.01 + vSize * mix(.45, .1, additive)), 0., 1.);
    }
    // Near the lens a billboard would fill the frame as a flat card: fade it out as the camera reaches it.
    alpha *= clamp((-vViewZ - .04) / (vSize * 1.4 + .06), 0., 1.);
    if (alpha < .002) discard;
    vec2 q = vUv * 2. - 1.;
    vec3 n = normalize(vRight * q.x + vUp * q.y - vForward * sqrt(max(.05, 1. - dot(q, q))));
    float wrap = pow(clamp(dot(n, uSunDir) * .5 + .5, 0., 1.), 1.5);
    vec3 lit = vColor.rgb * (uAmbient + uSunColor * wrap) * mix(.38, 1.18, tex.r);
    // Fires and blasts light the smoke around them from inside and below: the orange underside of a plume.
    float fireLight = 0.;
    for (int i = 0; i < 4; i++) {
        vec4 f = uFires[i];
        if (f.w <= 0.) continue;
        vec3 d = f.xyz - vWorld;
        float d2 = dot(d, d);
        fireLight += f.w / (1. + d2 * 16.) * (.55 + .45 * clamp(dot(d * inversesqrt(d2 + 1e-4), n) * .5 + .5, 0., 1.));
    }
    lit += vColor.rgb * uFireColor * fireLight * mix(.45, 1.1, tex.r) * (1. - additive);
    vec3 glow = vColor.rgb * vParams.z * 10. * vIntensity * mix(.75, 1.25, tex.r);
    vec3 color = lit * (1. - additive) + glow;
    gl_FragColor = vec4(color * alpha, alpha * (1. - additive));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}
`;

// Smoke in the sun's shadow map: the dense parts of lit (not additive) particles.
const shadowFragment = /* glsl */`
uniform sampler2D uAtlas;
varying vec2 vUv;
varying vec4 vColor;
varying vec4 vParams;
varying float vFrame;
varying float vAlpha;
void main() {
    vec2 cell = vec2(mod(vFrame, 4.), floor(vFrame / 4.));
    float a = texture2D(uAtlas, (cell + vUv) / 4.).a * vColor.a * vAlpha * (1. - vParams.x);
    if (a < .34) discard;
    gl_FragColor = vec4(1.);
}`;

export class Effects {
    constructor(scene, {atlas, ocean, env, onShake, onSound}) {
        this.scene = scene;
        this.ocean = ocean;
        this.onShake = onShake || (() => {});
        this.onSound = onSound || (() => {});
        this.time = 0;
        const n = CAPACITY;
        const f = (k) => new Float32Array(n * k);
        this.p = {pos: f(3), vel: f(3), age: f(1), life: f(1), size: f(1), rot: f(1), spin: f(1), ramp: f(1), frame: f(1), drag: f(1), lift: f(1), intensity: f(1), stretch: f(1), alpha: f(1), wind: f(1), swirl: f(1), seed: f(1), collide: f(1), terminal: f(1), cool: f(1), turb: f(1)};
        this.pendingSpawns = [];
        this.count = 0;
        const geometry = new THREE.InstancedBufferGeometry();
        const quad = new THREE.PlaneGeometry(1, 1);
        geometry.index = quad.index;
        geometry.setAttribute('position', quad.attributes.position);
        geometry.setAttribute('uv', quad.attributes.uv);
        this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage);
        this.aA = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4).setUsage(THREE.DynamicDrawUsage);
        this.aB = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4).setUsage(THREE.DynamicDrawUsage);
        this.aVel = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage);
        geometry.setAttribute('iPos', this.aPos);
        geometry.setAttribute('iA', this.aA);
        geometry.setAttribute('iB', this.aB);
        geometry.setAttribute('iVel', this.aVel);
        geometry.instanceCount = 0;
        const ramps = Object.values(RAMP_DEFS);
        this.uniforms = {
            uAtlas: {value: atlas},
            uRamp: {value: rampTexture(ramps)},
            uRampRows: {value: ramps.length * 2},
            uSunDir: {value: env.sun},
            uSunColor: {value: env.particleSun},
            uAmbient: {value: new THREE.Color(.3, .35, .44)},
            uDepth: {value: null},
            uScreen: {value: new THREE.Vector2(1, 1)},
            uSoft: {value: 1},
            uNear: {value: .1},
            uFar: {value: 9000},
            uFires: {value: Array.from({length: 4}, () => new THREE.Vector4(0, 0, 0, 0))},
            uFireColor: {value: new THREE.Color(1, .46, .16)},
        };
        const material = new THREE.ShaderMaterial({
            vertexShader, fragmentShader, uniforms: this.uniforms, transparent: true, depthWrite: false,
            blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
            blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
        });
        this.mesh = new THREE.Mesh(geometry, material);
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = 10;
        scene.add(this.mesh);
        // A shadow-only twin on the solid layer: invisible in the view, it draws the smoke into the sun's shadow
        // map so plumes darken the decks and the wall beneath them.
        this.shadowCaster = new THREE.Mesh(geometry, new THREE.ShaderMaterial({vertexShader: 'void main() { gl_Position = vec4(2., 2., 2., 1.); }', fragmentShader: 'void main() { discard; }'}));
        this.shadowCaster.customDepthMaterial = new THREE.ShaderMaterial({vertexShader, fragmentShader: shadowFragment, uniforms: this.uniforms});
        this.shadowCaster.castShadow = true;
        this.shadowCaster.frustumCulled = false;
        scene.add(this.shadowCaster);
        this.order = new Uint32Array(n);
        this.depth = new Float32Array(n);
        this.fires = [];
        this.flashes = [];
        this.emitters = [];
        this.pending = [];
        this.blasts = [];
        this.heatSources = [];
        this.lights = Array.from({length: 6}, () => {
            const light = new THREE.PointLight(0xffaa66, 0, 0, 2);
            light.castShadow = false;
            scene.add(light);
            return light;
        });
        this.debris = new Debris(scene, this);
        this.rings = new Shockwaves(scene);
        this.flotsam = new Flotsam(scene, ocean);
        this.tmp = new THREE.Vector3();
    }

    // Add one particle. Velocity in units/s; negative 'delay' holds it back.
    spawn(o) {
        if (this.count >= CAPACITY) return -1;
        const i = this.count++;
        const p = this.p;
        p.pos.set([o.x, o.y, o.z], i * 3);
        p.vel.set([o.vx || 0, o.vy || 0, o.vz || 0], i * 3);
        p.age[i] = -(o.delay || 0);
        p.life[i] = o.life || 1;
        p.size[i] = o.size || .1;
        p.rot[i] = o.rot ?? Math.random() * Math.PI * 2;
        p.spin[i] = o.spin ?? (Math.random() - .5) * 1.2;
        p.ramp[i] = o.ramp;
        p.frame[i] = Array.isArray(o.frame) ? o.frame[Math.floor(Math.random() * o.frame.length)] : o.frame ?? 0;
        p.drag[i] = o.drag ?? 1;
        p.lift[i] = o.lift ?? 0;
        p.intensity[i] = o.intensity ?? 1;
        p.stretch[i] = o.stretch ?? 0;
        p.alpha[i] = o.alpha ?? 1;
        p.wind[i] = o.wind ?? 0;
        p.swirl[i] = o.swirl ?? 0;
        p.seed[i] = Math.random() * 100;
        p.collide[i] = o.collide === true ? 1 : (o.collide || 0);
        p.terminal[i] = o.terminal ?? 0;
        p.cool[i] = o.cool ?? 0;
        p.turb[i] = o.turb ?? 0;
        return i;
    }

    kill(i) {
        const last = --this.count;
        if (i === last) return;
        const p = this.p;
        for (const key in p) {
            const array = p[key];
            const k = array.length / CAPACITY;
            for (let c = 0; c < k; c++) array[i * k + c] = array[last * k + c];
        }
    }

    // ---------------------------------------------------------------------------------------------------
    // Recipes
    // ---------------------------------------------------------------------------------------------------

    // Something new catches (a fuel line, a locker of paint, ready ammunition): flames leap up for a moment and a
    // gout of black smoke follows them.
    flareUp(fire, at) {
        const r = Math.random;
        fire.flare = 1;
        for (let i = 0; i < 18; i++) {
            const dir = randomDir(.7), speed = .5 + r() * .8;
            this.spawn({x: at.x + (r() - .5) * .06, y: at.y + .02, z: at.z + (r() - .5) * .06, vx: dir.x * speed * .35, vy: dir.y * speed, vz: dir.z * speed * .35, ramp: RAMP.TONGUE, frame: FRAME.FLAME, size: (.14 + r() * .12) * fire.scale, life: .45 + r() * .35, drag: 2, lift: 1.6, cool: .3, wind: .4, turb: .9, stretch: .3, intensity: .8});
        }
        for (let i = 0; i < 8; i++) {
            this.spawn({x: at.x + (r() - .5) * .08, y: at.y + .12 + r() * .08, z: at.z + (r() - .5) * .08, vx: (r() - .5) * .1, vy: .35 + r() * .2, vz: (r() - .5) * .1, ramp: RAMP.SMOKE_DARK, frame: FRAME.SMOKE, size: (.12 + r() * .08) * fire.scale, life: 8 + r() * 5, drag: .8, lift: .35, cool: 4, wind: 1, turb: .35, delay: .15 + r() * .2});
        }
        for (let i = 0; i < 12; i++) {
            const dir = randomDir(.3), speed = 1 + r() * 1.8;
            this.spawn({x: at.x, y: at.y + .03, z: at.z, vx: dir.x * speed, vy: dir.y * speed + .6, vz: dir.z * speed, ramp: RAMP.SPARK, frame: FRAME.SPARK, size: .012, life: .4 + r() * .5, drag: .9, lift: -4, stretch: .035, collide: true});
        }
    }

    // A falling droplet strikes the water: it presses a small ring into the ripple field and leaves a fleck of
    // white, and a hard landing throws a smaller droplet back up out of its crown (once, as in the sea reference).
    land(i, vy) {
        const p = this.p, k = i * 3;
        if (p.ramp[i] !== RAMP.SPRAY) return;
        const ripples = this.ocean.ripples;
        const x = p.pos[k], z = p.pos[k + 2], size = p.size[i], fall = Math.min(1, -vy / 3);
        // In proportion to the droplet's mass: a whole column falling back adds up to about the shell's own crater.
        ripples?.push(x, z, Math.min(.04, size * .1) * fall, .045 + size * .22);
        if (size > .12 && Math.random() < .35) ripples?.whiten(x, z, .02 + size * .2, .04 + size * .22);
        if (p.collide[i] < 1.5 && vy < -1.3 && size > .035 && Math.random() < .55) {
            const a = Math.random() * Math.PI * 2, kick = -vy * (.08 + Math.random() * .12);
            this.pendingSpawns.push({x, y: .01, z, vx: Math.cos(a) * kick, vy: -vy * (.22 + Math.random() * .2), vz: Math.sin(a) * kick, ramp: RAMP.SPRAY, frame: FRAME.SPRAY, size: Math.min(.05, size * .45), life: .35 + Math.random() * .3, drag: .3, lift: -5, collide: 2, terminal: 1.4 + size * 6, stretch: .012});
        }
    }

    // One jet's afterburners: two white-blue cores, long orange flames with shock diamonds standing in them,
    // riding with the jet. at: between the nozzles; back: the way the exhaust leaves; power 0..1.
    afterburner(at, back, velocity, power, scale = 1.1, dt = 1 / 60) {
        const r = Math.random;
        const across = new THREE.Vector3().crossVectors(back, new THREE.Vector3(0, 1, 0));
        if (across.lengthSq() < 1e-6) across.set(0, 0, 1);
        across.normalize();
        const life = Math.min(.034, dt * 1.05);
        const ride = {vx: velocity.x, vy: velocity.y, vz: velocity.z, drag: 0};
        for (const s of [1, -1]) {
            const n = at.clone().addScaledVector(across, s * .0085 * scale);
            const flicker = .85 + r() * .3;
            this.spawn({x: n.x, y: n.y, z: n.z, ...ride, ramp: RAMP.EXHAUST, frame: FRAME.GLOW, size: .042 * scale * power * flicker, life, intensity: 1.5});
            for (let d = 1; d <= 4; d++) {
                const q = n.clone().addScaledVector(back, d * .016 * scale * (.6 + power * .6));
                this.spawn({x: q.x, y: q.y, z: q.z, ...ride, ramp: RAMP.EXHAUST, frame: FRAME.GLOW, size: (.016 - d * .0022) * scale * flicker, life, intensity: (1.5 - d * .25) * power});
            }
            this.spawn({x: n.x, y: n.y, z: n.z, vx: velocity.x + back.x * 4 * power, vy: velocity.y + back.y * 4 * power, vz: velocity.z + back.z * 4 * power, ramp: RAMP.EXHAUST, frame: FRAME.FLAME, size: .022 * scale, life: .05, drag: 0, stretch: .025, intensity: power});
        }
    }

    // A bow driving into the swell: sheets of spray thrown up and out to both sides of the stem, and a little
    // mist blown back. forward: the ship's heading on the water; scale: how hard she hit the wave.
    bowSpray(at, forward, scale = 1) {
        const r = Math.random;
        const side = new THREE.Vector3(-forward.z, 0, forward.x);
        for (let i = 0; i < 9 * scale; i++) {
            const s = r() < .5 ? -1 : 1;
            const out = .35 + r() * .5, up = .7 + r() * .8, ahead = .1 + r() * .3;
            const size = .012 + r() * .022;
            this.spawn({x: at.x + side.x * s * .01, y: at.y, z: at.z + side.z * s * .01,
                vx: (side.x * s * out + forward.x * ahead) * scale, vy: up * Math.sqrt(scale), vz: (side.z * s * out + forward.z * ahead) * scale,
                ramp: RAMP.SPRAY, frame: FRAME.SPRAY, size, life: .7 + r() * .4, drag: .4, lift: -5, collide: true, terminal: 1.2 + size * 14, stretch: .012});
        }
        if (r() < .6) this.spawn({x: at.x, y: at.y + .03, z: at.z, vx: (r() - .5) * .15, vy: .12, vz: (r() - .5) * .15, ramp: RAMP.MIST, frame: FRAME.SMOKE, size: .06 + r() * .05, life: 1.2 + r() * .6, drag: 1.4, wind: .9, alpha: .6});
    }

    // Run something a little later, on the effects clock (so it pauses and speeds up with the battle).
    later(seconds, fn) {
        this.pending.push({at: this.time + seconds, fn});
    }

    // A hit on a ship, in the order it happens:
    //  - contact: sparks off the plating (before the burst, even for a delayed fuze);
    //  - the detonation: a white-hot flash lasting hundredths of a second;
    //  - the fireball: not one ball but an irregular cluster of hot lobes, thrown up and downrange by the
    //    round's momentum, that draw out taller as they rise; fuel-rich hits (missile propellant, a jet's
    //    tanks) roll up a second, slower fireball of burning fuel;
    //  - flame jets: hot gas bursting out of the hull through openings, stopped by the air within metres;
    //  - smoke: soot made in the fireball, which takes over as the fireball cools (first lit orange from below,
    //    then black), rising in a column that widens and leans with the wind;
    //  - wreckage: plates of hull and superstructure, some burning, and glowing fragments.
    // The incoming round supplies energy (size) and momentum (downrange bias); delayed fuzes burst inside the
    // hull and vent up through the deck.
    explosion(at, scale = 1, {water = false, debris = true, sound = true, kind = 'missile', ship = null, waterline = false, velocity, round} = {}) {
        const blast = BLASTS[kind] || BLASTS.missile;
        const hull = HULLS[ship] || HULLS.none;
        const physics = shipImpactProfile(kind, round, velocity);
        const {x, y, z} = at;
        const r = Math.random;
        const size = physics.size * Math.cbrt(scale);
        const radius = physics.radius * Math.cbrt(scale);
        const fuel = blast.fuel * hull.fuel;
        const carry = physics.drift;
        const wet = water || waterline || hull.steam;
        // The recording begins with hull contact, before any delayed-fuze visual burst.
        if (sound) this.onSound('explosion', at, Math.max(.25, size), {weapon: kind, ship, waterline: wet, mass: round?.mass});
        for (let i = 0; i < Math.round(20 + 30 * size * hull.sparks); i++) {
            const dir = randomDir(.12), speed = (.8 + r() * 2.8) * Math.sqrt(size);
            this.spawn({x, y: y + .015, z, vx: dir.x * speed + carry.x, vy: dir.y * speed + .35, vz: dir.z * speed + carry.z, ramp: RAMP.SPARK, frame: FRAME.SPARK, size: .008 + r() * .012, life: .18 + r() * .55, drag: 1.1, lift: -DEBRIS_GRAVITY, stretch: .025, collide: true, intensity: .8});
        }
        const burst = () => {
            this.flash(at, 5 * size, physics.flashLife, new THREE.Color(1, .78, .5));
            this.spawn({x, y: y + .025, z, ramp: RAMP.FLASH, frame: FRAME.GLOW, size: radius * 2.6, life: physics.flashLife, drag: 0, intensity: .7});
            this.spawn({x, y: y + .03, z, ramp: RAMP.FLASH, frame: FRAME.FLARE, size: radius * 3.4, life: physics.flashLife * .7, drag: 0, rot: r() * 3, intensity: .45});
            // The fireball: unequal lobes around the burst point. An armour-piercing burst vents upward.
            const lobes = kind === 'gun' ? 1 + (size > .3) : size > .9 ? 4 : size > .5 ? 3 : 2;
            for (let i = 0; i < lobes; i++) {
                const dir = randomDir(blast.vent ? .7 : .35);
                const reach = radius * (i ? .45 + r() * .4 : .1);
                const centre = {x: x + dir.x * reach + carry.x * .03 * i, y: y + radius * .3 + dir.y * reach, z: z + dir.z * reach + carry.z * .03 * i};
                this.fireballs?.spawn(centre, radius * (i ? .45 + r() * .3 : .9), {
                    heat: i ? .7 + r() * .25 : 1, life: .8 + fuel * .7 + r() * .3, rise: .5 + size * .35,
                    velocity: {x: carry.x * .3 + dir.x * radius * 2.2, y: dir.y * radius * 2.2, z: carry.z * .3 + dir.z * radius * 2.2},
                    cooling: .14 + fuel * .22, stretch: .3 + r() * .35,
                });
            }
            if (fuel > .6) this.later(.09, () => {
                this.fireballs?.spawn({x: x + carry.x * .06, y: y + radius * .6, z: z + carry.z * .06}, radius * 1.15, {heat: .8, life: 1.8 + fuel * .5, rise: .75, velocity: {x: carry.x * .18, y: .12, z: carry.z * .18}, cooling: .55, stretch: .6});
            });
            // Flame jets: streaks of burning gas thrown out of the hull, stopped by the air within metres.
            for (let i = 0; i < Math.round(18 + 26 * size); i++) {
                const dir = randomDir(blast.vent ? .75 : .2);
                const speed = radius * (6 + r() * 8);
                this.spawn({x, y: y + .02, z, vx: dir.x * speed + carry.x * .4, vy: dir.y * speed, vz: dir.z * speed + carry.z * .4, ramp: r() < .6 ? RAMP.FIRE : RAMP.BLAZE, frame: FRAME.FLAME, size: radius * (.15 + r() * .3), life: .14 + r() * .2 + fuel * .15, drag: 6, lift: .9, cool: .4, turb: .65, stretch: .02, intensity: .85});
            }
            // Smoke. First the soot inside the fireball, lit orange from below as it boils up out of the flame...
            for (let i = 0; i < Math.round(6 + 10 * size); i++) {
                const dir = randomDir(.4), speed = radius * (1 + r() * 2);
                this.spawn({x: x + dir.x * radius * .3, y: y + radius * .3, z: z + dir.z * radius * .3, vx: dir.x * speed + carry.x * .15, vy: dir.y * speed + .3, vz: dir.z * speed + carry.z * .15, ramp: RAMP.SMOKE_FIRE, frame: FRAME.SMOKE, size: radius * (.7 + r() * .7), life: 2.2 + r() * 1.5, drag: 1.8, lift: .5 + size * .2, cool: 2, wind: .8, turb: .6, delay: .04 + r() * .12});
            }
            // ...then the black body of it, appearing as the fireball cools and filling the space it held,
            // rising and widening into a column that the wind leans over.
            for (let i = 0; i < Math.round(14 + 30 * size * blast.smoke); i++) {
                const dir = randomDir(.35), speed = radius * (.8 + r() * 2.6);
                const h = r();
                this.spawn({x: x + dir.x * radius * .5, y: y + .03 + radius * (.2 + h * .9), z: z + dir.z * radius * .5, vx: dir.x * speed + carry.x * .15, vy: dir.y * speed * .6 + .2 + h * .25, vz: dir.z * speed + carry.z * .15, ramp: RAMP.SMOKE_DARK, frame: FRAME.SMOKE, size: radius * (.8 + r() * 1.1), life: 6 + r() * 7, drag: 1.5, lift: .4 + size * .2, cool: 3, wind: 1, turb: .5, delay: .12 + r() * .45});
            }
            // Wreckage: a few plates of hull you can pick out, among many small fragments.
            if (debris) this.debris.burst(at, Math.round(6 + 12 * size * blast.debris), size, Math.round(blast.burning * size), carry);
            for (let i = 0; i < Math.round(10 * size); i++) {
                const dir = randomDir(.2), speed = (.5 + r() * 1.5) * Math.sqrt(size);
                this.spawn({x, y: y + .03, z, vx: dir.x * speed + carry.x, vy: dir.y * speed + .3, vz: dir.z * speed + carry.z, ramp: RAMP.EMBER, frame: FRAME.EMBER, size: .008 + r() * .008, life: .7 + r(), drag: .8, lift: -DEBRIS_GRAVITY, collide: true});
            }
            // A pressure wave is principally refraction, not a glowing bubble. Water
            // displacement is strong only when the blast actually couples to the sea.
            if (size > .55) this.shock(at, Math.min(1.3, size));
            if (wet) {
                this.rings.ring(at, size, 'water');
                this.ocean.addImpact(x, z, .7 * size * blast.push);
                this.splash({x, y: 0, z}, (water ? .7 : .45) * size, {sound: false});
            }
            if (hull.steam) this.steam(at, size);
            if (debris && size > .45) {
                this.cookOffs(at, size * hull.ordnance, sound);
                if (fuel > .6 && wet) this.spill(at, size * fuel);
                if (hull.secondary) this.later(.4 + r() * .4, () => this.pop(at.clone().add(new THREE.Vector3((r() - .5) * .2, .03, (r() - .5) * .2)), .6 * size, sound));
            }
            this.onShake(at, .4 * size);
        };
        if (physics.delay) this.later(physics.delay, burst); else burst();
    }

    // A shock front racing out from a big blast at the speed of sound (about 4.5 squares a second), for the
    // grade pass to bend the view through.
    shock(at, strength = 1) {
        this.blasts.push({at: new THREE.Vector3(at.x, at.y, at.z), t: 0, duration: .45, radius: 0, strength});
        if (this.blasts.length > 4) this.blasts.shift();
    }

    // Ammunition and fuel cooking off: small blasts popping around a hit for a second or two afterwards.
    cookOffs(at, scale = 1, sound = true) {
        const r = Math.random;
        const count = 2 + Math.floor(r() * 3);
        for (let i = 0; i < count; i++) {
            const offset = new THREE.Vector3((r() - .5) * .34, r() * .07, (r() - .5) * .34).multiplyScalar(scale);
            this.later(.3 + r() * 1.5, () => this.pop(at.clone().add(offset), .3 + r() * .28, sound && i === 0));
        }
    }

    // One small secondary blast: a flash, a puff of flame, a spray of sparks and a ball of smoke.
    pop(at, scale = .4, sound = false) {
        const r = Math.random;
        const {x, y, z} = at;
        this.flash(at, 3.4 * scale, .22, new THREE.Color(1, .68, .38));
        this.fireballs?.spawn(at, .13 * scale + .03, {heat: .8, life: 1.2, rise: .5});
        this.spawn({x, y: y + .02, z, ramp: RAMP.FLASH, frame: FRAME.GLOW, size: .7 * scale, life: .14, drag: 0});
        for (let i = 0; i < 16; i++) {
            const dir = randomDir(.3), speed = (.5 + r() * 1.1) * scale;
            this.spawn({x, y, z, vx: dir.x * speed, vy: dir.y * speed + .2, vz: dir.z * speed, ramp: RAMP.FIRE, frame: FRAME.FLAME, size: (.1 + r() * .12) * scale, life: .35 + r() * .35, drag: 4, lift: .4, intensity: .9 + r() * .4});
        }
        for (let i = 0; i < 22; i++) {
            const dir = randomDir(.2), speed = (1.6 + r() * 2.6) * scale;
            this.spawn({x, y, z, vx: dir.x * speed, vy: dir.y * speed + .8, vz: dir.z * speed, ramp: RAMP.SPARK, frame: FRAME.SPARK, size: .014 + r() * .014, life: .4 + r() * .6, drag: .9, lift: -4.2, stretch: .04, collide: true, intensity: .8});
        }
        for (let i = 0; i < 6; i++) {
            const dir = randomDir(.6);
            this.spawn({x, y: y + .04, z, vx: dir.x * .2, vy: .3 + r() * .25, vz: dir.z * .2, ramp: RAMP.SMOKE_FIRE, frame: FRAME.SMOKE, size: (.2 + r() * .2) * scale, life: 2.5 + r() * 2, drag: 1.4, lift: .3, wind: 1, swirl: .4, delay: r() * .1});
        }
        if (sound) this.onSound('explosion', at, scale * .6, {secondary: true});
    }

    // Burning fuel thrown onto the water beside a hit; it burns out after a few seconds.
    spill(at, scale = 1) {
        const r = Math.random;
        for (let i = 0; i < 3; i++) {
            const a = r() * Math.PI * 2, d = (.14 + r() * .22) * scale;
            const anchor = new THREE.Object3D();
            anchor.position.set(at.x + Math.cos(a) * d, .012, at.z + Math.sin(a) * d);
            this.scene.add(anchor);
            this.fires.push(this.makeFire(anchor, .4 + r() * .3, {life: 3.5 + r() * 4, owned: true, delay: .2 + r() * .5}));
        }
    }

    // A projectile striking the sea, from its physics. mass: kg. velocity: at impact, in squares a second (one
    // square is 75 m, so ×75 is m/s), which gives both speed and the angle and bearing it comes in at; the flight
    // that produced it (a shell slowing and steepening under drag and gravity, a bomb gaining speed as it falls, a
    // missile driven by its motor) is where acceleration enters. top: the fastest the round can really arrive
    // (m/s), since the battle's flights are shortened in time. charge: kg of explosive. fuze: 'impact' bursts on
    // the surface; 'delay' bursts after running a few metres under it, as armour-piercing shells and bombs do.
    //  - The crater scales as the energy put into the water to the ¼ power (gravity-dominated cratering,
    //    R = (E / ρg)^¼): the kinetic energy ½mv² plus the part of the charge that couples to the water (more for
    //    a burst under the surface than on it).
    //  - Entry throws a crown of water up and out, sized by the kinetic energy alone. Coming in at a slant, the
    //    crown leans downrange and a fan of spray is thrown ahead; little goes back the way the round came.
    //  - A delayed burst lifts a white spray dome first, then the plume: a narrow column about seven crater
    //    radii tall, leaning the way the round was travelling. A surface burst makes a lower, wider plume with a
    //    flash, a small fireball and smoke.
    //  - The column falls back as heavy rain (each drop ringing the sea where it lands) and rolls out across the
    //    water as a base surge of mist.
    waterImpact(at, {velocity, mass = 100, charge = 0, fuze = 'impact', top = Infinity, fuel = 0, sound = true} = {}) {
        const r = Math.random;
        const x = at.x, z = at.z;
        const v = velocity ? velocity.clone() : new THREE.Vector3(.6, -6, 0);
        if (v.y > -.3) v.y = -.3;
        const speed = Math.min(v.length() * 75, top);
        const dir = v.normalize();
        const along = new THREE.Vector3(dir.x, 0, dir.z);
        const slant = Math.min(1, along.length());      // cosine of the angle of fall
        if (slant > 1e-3) along.divideScalar(slant); else along.set(1, 0, 0);
        const across = new THREE.Vector3(-along.z, 0, along.x);
        const burst = fuze === 'delay';
        const kinetic = .5 * mass * speed * speed;
        const blast = charge * 4.2e6 * (burst ? .45 : .2);
        const crater = Math.pow((kinetic + blast) / 9810, .25) / 75;
        const entry = Math.pow(kinetic / 9810, .25) / 75;
        const k = crater / .12, ke = entry / .1;
        // The particles fall under a fast gravity (squares/s²) so a 60 m column rises and falls in a couple of
        // seconds of battle; heights and widths come from the physics above.
        const G = 5.2;
        // Entry: the crown.
        const crownSpeed = Math.sqrt(2 * G * entry * 2.6);
        const crownCount = Math.round(THREE.MathUtils.clamp(26 * Math.sqrt(ke), 10, 64));
        for (let i = 0; i < crownCount; i++) {
            const a = (i / crownCount) * Math.PI * 2 + r() * .3;
            const fwd = Math.cos(a), side = Math.sin(a);
            const ox = along.x * fwd + across.x * side, oz = along.z * fwd + across.z * side;
            const out = crownSpeed * (.35 + .25 * r()) * (1 + slant * .9 * fwd);
            const up = crownSpeed * (.8 + .3 * r()) * (1 - slant * .35 * fwd);
            const size = (.03 + r() * .04) * Math.sqrt(ke);
            this.spawn({x: x + ox * entry * .5, y: .02, z: z + oz * entry * .5, vx: ox * out, vy: up, vz: oz * out, ramp: RAMP.SPRAY, frame: FRAME.SPRAY, size, life: 1.5, drag: .2, lift: -G, collide: true, terminal: 1.5 + size * 14, stretch: .012});
        }
        // At a slant, a fan of spray thrown ahead as the round digs in.
        if (slant > .3) {
            for (let i = 0; i < 34 * slant * Math.sqrt(ke); i++) {
                const spread = (r() - .5) * .9;
                const ox = along.x + across.x * spread, oz = along.z + across.z * spread;
                const sp = crownSpeed * (.6 + r() * .7) * slant;
                const size = .022 + r() * .03;
                this.spawn({x, y: .02, z, vx: ox * sp, vy: crownSpeed * (.3 + r() * .35), vz: oz * sp, ramp: RAMP.SPRAY, frame: FRAME.SPRAY, size, life: 1.3, drag: .3, lift: -G, collide: true, terminal: 1.4 + size * 14, stretch: .016});
            }
        }
        const plume = (delay) => {
            const height = crater * (burst ? 7 : 4.5);
            const v0 = Math.sqrt(2 * G * height);
            const width = crater * (burst ? 1.25 : 1.1);
            const lean = slant * (burst ? .12 : .2);
            const rise = v0 / G;
            const count = Math.round(THREE.MathUtils.clamp(95 * Math.sqrt(k), 40, 170));
            for (let i = 0; i < count; i++) {
                const a = r() * Math.PI * 2, d = Math.sqrt(r()) * width;
                // Most of the water leaves near the top speed: a solid column, not a cone.
                const up = v0 * (.45 + .55 * Math.pow(r(), .55));
                const size = (.07 + r() * .12) * Math.pow(k, .4);
                this.spawn({x: x + Math.cos(a) * d * .5, y: .03, z: z + Math.sin(a) * d * .5, vx: Math.cos(a) * d * .9 + along.x * up * lean, vy: up, vz: Math.sin(a) * d * .9 + along.z * up * lean, ramp: RAMP.SPRAY, frame: r() < .65 ? FRAME.COLUMN : FRAME.SPRAY, size, life: 2 * up / G + .5, drag: .15, lift: -G, collide: true, terminal: 3 + size * 6, delay});
            }
            // Jets: the column is not a cloud but sheets and jets of solid water, which streak as they climb.
            for (let i = 0; i < THREE.MathUtils.clamp(45 * Math.sqrt(k), 24, 80); i++) {
                const a = r() * Math.PI * 2, d = Math.sqrt(r()) * width * .6;
                const up = v0 * (.55 + .5 * r());
                const size = (.022 + r() * .03) * Math.pow(k, .3);
                this.spawn({x: x + Math.cos(a) * d * .4, y: .03, z: z + Math.sin(a) * d * .4, vx: Math.cos(a) * d * 1.2 + along.x * up * lean, vy: up, vz: Math.sin(a) * d * 1.2 + along.z * up * lean, ramp: RAMP.SPRAY, frame: FRAME.SPRAY, size, life: 2 * up / G + .3, drag: .1, lift: -G, collide: true, terminal: 2.4 + size * 14, stretch: .02, delay: delay + r() * .03});
            }
            // Mist torn off the column's top and sides, hanging and drifting.
            for (let i = 0; i < 14 * k; i++) {
                this.spawn({x: x + (r() - .5) * width + along.x * height * lean, y: height * (.4 + r() * .6), z: z + (r() - .5) * width + along.z * height * lean, vx: (r() - .5) * .3, vy: .1 + r() * .2, vz: (r() - .5) * .3, ramp: RAMP.MIST, frame: FRAME.SMOKE, size: (.2 + r() * .25) * Math.sqrt(k), life: 2.5 + r() * 2, drag: .9, wind: .8, delay: delay + rise * (.5 + r() * .5)});
            }
            // Base surge rolling out low across the water as the column falls back.
            for (let i = 0; i < 22 * k; i++) {
                const a = r() * Math.PI * 2, sp = (1 + r() * .6) * Math.sqrt(k) * .9;
                this.spawn({x, y: .05, z, vx: Math.cos(a) * sp, vy: .05 + r() * .08, vz: Math.sin(a) * sp, ramp: RAMP.MIST, frame: FRAME.SMOKE, size: (.16 + r() * .14) * Math.sqrt(k), life: 2.2 + r() * 1.4, drag: 1.3, wind: .5, delay: delay + rise * 1.4 + r() * .3});
            }
        };
        let wait = 0;
        if (burst) {
            // The round runs on under the surface before it bursts: a white spray dome lifts, then the plume.
            wait = .14 + Math.min(.12, crater * .6);
            const domeSpeed = Math.sqrt(2 * G * crater * 1.4);
            const ox = along.x * crater * .3 * slant, oz = along.z * crater * .3 * slant;
            this.later(wait, () => {
                for (let i = 0; i < 44 * Math.sqrt(k); i++) {
                    const d = randomDir(.15);
                    const sp = domeSpeed * (.6 + r() * .4);
                    this.spawn({x: x + ox, y: .02, z: z + oz, vx: d.x * sp, vy: Math.abs(d.y) * sp, vz: d.z * sp, ramp: RAMP.MIST, frame: FRAME.SMOKE, size: (.1 + r() * .1) * Math.sqrt(k), life: 1 + r() * .5, drag: 2.4, lift: -1});
                }
                this.rings.ring({x: x + ox, y: .01, z: z + oz}, crater * 5, 'water');
                this.onShake(at, .22 * k);
                if (sound) this.onSound('splash', at, k * 1.15);
            });
            plume(wait + .08);
        } else {
            plume(0);
            this.rings.ring({x, y: .01, z}, crater * 5, 'water');
            if (charge > .2) {
                // The burst on the surface: a flash and a puff of dirty black-grey smoke. Only a warhead-sized
                // charge makes a real fireball; a shell's few kilograms are a flash and a flicker of flame.
                const s = THREE.MathUtils.clamp(Math.cbrt(charge) / 4, .22, 1.6);
                this.flash({x, y: .05, z}, 2.8 * s, .2, new THREE.Color(1, .66, .36));
                this.spawn({x, y: .06, z, ramp: RAMP.FLASH, frame: FRAME.GLOW, size: .5 * s, life: .12, drag: 0});
                // Sitting on the water, not floating over it: the ball is a dome that lifts off as it burns.
                if (charge >= 40) this.fireballs?.spawn({x, y: (.07 * s + .025) * .35, z}, .07 * s + .025, {heat: 1, life: .8 + .5 * s, rise: .45});
                for (let i = 0; i < 14 * s + 4; i++) {
                    const d = randomDir(.5), sp = (.4 + r() * .8) * s;
                    this.spawn({x, y: .04, z, vx: d.x * sp, vy: d.y * sp + .3, vz: d.z * sp, ramp: RAMP.FIRE, frame: FRAME.FLAME, size: (.07 + r() * .08) * s, life: (.3 + r() * .25) * (charge >= 40 ? 1 : .5), drag: 4, lift: 1, cool: .4, intensity: 1});
                }
                for (let i = 0; i < 8 * s + 3; i++) {
                    this.spawn({x: x + (r() - .5) * .1 * s, y: .06 + r() * .06 * s, z: z + (r() - .5) * .1 * s, vx: (r() - .5) * .15 * s, vy: .15 + r() * .2, vz: (r() - .5) * .15 * s, ramp: r() < .6 ? RAMP.SMOKE_DARK : RAMP.GUNSMOKE, frame: FRAME.SMOKE, size: (.16 + r() * .14) * s, life: 2.5 + r() * 2 * s, drag: 1.2, lift: .25, cool: 2, wind: 1, turb: .3, delay: .03 + r() * .15});
                }
                if (s > .8) this.shock({x, y: .1, z}, s);
                if (sound) this.onSound('explosion', at, s * .7);
            }
        }
        if (fuel > 0) {
            // A crashing aircraft: the fuel left in its tanks flashes into a rolling fireball that climbs off
            // the water, the rest burns on the surface where it lands, thrown downrange, and wreckage flies.
            const f = Math.cbrt(fuel / 1000);
            const ahead = {x: x + along.x * crater * .6 * slant, y: .01, z: z + along.z * crater * .6 * slant};
            this.fireballs?.spawn({x: ahead.x, y: .09 * f, z: ahead.z}, .12 * f, {heat: .8, life: 2.4, rise: .8});
            for (let i = 0; i < 26 * f; i++) {
                const d = randomDir(.35), sp = (.3 + r() * .7) * f;
                this.spawn({x: ahead.x, y: .05, z: ahead.z, vx: d.x * sp + along.x * slant * .6, vy: d.y * sp + .25, vz: d.z * sp + along.z * slant * .6, ramp: r() < .6 ? RAMP.FIRE : RAMP.SMOKE_FIRE, frame: r() < .6 ? FRAME.FLAME : FRAME.SMOKE, size: (.1 + r() * .12) * f, life: .9 + r() * .9, drag: 2.4, lift: 1, cool: 1.1, turb: .7, wind: .3, intensity: 1, delay: r() * .1});
            }
            for (let i = 0; i < 10 * f; i++) {
                this.spawn({x: ahead.x + (r() - .5) * .15, y: .12, z: ahead.z + (r() - .5) * .15, vx: (r() - .5) * .12, vy: .25 + r() * .2, vz: (r() - .5) * .12, ramp: RAMP.SMOKE_DARK, frame: FRAME.SMOKE, size: (.22 + r() * .25) * f, life: 7 + r() * 5, drag: 1.1, lift: .45, cool: 3, wind: 1, turb: .4, delay: .2 + r() * .6});
            }
            this.spill(ahead, .9 * f);
            this.debris?.burst({x: ahead.x, y: .03, z: ahead.z}, 10, 1.1, 3);
        }
        this.ocean.ripples?.impact(x, z, {radius: crater, strength: k, along, slant, delay: wait});
        this.onShake(at, .12 * k);
        if (sound) this.onSound('splash', at, Math.max(.4, k * (burst ? .6 : 1)));
    }

    splash(at, scale = 1, {sound = true, explosive = false} = {}) {
        const {x, z} = at;
        const r = Math.random;
        if (explosive) {
            // The round bursts as it strikes the water: a short orange flash under the rising column.
            this.flash({x, y: .05, z}, 2.6 * scale, .25, new THREE.Color(1, .66, .36));
            this.spawn({x, y: .06, z, ramp: RAMP.FLASH, frame: FRAME.GLOW, size: .55 * scale, life: .16, drag: 0});
            for (let i = 0; i < 12 * scale; i++) {
                const dir = randomDir(.5), speed = (.4 + r() * .8) * scale;
                this.spawn({x, y: .04, z, vx: dir.x * speed, vy: dir.y * speed + .3, vz: dir.z * speed, ramp: RAMP.FIRE, frame: FRAME.FLAME, size: (.08 + r() * .1) * scale, life: .3 + r() * .25, drag: 4, intensity: 1});
            }
        }
        // Crown: a ring of water thrown up and out around the foot of the column.
        for (let i = 0; i < 30 * scale; i++) {
            const a = i / (30 * scale) * Math.PI * 2 + r() * .25, speed = (.8 + r() * .55) * Math.sqrt(scale);
            this.spawn({x: x + Math.cos(a) * .07 * scale, y: .02, z: z + Math.sin(a) * .07 * scale, vx: Math.cos(a) * speed, vy: (1.5 + r() * .9) * Math.sqrt(scale), vz: Math.sin(a) * speed, ramp: RAMP.SPRAY, frame: FRAME.SPRAY, size: (.045 + r() * .05) * scale, life: .9 + r() * .4, drag: .3, lift: -5, stretch: .014, collide: true, terminal: 1.6 + r() * 1.4});
        }
        // Base surge: low mist rolling out across the water as the column collapses.
        for (let i = 0; i < 20 * scale; i++) {
            const a = r() * Math.PI * 2, speed = (.8 + r() * .7) * scale;
            this.spawn({x, y: .05, z, vx: Math.cos(a) * speed, vy: .05 + r() * .08, vz: Math.sin(a) * speed, ramp: RAMP.MIST, frame: FRAME.SMOKE, size: (.16 + r() * .14) * scale, life: 2 + r() * 1.4, drag: 1.3, wind: .5, delay: .55 + r() * .35});
        }
        for (let i = 0; i < 70 * scale; i++) {
            const a = r() * Math.PI * 2, spread = (.06 + r() * .32) * scale;
            const up = (1.3 + Math.pow(r(), .7) * 2.1) * Math.sqrt(scale);
            const size = (.15 + r() * .24) * scale;
            this.spawn({x: x + Math.cos(a) * spread * .5, y: .02, z: z + Math.sin(a) * spread * .5, vx: Math.cos(a) * spread * .9, vy: up, vz: Math.sin(a) * spread * .9, ramp: RAMP.SPRAY, frame: r() < .6 ? FRAME.COLUMN : FRAME.SPRAY, size, life: 1.3 + r() * 1.1, drag: .2, lift: -5.2, collide: true, terminal: 3.2 + size * 6});
        }
        for (let i = 0; i < 16 * scale; i++) {
            const a = r() * Math.PI * 2, d = r() * .2 * scale;
            this.spawn({x: x + Math.cos(a) * d, y: .05, z: z + Math.sin(a) * d, vx: Math.cos(a) * .35, vy: .5 + r() * .6, vz: Math.sin(a) * .35, ramp: RAMP.SPRAY, frame: FRAME.SMOKE, size: (.22 + r() * .2) * scale, life: .9 + r() * .5, drag: 1.4, lift: -1.5});
        }
        for (let i = 0; i < 46 * scale; i++) {
            const a = r() * Math.PI * 2, speed = (.7 + r() * 1.1) * scale;
            const size = (.05 + r() * .09) * scale;
            this.spawn({x, y: .02, z, vx: Math.cos(a) * speed, vy: 1.1 + r() * 1.4, vz: Math.sin(a) * speed, ramp: RAMP.SPRAY, frame: FRAME.SPRAY, size, life: .8 + r() * .6, drag: .2, lift: -5, collide: true, terminal: 1.3 + size * 14, stretch: .014});
        }
        for (let i = 0; i < 12 * scale; i++) {
            const a = r() * Math.PI * 2;
            this.spawn({x: x + Math.cos(a) * .1, y: .1 + r() * .5 * scale, z: z + Math.sin(a) * .1, vx: Math.cos(a) * .2, vy: .2 + r() * .35, vz: Math.sin(a) * .2, ramp: RAMP.MIST, frame: FRAME.SMOKE, size: (.35 + r() * .35) * scale, life: 2.6 + r() * 1.8, drag: .9, lift: .05, wind: .8, delay: .25 + r() * .4});
        }
        this.ocean.addImpact(x, z, 1.05 * scale);
        this.rings.ring({x, y: .01, z}, scale * .7, 'water');
        if (sound) this.onSound('splash', at, scale);
    }

    muzzle(at, dir, scale = 1) {
        const r = Math.random;
        const {x, y, z} = at;
        this.flash(at, 3.2 * scale, .18, new THREE.Color(1, .7, .4));
        this.spawn({x, y, z, ramp: RAMP.MUZZLE, frame: FRAME.FLARE, size: .45 * scale, life: .12, drag: 0, rot: r() * 3});
        this.spawn({x: x + dir.x * .1 * scale, y: y + dir.y * .1 * scale, z: z + dir.z * .1 * scale, ramp: RAMP.MUZZLE, frame: FRAME.GLOW, size: .55 * scale, life: .14, drag: 0});
        for (let i = 0; i < 12 * scale; i++) {
            const speed = (2.5 + r() * 3) * scale;
            const jitter = randomDir(0).multiplyScalar(.25);
            this.spawn({x, y, z, vx: (dir.x + jitter.x) * speed, vy: (dir.y + jitter.y) * speed, vz: (dir.z + jitter.z) * speed, ramp: RAMP.FIRE, frame: FRAME.FLAME, size: (.06 + r() * .08) * scale, life: .18 + r() * .14, drag: 9, intensity: 1.2});
        }
        const heavy = scale > 1.4;
        // The blast cloud: thrown out fast, stopped by the air within a few tens of metres, then it hangs and drifts.
        for (let i = 0; i < (heavy ? 44 : 18) * scale; i++) {
            const speed = (.8 + r() * 2.2) * scale;
            const jitter = randomDir(0).multiplyScalar(.5);
            this.spawn({x, y, z, vx: (dir.x + jitter.x) * speed, vy: (dir.y + jitter.y) * speed + .1, vz: (dir.z + jitter.z) * speed, ramp: heavy ? RAMP.CORDITE : RAMP.GUNSMOKE, frame: FRAME.SMOKE, size: (.08 + r() * .14) * scale, life: (heavy ? 5 : 2.2) + r() * 2.5, drag: heavy ? 7.5 : 2.6, lift: .06, wind: 1, swirl: .35});
        }
        if (heavy) {
            this.shock({x: x + dir.x * .15, y, z: z + dir.z * .15}, .9);
            // The 16-inch fireball: a ball of flame thrown out ahead of the muzzle.
            for (let i = 0; i < 26; i++) {
                const speed = (2 + r() * 4) * scale * .6;
                const jitter = randomDir(0).multiplyScalar(.35);
                this.spawn({x, y, z, vx: (dir.x + jitter.x) * speed, vy: (dir.y + jitter.y) * speed, vz: (dir.z + jitter.z) * speed, ramp: RAMP.FIRE, frame: r() < .5 ? FRAME.FLAME : FRAME.SMOKE, size: (.12 + r() * .14) * scale, life: .3 + r() * .3, drag: 5, intensity: 1.5});
            }
        }
        if (scale > .9) {
            this.ocean.addImpact(x + dir.x * .4, z + dir.z * .4, .45 * scale);
            this.rings.ring({x: x + dir.x * .3, y: .01, z: z + dir.z * .3}, .6 * scale, 'water');
        }
    }

    steam(at, scale = 1) {
        const r = Math.random;
        for (let i = 0; i < 20 * scale; i++) {
            this.spawn({x: at.x + (r() - .5) * .2, y: .03, z: at.z + (r() - .5) * .2, vx: (r() - .5) * .2, vy: .4 + r() * .6, vz: (r() - .5) * .2, ramp: RAMP.STEAM, frame: FRAME.SMOKE, size: (.12 + r() * .16) * scale, life: 2 + r() * 2, drag: 1.2, lift: .25, wind: 1, swirl: .4});
        }
    }

    bubbles(at, radius, scale = 1) {
        const r = Math.random;
        for (let i = 0; i < 6 * scale; i++) {
            const a = r() * Math.PI * 2, d = r() * radius;
            this.spawn({x: at.x + Math.cos(a) * d, y: .01, z: at.z + Math.sin(a) * d, vx: 0, vy: .25 + r() * .5, vz: 0, ramp: RAMP.WAKE, frame: r() < .5 ? FRAME.SPRAY : FRAME.BUBBLE, size: .05 + r() * .08, life: .6 + r() * .6, drag: 1.5, lift: -1.2});
        }
    }

    // Trails for projectiles. Smoke is laid down by distance travelled since the last frame (from → at), so a
    // trail stays continuous at any speed or frame rate instead of breaking into beads.
    trail(kind, at, velocity, dt, progress = 0, from = at, projectile = null) {
        const r = Math.random;
        const speed = velocity.length();
        const dir = speed > 1e-5 ? velocity.clone().divideScalar(speed) : new THREE.Vector3(0, 1, 0);
        const back = dir.clone().negate();
        const travelled = from.distanceTo(at);
        const along = (spacing, fn) => {
            const n = Math.min(48, Math.ceil(travelled / spacing));
            for (let i = 0; i < n; i++) {
                const k = (i + r()) / n;
                fn(from.x + (at.x - from.x) * k, from.y + (at.y - from.y) * k, from.z + (at.z - from.z) * k);
            }
        };
        if (kind === 'shell') {
            // A glowing tracer streak, and a thin wake of hot gas and propellant smoke behind the shell.
            this.spawn({x: at.x, y: at.y, z: at.z, vx: velocity.x * .02, vy: velocity.y * .02, vz: velocity.z * .02, ramp: RAMP.TRACER, frame: FRAME.SPARK, size: .11, life: .12, drag: 0, stretch: .03, intensity: 1.6});
            this.spawn({x: at.x, y: at.y, z: at.z, vx: velocity.x, vy: velocity.y, vz: velocity.z, ramp: RAMP.TRACER, frame: FRAME.GLOW, size: .13, life: Math.min(.034, dt * 1.05), drag: 0, intensity: 1.2});
            along(.045, (x, y, z) => this.spawn({x, y, z, vx: (r() - .5) * .05, vy: (r() - .5) * .05, vz: (r() - .5) * .05, ramp: RAMP.GUNSMOKE, frame: FRAME.WISP, size: .03 + r() * .025, life: .6 + r() * .5, drag: 2, wind: .5, alpha: .4}));
        } else if (kind === 'missile') {
            const tail = at.clone().addScaledVector(back, .07);
            const boost = progress < .3;
            // The motor: a white-hot core, a long flame, and shock diamonds standing in the plume.
            const life = Math.min(.034, dt * 1.05);
            const ride = {vx: velocity.x, vy: velocity.y, vz: velocity.z, drag: 0};
            this.spawn({x: tail.x, y: tail.y, z: tail.z, ...ride, ramp: RAMP.EXHAUST, frame: FRAME.FLARE, size: .17 + r() * .05, life, intensity: .9, rot: r() * 3});
            this.spawn({x: tail.x, y: tail.y, z: tail.z, ...ride, ramp: RAMP.EXHAUST, frame: FRAME.GLOW, size: .12, life, intensity: .9});
            for (let d = 1; d <= 4; d++) {
                const flicker = .8 + r() * .4;
                this.spawn({x: tail.x + back.x * d * .042, y: tail.y + back.y * d * .042, z: tail.z + back.z * d * .042, ...ride, ramp: RAMP.EXHAUST, frame: FRAME.GLOW, size: (.05 - d * .008) * flicker, life, intensity: (1.5 - d * .28) * flicker});
            }
            this.spawn({x: tail.x, y: tail.y, z: tail.z, vx: back.x * 5, vy: back.y * 5, vz: back.z * 5, ramp: RAMP.EXHAUST, frame: FRAME.FLAME, size: .05, life: .06, drag: 0, stretch: .025, intensity: 1.3});
            for (let i = 0; i < 3; i++) this.spawn({x: tail.x, y: tail.y, z: tail.z, vx: back.x * 2.4 + (r() - .5) * .25, vy: back.y * 2.4 + (r() - .5) * .25, vz: back.z * 2.4 + (r() - .5) * .25, ramp: RAMP.EXHAUST, frame: FRAME.FLAME, size: .07 + r() * .06, life: .1 + r() * .07, drag: 4, intensity: 1.5});
            // Smoke: dense and billowing while boosting off the rail, a thinner trail once cruising. Each puff
            // starts small and hot behind the nozzle, spreads, and drifts off on the wind.
            const tailFrom = from.clone().addScaledVector(back, .07);
            const seg = {x0: tailFrom.x, y0: tailFrom.y, z0: tailFrom.z};
            const n = Math.min(72, Math.ceil(travelled / (boost ? .011 : .012)));
            for (let i = 0; i < n; i++) {
                const k = (i + r()) / n, spread = boost ? .22 : .08;
                this.spawn({x: seg.x0 + (tail.x - seg.x0) * k + (r() - .5) * .02, y: seg.y0 + (tail.y - seg.y0) * k + (r() - .5) * .02, z: seg.z0 + (tail.z - seg.z0) * k + (r() - .5) * .02, vx: back.x * .25 + (r() - .5) * spread, vy: back.y * .25 + (r() - .5) * spread, vz: back.z * .25 + (r() - .5) * spread, ramp: boost ? RAMP.LAUNCH_SMOKE : RAMP.TRAIL, frame: FRAME.SMOKE, size: (boost ? .085 : .068) + r() * .018, life: (boost ? 11 : 8) + r() * 4, drag: 1.4, lift: .1, cool: 4, wind: .9, turb: .12});
            }
        } else if (kind === 'jet') {
            // Twin afterburners, a faint exhaust trail, vapor over the wings and vortices off the tips in hard turns.
            const scale = projectile?.scale || 1.1;
            this.afterburner(at.clone().addScaledVector(back, .13 * scale), back, velocity, 1, scale, dt);
            const bank = Math.abs(projectile?.bank || 0);
            if (bank > .7) {
                // Condensation over the wings as they pull hard: a white sheet that flickers on the upper surfaces.
                const up = new THREE.Vector3(0, 1, 0);
                const across = new THREE.Vector3().crossVectors(dir, up).normalize();
                for (let i = 0; i < 4; i++) {
                    const s = (r() - .5) * 2;
                    const p = at.clone().addScaledVector(across, s * .07 * scale).addScaledVector(dir, -.03 * scale + (r() - .5) * .03).add(new THREE.Vector3(0, .01 * scale, 0));
                    this.spawn({x: p.x, y: p.y, z: p.z, vx: velocity.x * .92, vy: velocity.y * .92, vz: velocity.z * .92, ramp: RAMP.MIST, frame: FRAME.SMOKE, size: .018 + r() * .014, life: .08 + r() * .06, drag: 4, alpha: Math.min(1, (bank - .7) * 3) * .55});
                }
            }
            if (bank > .35) {
                const side = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize().multiplyScalar(.075);
                along(.03, (x, y, z) => {
                    for (const s of [1, -1]) this.spawn({x: x + side.x * s, y, z: z + side.z * s, ramp: RAMP.TRAIL, frame: FRAME.WISP, size: .012, life: .9, drag: 1.2, alpha: Math.min(1, (bank - .35) * 2) * .7, wind: .3});
                });
            }
        } else if (kind === 'torpedo') {
            for (let i = 0; i < 2; i++) this.spawn({x: at.x + (r() - .5) * .05, y: .015, z: at.z + (r() - .5) * .05, vx: 0, vy: .08 + r() * .12, vz: 0, ramp: RAMP.WAKE, frame: r() < .5 ? FRAME.SPRAY : FRAME.BUBBLE, size: .05 + r() * .05, life: 1.6 + r() * .8, drag: 2, lift: -.1});
        } else if (kind === 'flare') {
            // A decoy flare: a white-hot magnesium point and the thick white smoke it leaves.
            this.spawn({x: at.x, y: at.y, z: at.z, vx: velocity.x, vy: velocity.y, vz: velocity.z, ramp: RAMP.FLASH, frame: FRAME.GLOW, size: .07, life: Math.min(.034, dt * 1.05), drag: 0, intensity: 1.6});
            along(.02, (x, y, z) => this.spawn({x, y, z, vx: (r() - .5) * .04, vy: (r() - .5) * .04, vz: (r() - .5) * .04, ramp: RAMP.TRAIL, frame: FRAME.SMOKE, size: .025 + r() * .015, life: 3 + r() * 2, drag: 1.2, lift: .05, wind: .7, turb: .3, alpha: .75}));
        } else if (kind === 'bomb') {
            // Air streaming off the fins as it falls.
            along(.05, (x, y, z) => this.spawn({x, y, z, ramp: RAMP.GUNSMOKE, frame: FRAME.WISP, size: .016, life: .45, drag: 2, alpha: .35}));
        } else if (kind === 'rocket') {
            this.spawn({x: at.x, y: at.y, z: at.z, vx: -velocity.x * .1, vy: -velocity.y * .1, vz: -velocity.z * .1, ramp: RAMP.SPARK, frame: FRAME.SPARK, size: .03, life: .35, drag: 1, stretch: .02});
        }
    }

    firework(at, ramp, scale = 1) {
        const r = Math.random;
        this.flash(at, 6 * scale, .5, new THREE.Color(1, .85, .6));
        this.spawn({x: at.x, y: at.y, z: at.z, ramp, frame: FRAME.GLOW, size: .9 * scale, life: .35, drag: 0});
        const count = Math.round(110 * scale);
        for (let i = 0; i < count; i++) {
            const dir = randomDir(-1);
            const speed = (1.4 + r() * .4) * scale;
            this.spawn({x: at.x, y: at.y, z: at.z, vx: dir.x * speed, vy: dir.y * speed, vz: dir.z * speed, ramp, frame: FRAME.SPARK, size: .03, life: 1.5 + r() * .9, drag: 1.4, lift: -.55, stretch: .05, intensity: 1});
        }
        for (let i = 0; i < 40 * scale; i++) {
            const dir = randomDir(-1);
            this.spawn({x: at.x, y: at.y, z: at.z, vx: dir.x * .8, vy: dir.y * .8, vz: dir.z * .8, ramp: RAMP.FW_WHITE, frame: FRAME.EMBER, size: .018, life: 1.2 + r() * 1.4, drag: 1, lift: -.4, delay: .4 + r() * .9});
        }
        this.onSound('firework', at, scale);
    }

    // ---------------------------------------------------------------------------------------------------
    // Persistent fires and lights
    // ---------------------------------------------------------------------------------------------------

    // A fire where a round hit. A hit sets more than one thing burning, so the main fire has one or two smaller
    // ones beside it along the deck (attached to it, so they ride and sink with the ship).
    addFire(anchor, scale = 1) {
        const r = Math.random;
        const fire = this.makeFire(anchor, scale);
        for (let i = 0; i < (scale > .9 ? 2 : 1); i++) {
            const node = new THREE.Object3D();
            node.position.set((i ? -1 : 1) * (.06 + r() * .09), 0, (r() - .5) * .05);
            anchor.add(node);
            fire.sources.push({node, weight: .4 + r() * .3, flame: 0, tongue: 0, smoke: 0, phase: r() * 10});
        }
        this.fires.push(fire);
        return fire;
    }

    // Fuel and oil burning on the water round a sinking ship: it keeps burning, with its black smoke, for the rest
    // of the battle, after the fires on her decks have gone under.
    oilFire(at, scale = 1, delay = 0) {
        const r = Math.random;
        const anchor = new THREE.Object3D();
        anchor.position.set(at.x, .012, at.z);
        this.scene.add(anchor);
        const fire = this.makeFire(anchor, scale, {owned: true, delay});
        for (let i = 0; i < 2; i++) {
            const node = new THREE.Object3D();
            node.position.set((r() - .5) * .22 * scale, 0, (r() - .5) * .16 * scale);
            anchor.add(node);
            fire.sources.push({node, weight: .35 + r() * .3, flame: 0, tongue: 0, smoke: 0, phase: r() * 10});
        }
        this.fires.push(fire);
        return fire;
    }

    // Torn steel left at a hit: plates ripped up and bent outward around the hole, charred black, a few still
    // glowing at the torn edge. Attached to the hit, so it rides, lists and sinks with the ship.
    scar(anchor, scale = 1) {
        const r = Math.random;
        if (!this.scarMaterials) {
            this.scarMaterials = [
                new THREE.MeshStandardMaterial({color: 0x161514, roughness: .9, metalness: .3}),
                new THREE.MeshStandardMaterial({color: 0x3a3632, roughness: .75, metalness: .5}),
                new THREE.MeshStandardMaterial({color: 0x1a1512, roughness: .85, metalness: .3, emissive: new THREE.Color(1, .3, .06), emissiveIntensity: .9}),
            ];
            // A jagged sheet: a thin slab whose top edge is torn into points.
            const shape = new THREE.Shape();
            shape.moveTo(-.5, 0);
            for (let i = 0; i <= 6; i++) shape.lineTo(-.5 + i / 6, .55 + (i % 2 ? .45 : 0) * (.6 + r() * .4));
            shape.lineTo(.5, 0);
            this.scarGeometry = new THREE.ExtrudeGeometry(shape, {depth: .04, bevelEnabled: false}).translate(0, 0, -.02);
        }
        const group = new THREE.Group();
        const count = Math.round(5 + 5 * Math.min(1.6, scale));
        for (let i = 0; i < count; i++) {
            const a = (i / count) * Math.PI * 2 + r() * .5;
            const ring = (.012 + r() * .02) * scale;
            const plate = new THREE.Mesh(this.scarGeometry, this.scarMaterials[i % 7 === 0 ? 2 : i % 3 === 0 ? 1 : 0]);
            const size = (.018 + r() * .03) * Math.sqrt(scale);
            plate.scale.set(size, size * (.6 + r() * .8), size);
            plate.position.set(Math.cos(a) * ring, -.004, Math.sin(a) * ring);
            // Peeled up and outward from the hole, at odd angles.
            plate.rotation.set((r() - .5) * .6, -a + Math.PI / 2, 0);
            plate.rotateX(-(.35 + r() * .9));
            plate.castShadow = true;
            group.add(plate);
        }
        anchor.add(group);
        return group;
    }

    makeFire(anchor, scale, extra = {}) {
        return {anchor, scale, alive: true, seed: Math.random() * 10, age: 0, sources: [{node: anchor, weight: 1, flame: 0, tongue: 0, smoke: 0, phase: Math.random() * 10}], ...extra};
    }

    // One burning spot of a fire, s its strength (about 1 for a missile hit). Sized after the fire-plume laws:
    //  - the burning area is a few metres to ten across;
    //  - Heskestad's flame height L = 0.235 Q^0.4 - 1.02 D comes to 10-20 m for a fuel fire that size;
    //  - the flames puff at about 1.5 / sqrt(D) Hz: a low bed of flame, with tongues that lick up to the
    //    flame height (more of them on each puff), lean with the wind and break off at the tips;
    //  - smoke leaves the flame tips black and dense (burning fuel and paint make thick soot), lit orange from
    //    below at first, rising on its buoyancy, widening as it draws in air and sheared off downwind.
    burn(source, at, s, burning, dt) {
        const r = Math.random;
        const base = .06 * Math.pow(s, .6);
        const across = Math.max(1, base * 2 * 75);
        const puff = .5 + .5 * Math.sin(burning * 1.5 / Math.sqrt(across) * Math.PI * 2 + source.phase);
        const height = .19 * Math.pow(s, .7);
        // The burning bed glows: a low, flickering light where the fuel is, brightest at the roots of the flames.
        // (A flame texture fills about half its square, so sizes here are about twice the visible flame.)
        if (r() < dt * 8) this.spawn({x: at.x + (r() - .5) * base * .6, y: at.y + .015, z: at.z + (r() - .5) * base * .6, ramp: RAMP.TONGUE, frame: FRAME.GLOW, size: base * (2 + r()), life: .22 + r() * .15, drag: 0, intensity: .12 + puff * .08});
        source.flame += dt * 34 * s;
        while (source.flame >= 1) {
            source.flame -= 1;
            const a = r() * Math.PI * 2, d = Math.sqrt(r()) * base;
            this.spawn({x: at.x + Math.cos(a) * d, y: at.y + .004, z: at.z + Math.sin(a) * d, vx: (r() - .5) * .03, vy: .04 + r() * .05, vz: (r() - .5) * .03, ramp: r() < .7 ? RAMP.TONGUE : RAMP.BLAZE, frame: FRAME.FLAME, size: (.09 + r() * .08) * Math.pow(s, .6), life: .22 + r() * .16, drag: 2, lift: .8, cool: .3, wind: .25, turb: .5, rot: (r() - .5) * .3, spin: (r() - .5) * .3, intensity: .7 + r() * .3});
        }
        source.tongue += dt * 26 * s * (.5 + puff);
        while (source.tongue >= 1) {
            source.tongue -= 1;
            const a = r() * Math.PI * 2, d = Math.sqrt(r()) * base * .8;
            this.spawn({x: at.x + Math.cos(a) * d, y: at.y + .01, z: at.z + Math.sin(a) * d, vx: (r() - .5) * .05, vy: height * (1.8 + r() * .9) * (.8 + puff * .4), vz: (r() - .5) * .05, ramp: r() < .8 ? RAMP.TONGUE : RAMP.BLAZE, frame: FRAME.FLAME, size: (.09 + r() * .07) * Math.pow(s, .65), life: .3 + r() * .18, drag: 2.4, lift: 1.2, cool: .25, wind: .5, turb: .7, stretch: .45, intensity: .75 + r() * .3});
        }
        source.smoke += dt * 22 * Math.pow(s, .9);
        while (source.smoke >= 1) {
            source.smoke -= 1;
            // It forms in the upper flames, so fire and plume are one column.
            const top = at.y + height * (.25 + r() * .4);
            const x = at.x + (r() - .5) * base * 1.4, z = at.z + (r() - .5) * base * 1.4;
            // Fed in surges with each puff of the flames, so the plume billows and rolls over itself.
            this.spawn({x, y: top, z, vx: (r() - .5) * .05, vy: .2 + r() * .12 + puff * .08, vz: (r() - .5) * .05, ramp: RAMP.PLUME, frame: FRAME.SMOKE, size: (.2 + r() * .14) * Math.pow(s, .8), life: 15 + r() * 9, drag: .6, lift: .32, cool: 5, wind: 1, turb: .4, spin: (r() - .5) * .4});
            // Now and then a wisp of the plume's underside, right over the flames, still glowing.
            if (r() < .08) this.spawn({x, y: top - height * .3, z, vx: (r() - .5) * .03, vy: .2 + r() * .1, vz: (r() - .5) * .03, ramp: RAMP.SMOKE_FIRE, frame: FRAME.SMOKE, size: (.06 + r() * .04) * Math.pow(s, .8), life: 1 + r() * .5, drag: .6, lift: .3, cool: 2, wind: .8, turb: .4, alpha: .7});
        }
    }

    flash(at, intensity, duration, color) {
        this.flashes.push({position: new THREE.Vector3(at.x, at.y + .3, at.z), intensity, duration, t: 0, color: color || new THREE.Color(1, .7, .4)});
    }

    // A light that rides along with something (a missile's motor), steady until it fades at the end.
    follow(getPosition, intensity, duration, color) {
        this.flashes.push({position: getPosition().clone(), follow: getPosition, steady: true, intensity, duration, t: 0, color: color || new THREE.Color(1, .82, .6)});
    }

    // A vertical launch: fire blows out of the cell and across the deck, and a towering column of dense
    // smoke, lit orange from inside, climbs after the missile and rolls over the bow.
    vlsLaunch(at, scale = 1) {
        const r = Math.random;
        const {x, y, z} = at;
        this.flash(at, 2.2 * scale, 1.1, new THREE.Color(1, .74, .45));
        this.spawn({x, y: y + .1, z, ramp: RAMP.FLASH, frame: FRAME.GLOW, size: .55 * scale, life: .3, drag: 0, intensity: .45});
        this.spawn({x, y: y + .15, z, ramp: RAMP.FLASH, frame: FRAME.FLARE, size: .8 * scale, life: .18, drag: 0, rot: r() * 3, intensity: .5});
        for (let i = 0; i < 30 * scale; i++) {
            const a = r() * Math.PI * 2, spread = r() * .45;
            this.spawn({x: x + Math.cos(a) * .03, y: y + .02, z: z + Math.sin(a) * .03, vx: Math.cos(a) * spread, vy: .6 + r() * 2.2, vz: Math.sin(a) * spread, ramp: RAMP.FIRE, frame: r() < .6 ? FRAME.FLAME : FRAME.SMOKE, size: (.1 + r() * .2) * scale, life: .45 + r() * .5, drag: 2.4, lift: 1.6, cool: .35, turb: .9, intensity: .75});
        }
        // Exhaust deflected off the deck.
        for (let i = 0; i < 20 * scale; i++) {
            const a = r() * Math.PI * 2, speed = 1 + r() * 1.6;
            this.spawn({x, y: y + .02, z, vx: Math.cos(a) * speed, vy: .1 + r() * .3, vz: Math.sin(a) * speed, ramp: RAMP.FIRE, frame: FRAME.FLAME, size: (.06 + r() * .1) * scale, life: .25 + r() * .25, drag: 4.5, intensity: .8});
        }
        // Solid-rocket exhaust is dense white aluminium-oxide smoke. The column is thrown up out of the cell at
        // blast speed and stopped by the air within tens of metres (high drag); then it rises on its own heat,
        // billows in the eddies and drifts downwind for a long time, lit orange by the motor at first.
        for (let i = 0; i < 150 * scale; i++) {
            const a = r() * Math.PI * 2, spread = r() * .35;
            this.spawn({x: x + Math.cos(a) * .05, y: y + .05, z: z + Math.sin(a) * .05, vx: Math.cos(a) * spread, vy: .4 + Math.pow(r(), .5) * 5.5, vz: Math.sin(a) * spread, ramp: RAMP.LAUNCH_SMOKE, frame: FRAME.SMOKE, size: (.13 + r() * .2) * scale, life: 10 + r() * 7, drag: 2.6, lift: .5, cool: 3.5, wind: 1, turb: .45, delay: r() * .7});
        }
        // Exhaust deflected off the deck spreads out across it and rolls over the sides, low and slow to rise.
        for (let i = 0; i < 80 * scale; i++) {
            const a = r() * Math.PI * 2, speed = .6 + r() * 1.8;
            this.spawn({x, y: y + .05, z, vx: Math.cos(a) * speed, vy: .02 + r() * .15, vz: Math.sin(a) * speed, ramp: RAMP.LAUNCH_SMOKE, frame: FRAME.SMOKE, size: (.16 + r() * .24) * scale, life: 8 + r() * 6, drag: 2.2, lift: .25, cool: 5, wind: 1, turb: .35, delay: r() * .35});
        }
        for (let i = 0; i < 30 * scale; i++) {
            const dir = randomDir(.4);
            const speed = 1.5 + r() * 3;
            this.spawn({x, y: y + .05, z, vx: dir.x * speed * .5, vy: dir.y * speed, vz: dir.z * speed * .5, ramp: RAMP.SPARK, frame: FRAME.SPARK, size: .018, life: .5 + r() * .6, drag: 1, lift: -3, stretch: .04, collide: true});
        }
        this.onShake(at, .35 * scale);
    }

    clear() {
        this.count = 0;
        for (const fire of this.fires) if (fire.owned) this.scene.remove(fire.anchor);
        this.fires = [];
        this.pending = [];
        this.blasts = [];
        this.flashes = [];
        this.fireballs?.clear();
        this.debris.clear();
        this.flotsam.clear();
    }

    update(dt, camera) {
        this.time += dt;
        const r = Math.random;
        const world = this.tmp, spot = this.spot || (this.spot = new THREE.Vector3());
        // When the particle pool runs full (a long battle, many ships burning), every fire emits less.
        const load = this.count / CAPACITY;
        const budget = load > .5 ? Math.max(.25, 1 - (load - .5) * 1.8) : 1;
        // Fires: flames lick upward, black smoke climbs and drifts downwind; under water they hiss out.
        const due = this.pending.filter(item => item.at <= this.time);
        if (due.length) {
            this.pending = this.pending.filter(item => item.at > this.time);
            for (const item of due) item.fn();
        }
        for (const fire of this.fires) {
            if (!fire.alive) continue;
            fire.age += dt;
            if (fire.delay && fire.age < fire.delay) continue;
            if (fire.life && fire.age >= fire.life) {
                fire.alive = false;
                if (fire.owned) this.scene.remove(fire.anchor);
                continue;
            }
            fire.anchor.getWorldPosition(world);
            if (world.y < -.015) {
                fire.alive = false;
                this.steam(world, 1.2);
                continue;
            }
            // It takes hold over a few seconds and flares up now and then; spilled fuel dies down at the end.
            const burning = fire.age - (fire.delay || 0);
            const growth = 1 - Math.exp(-burning / 2.2);
            fire.flare = Math.max(0, (fire.flare || 0) - dt * .7);
            if (!fire.life && burning > 2 && r() < dt / 6.5) this.flareUp(fire, world);
            const fade = fire.life ? Math.min(1, (fire.life - fire.age) / 1.5) : 1;
            const s = fire.scale * (.3 + .7 * growth) * fade * (1 + fire.flare * .7);
            fire.level = s / fire.scale;
            for (const source of fire.sources) {
                source.node.getWorldPosition(spot);
                // The part of the fire that has gone under is out.
                if (spot.y < -.015) continue;
                this.burn(source, spot, s * source.weight, burning, dt * budget);
            }
            if (r() < dt * 4 * s) this.spawn({x: world.x + (r() - .5) * .06, y: world.y + .03, z: world.z + (r() - .5) * .06, vx: (r() - .5) * .15, vy: .2 + r() * .25, vz: (r() - .5) * .15, ramp: RAMP.EMBER, frame: FRAME.EMBER, size: .011, life: 2.2 + r() * 1.6, drag: .6, lift: .3, cool: 1, wind: .9, turb: .8});
            // A fire that has burned a while catches the deck beside it (once).
            if (!fire.life && !fire.spread && burning > 9 + fire.seed && fire.anchor.parent && this.fires.length < 40) {
                fire.spread = true;
                const next = new THREE.Object3D();
                next.position.copy(fire.anchor.position).add(new THREE.Vector3((r() - .5) * .16, 0, (r() - .5) * .05));
                fire.anchor.parent.add(next);
                this.fires.push(this.makeFire(next, fire.scale * .65, {spread: true}));
            }
        }
        this.fires = this.fires.filter(f => f.alive);
        for (const blast of this.blasts) {
            blast.t += dt;
            blast.radius = blast.t * 4.5;
        }
        this.blasts = this.blasts.filter(b => b.t < b.duration);
        for (const flash of this.flashes) flash.t += dt;
        this.flashes = this.flashes.filter(f => f.t < f.duration);
        this.assignLights(camera);
        this.simulate(dt, camera);
        this.debris.update(dt);
        this.fireballs?.update(dt);
        this.rings.update(dt);
        this.flotsam.update(dt, this.seaTime ?? this.time);
    }

    assignLights(camera) {
        const requests = [];
        for (const flash of this.flashes) {
            const k = 1 - flash.t / flash.duration;
            if (flash.follow) flash.position.copy(flash.follow());
            const level = flash.steady ? Math.min(1, k * 5) : k * k;
            requests.push({position: flash.position, intensity: flash.intensity * level, color: flash.color, priority: 1000});
        }
        const camPos = camera.position;
        for (const fire of this.fires) {
            if (fire.delay && fire.age < fire.delay) continue;
            const position = fire.anchor.getWorldPosition(new THREE.Vector3());
            position.y += .22;
            const flicker = .72 + .18 * Math.sin(this.time * 13 + fire.seed) + .1 * Math.sin(this.time * 31 + fire.seed * 3);
            requests.push({position, intensity: .45 * fire.scale * flicker * (fire.level ?? .3), color: FIRE_LIGHT, priority: 10 / (1 + position.distanceTo(camPos))});
        }
        requests.sort((a, b) => b.priority - a.priority);
        const glow = this.uniforms.uFires.value;
        for (let i = 0; i < 4; i++) {
            const request = requests[i];
            if (request) glow[i].set(request.position.x, request.position.y, request.position.z, Math.min(2, request.intensity * .3));
            else glow[i].w = 0;
        }
        this.activeLights = [];
        this.lights.forEach((light, i) => {
            const request = requests[i];
            if (!request) {
                light.intensity = 0;
                return;
            }
            light.position.copy(request.position);
            light.color.copy(request.color);
            light.intensity = request.intensity;
            this.activeLights.push(light);
        });
        this.ocean.setLights(this.lights);
    }

    simulate(dt, camera) {
        const p = this.p;
        const t = this.time;
        for (let i = 0; i < this.count; i++) {
            p.age[i] += dt;
            if (p.age[i] < 0) continue;
            if (p.age[i] >= p.life[i]) {
                this.kill(i);
                i--;
                continue;
            }
            const k = i * 3;
            const drag = Math.exp(-p.drag[i] * dt);
            const wind = p.wind[i];
            const swirl = p.swirl[i];
            const seed = p.seed[i];
            let vx = p.vel[k] * drag, vy = p.vel[k + 1] * drag, vz = p.vel[k + 2] * drag;
            // Hot gas rises on its own buoyancy; as it mixes with the air and cools, the lift dies away.
            const cool = p.cool[i];
            vy += (cool > 0 ? p.lift[i] * Math.exp(-p.age[i] / cool) : p.lift[i]) * dt;
            const terminal = p.terminal[i];
            if (terminal > 0) {
                const resist = 1 + dt * Math.max(1, -p.lift[i]) * Math.hypot(vx, vy, vz) / (terminal * terminal);
                vx /= resist; vy /= resist; vz /= resist;
            }
            if (wind) {
                // The wind strengthens with height above the sea (a logarithmic profile), so tall smoke columns
                // and trails lean over and shear.
                const shear = .55 + .45 * Math.log1p(Math.max(0, p.pos[k + 1]) * 3);
                vx += (WIND.x * shear - vx) * wind * dt * .6;
                vz += (WIND.z * shear - vz) * wind * dt * .6;
            }
            const turb = p.turb[i];
            if (turb) {
                curl(p.pos[k] + seed * .011, p.pos[k + 1], p.pos[k + 2], t, CURL);
                vx += CURL.x * turb * dt * .22;
                vy += CURL.y * turb * dt * .13;
                vz += CURL.z * turb * dt * .22;
            }
            if (swirl) {
                const y = p.pos[k + 1];
                vx += Math.sin(y * 7 + t * 1.3 + seed) * swirl * dt * .35;
                vz += Math.cos(y * 6 + t * 1.1 + seed * 1.7) * swirl * dt * .35;
            }
            p.vel[k] = vx; p.vel[k + 1] = vy; p.vel[k + 2] = vz;
            p.pos[k] += vx * dt;
            p.pos[k + 1] += vy * dt;
            p.pos[k + 2] += vz * dt;
            p.rot[i] += p.spin[i] * dt;
            if (p.collide[i] && p.pos[k + 1] < 0 && vy < 0) {
                this.land(i, vy);
                this.kill(i);
                i--;
            }
        }
        for (const o of this.pendingSpawns) this.spawn(o);
        this.pendingSpawns = [];
        // Sort back to front.
        const n = this.count;
        const e = camera.matrixWorldInverse.elements;
        for (let i = 0; i < n; i++) {
            const k = i * 3;
            this.depth[i] = e[2] * p.pos[k] + e[6] * p.pos[k + 1] + e[10] * p.pos[k + 2];
            this.order[i] = i;
        }
        const depth = this.depth;
        const order = this.order.subarray(0, n).sort((a, b) => depth[a] - depth[b]);
        const pos = this.aPos.array, A = this.aA.array, B = this.aB.array, V = this.aVel.array;
        for (let j = 0; j < n; j++) {
            const i = order[j], k = i * 3;
            const life = Math.max(0, p.age[i]) / p.life[i];
            pos[j * 3] = p.pos[k]; pos[j * 3 + 1] = p.pos[k + 1]; pos[j * 3 + 2] = p.pos[k + 2];
            V[j * 3] = p.vel[k]; V[j * 3 + 1] = p.vel[k + 1]; V[j * 3 + 2] = p.vel[k + 2];
            A[j * 4] = p.size[i]; A[j * 4 + 1] = p.rot[i]; A[j * 4 + 2] = life; A[j * 4 + 3] = p.ramp[i];
            B[j * 4] = p.frame[i]; B[j * 4 + 1] = p.age[i] < 0 ? 0 : p.alpha[i]; B[j * 4 + 2] = p.intensity[i]; B[j * 4 + 3] = p.stretch[i];
        }
        for (const attribute of [this.aPos, this.aA, this.aB, this.aVel]) {
            attribute.clearUpdateRanges();
            attribute.addUpdateRange(0, n * attribute.itemSize);
            attribute.needsUpdate = true;
        }
        this.mesh.geometry.instanceCount = n;
    }
}

const FIRE_LIGHT = new THREE.Color(1, .55, .22);

// What each weapon does when it bursts on a ship.
//   gun: a 5-inch or 57 mm high-explosive shell, a sharp, small burst.
//   salvo: 16-inch armour-piercing shells, which burst inside the hull and vent up through the deck.
//   missile / subMissile: a 200 kg warhead plus the unburned propellant in the motor: a rolling fuel fireball,
//     a rain of burning fragments and thick black smoke.
//   strike: the strike jet flown into the ship with its 900 kg bomb and its remaining fuel aboard: the biggest
//     fireball, a second one of burning jet fuel, a column of wreckage and the shock front.
//   secondary: magazines and fuel tanks going up as a ship founders.
const BLASTS = {
    gun: {fuel: .1, smoke: .7, debris: .6, burning: 1, push: .6},
    salvo: {fuel: .3, smoke: 1.2, debris: 1.5, burning: 3, push: 1.1, vent: true},
    missile: {fuel: 1, smoke: 1.35, debris: 1, burning: 4, push: 1},
    subMissile: {fuel: 1, smoke: 1.35, debris: 1, burning: 4, push: 1},
    strike: {fuel: 1.1, smoke: 1.7, debris: 2, burning: 6, push: 1.4},
    secondary: {fuel: 1.2, smoke: 1.2, debris: .9, burning: 3, push: .9},
    torpedo: {fuel: .2, smoke: .9, debris: 1, burning: 1, push: 1.3},
};
// How each ship takes it: fuel and ordnance aboard, armour, what its superstructure is made of.
const HULLS = {
    Carrier: {fuel: 1.4, sparks: 1, ordnance: 1.6, secondary: true},
    Battleship: {fuel: .8, sparks: 1.8, ordnance: 1.2},
    Cruiser: {fuel: 1, sparks: 1, ordnance: 1},
    Destroyer: {fuel: 1, sparks: 1, ordnance: .9},
    Submarine: {fuel: .5, sparks: .7, ordnance: .6, steam: true},
    none: {fuel: 1, sparks: 1, ordnance: 1},
};

function randomDir(upBias = 0) {
    const v = new THREE.Vector3();
    do v.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1); while (v.lengthSq() > 1 || v.lengthSq() < .01);
    v.normalize();
    if (upBias > 0) v.y = Math.abs(v.y) * (1 - upBias) + upBias;
    else if (upBias === 0) {} // any direction
    return v.normalize();
}

// Wreckage thrown by an explosion: torn plates of hull and superstructure, tumbling. Some keep their grey
// paint, some are scorched black; each trails smoke (the burning ones, flame) and splashes down.
const PAINT = [new THREE.Color(0x6e7378), new THREE.Color(0x585d62), new THREE.Color(0x2b2c2e), new THREE.Color(0x1b1b1c)];

class Debris {
    constructor(scene, effects) {
        this.effects = effects;
        // A bent, irregular plate rather than a rock: thin across one axis, jagged at the edges.
        const geometry = new THREE.IcosahedronGeometry(1, 0);
        const positions = geometry.attributes.position;
        for (let i = 0; i < positions.count; i++) {
            const x = positions.getX(i), z = positions.getZ(i);
            positions.setXYZ(i, x * (.7 + Math.random() * .6), positions.getY(i) * (.1 + Math.random() * .1) + x * z * .25, z * (.5 + Math.random() * .7));
        }
        geometry.computeVertexNormals();
        this.mesh = new THREE.InstancedMesh(geometry, new THREE.MeshStandardMaterial({color: 0xffffff, roughness: .7, metalness: .45}), 220);
        this.mesh.setColorAt(0, PAINT[0]);
        this.mesh.castShadow = true;
        this.mesh.frustumCulled = false;
        this.mesh.count = 0;
        scene.add(this.mesh);
        this.items = [];
        this.matrix = new THREE.Matrix4();
        this.quaternion = new THREE.Quaternion();
        this.euler = new THREE.Euler();
    }

    // Some of the wreckage is burning (fuel-soaked, or hot enough to glow): it streaks flame as it flies.
    burst(at, count, scale, burning = 0, momentum = {x: 0, y: 0, z: 0}) {
        for (let i = 0; i < count && this.items.length < 220; i++) {
            const dir = randomDir(.35);
            // Mostly small fragments, a few larger plates.
            const fragmentSize = (.006 + Math.pow(Math.random(), 2.4) * .034) * Math.sqrt(scale);
            // Larger pieces have less speed and less drag per unit mass.
            const speed = (.7 + Math.random() * 1.3) * Math.sqrt(scale) * Math.sqrt(.018 / fragmentSize);
            this.items.push({
                p: new THREE.Vector3(at.x, at.y + .05, at.z), v: dir.multiplyScalar(speed).add(new THREE.Vector3(momentum.x, .6, momentum.z)),
                r: new THREE.Vector3(Math.random() * 6, Math.random() * 6, Math.random() * 6), w: new THREE.Vector3((Math.random() - .5) * 14, (Math.random() - .5) * 14, (Math.random() - .5) * 14),
                s: fragmentSize, drag: .22 * .018 / fragmentSize, age: 0, smokeClock: 0, smoke: Math.random() < .6, fire: i < burning,
                color: PAINT[i < burning ? 2 + (i % 2) : Math.floor(Math.random() * PAINT.length)],
            });
        }
    }

    clear() {
        this.items = [];
        this.mesh.count = 0;
    }

    update(dt) {
        const fx = this.effects;
        this.items = this.items.filter(item => {
            const previous = item.p.clone();
            item.age += dt;
            integrateDrag(item.p, item.v, dt, item.drag, -DEBRIS_GRAVITY);
            const sea = fx.ocean.height(item.p.x, item.p.z, fx.seaTime ?? fx.time);
            const landed = item.p.y <= sea && item.v.y < 0;
            if (landed) {
                const fraction = THREE.MathUtils.clamp((previous.y - sea) / Math.max(1e-6, previous.y - item.p.y), 0, 1);
                item.p.lerpVectors(previous, item.p, fraction);
                item.p.y = sea;
            }
            item.r.addScaledVector(item.w, dt);
            if (item.fire) {
                // A continuous streak of flame and smoke behind it, laid down along the whole of this frame's path.
                const from = previous;
                const length = from.distanceTo(item.p), n = Math.min(10, Math.ceil(length / .012));
                for (let k = 0; k < n; k++) {
                    const f = (k + Math.random()) / n;
                    const x = from.x + (item.p.x - from.x) * f, y = from.y + (item.p.y - from.y) * f, z = from.z + (item.p.z - from.z) * f;
                    fx.spawn({x, y, z, vx: item.v.x * .08, vy: item.v.y * .08, vz: item.v.z * .08, ramp: RAMP.BLAZE, frame: FRAME.FLAME, size: item.s * (.5 + Math.random() * .4), life: .12 + Math.random() * .1, drag: 2, lift: 1, cool: .3, intensity: .9});
                    if (Math.random() < .45) fx.spawn({x, y, z, ramp: RAMP.SMOKE_DARK, frame: FRAME.SMOKE, size: .04, life: 2.2 + Math.random(), drag: 1, lift: .2, cool: 1.5, wind: .6, turb: .3, alpha: .7});
                }
            } else if (item.smoke && (item.smokeClock += dt) >= 1 / 30) {
                item.smokeClock %= 1 / 30;
                fx.spawn({x: item.p.x, y: item.p.y, z: item.p.z, ramp: RAMP.SMOKE_DARK, frame: FRAME.WISP, size: .04, life: 1.1, drag: 1, wind: .4, alpha: .7});
            }
            if (landed) {
                for (let i = 0; i < 8; i++) fx.spawn({x: item.p.x, y: sea + .01, z: item.p.z, vx: (Math.random() - .5) * .4, vy: .8 + Math.random() * .8, vz: (Math.random() - .5) * .4, ramp: RAMP.SPRAY, frame: FRAME.SPRAY, size: .04 + Math.random() * .04, life: .5 + Math.random() * .3, drag: .5, lift: -5, collide: true});
                fx.ocean.addImpact(item.p.x, item.p.z, .18);
                return false;
            }
            return item.age < 12;
        });
        this.items.forEach((item, i) => {
            this.quaternion.setFromEuler(this.euler.set(item.r.x, item.r.y, item.r.z));
            this.matrix.compose(item.p, this.quaternion, new THREE.Vector3(item.s, item.s, item.s));
            this.mesh.setMatrixAt(i, this.matrix);
            this.mesh.setColorAt(i, item.color);
        });
        this.mesh.count = this.items.length;
        this.mesh.instanceMatrix.needsUpdate = true;
        if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    }
}

// Expanding rings: a flat foam-white ring on the water and a faint spherical blast front in the air.
class Shockwaves {
    constructor(scene) {
        this.pool = [];
        const ringMaterial = () => new THREE.ShaderMaterial({
            uniforms: {uProgress: {value: 0}, uStrength: {value: 1}, uAir: {value: 0}},
            vertexShader: /* glsl */`varying vec2 vUv; varying vec3 vNormalV; varying vec3 vView;
                void main() { vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.); vView = -mv.xyz; vNormalV = normalMatrix * normal; gl_Position = projectionMatrix * mv; }`,
            fragmentShader: /* glsl */`uniform float uProgress; uniform float uStrength; uniform float uAir; varying vec2 vUv; varying vec3 vNormalV; varying vec3 vView;
                void main() {
                    float a;
                    if (uAir > .5) {
                        float rim = 1. - abs(dot(normalize(vNormalV), normalize(vView)));
                        a = pow(rim, 3.) * (1. - uProgress) * .55;
                    } else {
                        float r = length(vUv - .5) * 2.;
                        a = exp(-pow((r - .82) / (.07 + uProgress * .1), 2.)) * (1. - uProgress) * (1. - uProgress);
                    }
                    gl_FragColor = vec4(vec3(1., .96, .9) * a * uStrength, 0.);
                }`,
            transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
        });
        for (let i = 0; i < 10; i++) {
            const water = i < 7;
            const mesh = new THREE.Mesh(water ? new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2) : new THREE.SphereGeometry(.5, 24, 16), ringMaterial());
            mesh.material.uniforms.uAir.value = water ? 0 : 1;
            mesh.visible = false;
            mesh.renderOrder = 9;
            mesh.layers.set(NO_REFLECTION_LAYER);
            scene.add(mesh);
            this.pool.push({mesh, water, t: 1, duration: 1, size: 1});
        }
    }

    ring(at, scale, kind) {
        const item = this.pool.filter(p => p.water === (kind === 'water')).sort((a, b) => b.t / b.duration - a.t / a.duration)[0];
        if (!item) return;
        item.t = 0;
        item.duration = kind === 'water' ? 1.1 + scale * .4 : .45;
        item.size = (kind === 'water' ? 2.4 : 1.8) * scale;
        item.mesh.position.set(at.x, kind === 'water' ? .02 : at.y, at.z);
        item.mesh.material.uniforms.uStrength.value = kind === 'water' ? .22 : .08;
        item.mesh.visible = true;
    }

    update(dt) {
        for (const item of this.pool) {
            if (item.t >= item.duration) {
                item.mesh.visible = false;
                continue;
            }
            item.t += dt;
            const k = Math.min(1, item.t / item.duration);
            const scale = item.size * (1 - Math.pow(1 - k, 2.4));
            item.mesh.scale.setScalar(Math.max(.001, scale));
            item.mesh.material.uniforms.uProgress.value = k;
        }
    }
}

// Wreckage left floating where a ship went down.
class Flotsam {
    constructor(scene, ocean) {
        this.ocean = ocean;
        this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, .12, .26), new THREE.MeshStandardMaterial({color: 0x2e2a25, roughness: .92}), 260);
        this.mesh.frustumCulled = false;
        this.mesh.count = 0;
        this.mesh.castShadow = false;
        scene.add(this.mesh);
        this.items = [];
        this.matrix = new THREE.Matrix4();
        this.q = new THREE.Quaternion();
        this.e = new THREE.Euler();
    }

    scatter(center, radius, count) {
        for (let i = 0; i < count && this.items.length < 260; i++) {
            const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * radius;
            this.items.push({x: center.x + Math.cos(a) * d * 1.4, z: center.z + Math.sin(a) * d * .7, yaw: Math.random() * 6, size: .02 + Math.random() * .045, drift: new THREE.Vector2((Math.random() - .5) * .03, (Math.random() - .5) * .03), seed: Math.random() * 10});
        }
    }

    clear() {
        this.items = [];
        this.mesh.count = 0;
    }

    update(dt, time) {
        this.items.forEach((item, i) => {
            item.x += item.drift.x * dt;
            item.z += item.drift.y * dt;
            const y = this.ocean.height(item.x, item.z, time) - item.size * .05;
            this.q.setFromEuler(this.e.set(Math.sin(time + item.seed) * .2, item.yaw, Math.cos(time * .8 + item.seed) * .2));
            this.matrix.compose(new THREE.Vector3(item.x, y, item.z), this.q, new THREE.Vector3(item.size, item.size, item.size));
            this.mesh.setMatrixAt(i, this.matrix);
        });
        this.mesh.count = this.items.length;
        this.mesh.instanceMatrix.needsUpdate = true;
    }
}
