import * as THREE from 'three';
import { DEPTH_GLSL, FX_LAYER } from './postfx.js';
import { integrateDrag } from './impact-physics.js';

// Volumetric fireballs. Each is an ellipsoid the camera ray marches through: turbulent fuel and air whose
// temperature sets its glow (white-yellow at the core of a fresh burst, through orange and dull red as it
// cools) and whose soot absorbs the light behind it. The ball swells to its full size in a fraction of a
// second as the blast is stopped by the air, then rises on its own heat and draws out taller as it climbs.
// Its edge is folded by warped noise into cauliflower billows; the soot is lit from inside by the hot core,
// and as the gas cools the soot thins out into the smoke particles that carry on, instead of lingering as a
// solid ball. The march stops at the scene's depth, so a ship in front hides it and the deck cuts it cleanly.

const vertexShader = /* glsl */`
varying vec3 vWorld;
void main() {
    vec4 world = modelMatrix * vec4(position, 1.);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
}`;

const fragmentShader = /* glsl */`
uniform vec3 uCenter;
uniform float uRadius, uHeat, uDensity, uSeed, uTime, uRoll, uStretch;
uniform vec3 uSunDir, uSunColor, uAmbient;
uniform sampler2D uDepth;
uniform vec2 uScreen;
uniform float uSoft, uNear, uFar;
varying vec3 vWorld;
${DEPTH_GLSL}
float hash(vec3 p) { p = fract(p * .3183099 + .1); p *= 17.; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise(vec3 x) {
    vec3 i = floor(x), f = fract(x);
    f = f * f * (3. - 2. * f);
    return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float fbm(vec3 p) { return noise(p) * .55 + noise(p * 2.07 + 3.1) * .28 + noise(p * 4.31 + 7.7) * .17; }
// Blackbody-like glow for a temperature in 0..1 (dull red, orange, yellow, white), in HDR so it blooms.
vec3 glow(float t) {
    vec3 c = mix(vec3(.3, .03, .0), vec3(1., .32, .04), smoothstep(.0, .38, t));
    c = mix(c, vec3(1., .72, .3), smoothstep(.38, .72, t));
    c = mix(c, vec3(1., .95, .8), smoothstep(.72, 1., t));
    return c * (.4 + 9. * t * t);
}
void main() {
    vec3 ro = cameraPosition, rd = normalize(vWorld - cameraPosition);
    // The ray against the ellipsoid: squash the vertical so it becomes a sphere.
    vec3 squash = vec3(1., 1. / uStretch, 1.);
    vec3 oc = (ro - uCenter) * squash, rs = rd * squash;
    float qa = dot(rs, rs), b = dot(oc, rs), c = dot(oc, oc) - uRadius * uRadius, h = b * b - qa * c;
    if (h < 0.) discard;
    h = sqrt(h);
    float t0 = max((-b - h) / qa, 0.), t1 = (-b + h) / qa;
    if (uSoft > .5) {
        vec3 forward = -vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
        float sceneZ = -viewZFromDepth(texture2D(uDepth, gl_FragCoord.xy / uScreen).x, uNear, uFar);
        t1 = min(t1, sceneZ / max(dot(rd, forward), 1e-3));
    }
    if (t1 <= t0) discard;
    const int STEPS = 22;
    float dt = (t1 - t0) / float(STEPS);
    float transmit = 1.;
    vec3 light = vec3(0.);
    float jitter = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
    for (int i = 0; i < STEPS; i++) {
        vec3 p = ro + rd * (t0 + (float(i) + jitter) * dt);
        vec3 q = (p - uCenter) / uRadius * squash;
        float r = length(q);
        // The flow is warped by a coarser field before the billows are read from it, so the edge folds into
        // rolls and cauliflower lobes instead of a noisy sphere; it all rolls upward as the hot core rises.
        vec3 w = q * 1.6 + vec3(uSeed, -uSeed * .6, uSeed * .3) - vec3(0., uRoll * .6, 0.);
        vec3 warp = vec3(noise(w), noise(w + 5.2), noise(w + 9.7)) - .5;
        vec3 flow = q * 2.6 + warp * 1.5 + vec3(uSeed, uSeed * .7, -uSeed) + vec3(0., -uRoll, 0.) + q.yzx * .35 * sin(uRoll);
        float n = fbm(flow);
        float lumps = fbm(q * 5.3 + warp * 2.2 + uSeed * 1.7 - vec3(0., uRoll * 1.4, 0.));
        float shape = (1. - smoothstep(.28, 1., r + (n - .5) * 1.15 + (lumps - .5) * .6))
                    * (1. - smoothstep(.85, 1., r));
        // As it cools the soot thins: the remnant is smoke you can partly see through, not a black ball.
        float density = shape * (.4 + n) * uDensity * (.28 + .72 * smoothstep(.02, .3, uHeat));
        if (density < .01) continue;
        // Hottest at the core and while fresh; the outside cools first.
        float temp = clamp(uHeat * (1.3 - r * 1.1) * (.35 + n * 1.25) * (.7 + lumps * .6), 0., 1.);
        // Soot is brown-black, lit by the sun on its outer side and from within by the burning core.
        float sunTerm = clamp(dot(normalize(q + 1e-4), uSunDir) * .5 + .5, 0., 1.);
        vec3 inner = vec3(1., .42, .12) * uHeat * 2.2 * (1. - smoothstep(.2, 1., r)) * (.5 + n);
        vec3 soot = mix(vec3(.09, .08, .07), vec3(.2, .17, .14), lumps) * (uAmbient * .9 + uSunColor * sunTerm * .7 + inner);
        // Cooler soot veils the hot pockets; the entire ball never glows uniformly.
        float hotPocket = smoothstep(.36, .7, n + lumps * .22);
        vec3 emit = glow(temp) * smoothstep(.12, .3, temp) * hotPocket + soot;
        float a = 1. - exp(-density * dt / uRadius * 7.);
        light += transmit * a * emit;
        transmit *= 1. - a;
        if (transmit < .02) break;
    }
    float alpha = 1. - transmit;
    if (alpha < .003) discard;
    gl_FragColor = vec4(light, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}`;

export class Fireballs {
    constructor(scene, {env, depth, screen}) {
        this.items = [];
        this.pool = [];
        const geometry = new THREE.IcosahedronGeometry(1, 3);
        for (let i = 0; i < 6; i++) {
            const material = new THREE.ShaderMaterial({
                vertexShader, fragmentShader, transparent: true, depthWrite: false, side: THREE.BackSide,
                blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
                uniforms: {
                    uCenter: {value: new THREE.Vector3()}, uRadius: {value: 1}, uHeat: {value: 1}, uDensity: {value: 1}, uSeed: {value: 0}, uTime: {value: 0}, uRoll: {value: 0}, uStretch: {value: 1},
                    uSunDir: {value: env.sun}, uSunColor: {value: env.particleSun}, uAmbient: {value: new THREE.Color(.3, .35, .44)},
                    uDepth: depth, uScreen: screen, uSoft: {value: 1}, uNear: {value: .1}, uFar: {value: 9000},
                },
            });
            const mesh = new THREE.Mesh(geometry, material);
            mesh.visible = false;
            mesh.frustumCulled = false;
            mesh.renderOrder = 11;
            mesh.layers.set(FX_LAYER);
            scene.add(mesh);
            this.pool.push(mesh);
        }
    }

    // A burst of the given final radius (world units) at a point. heat: 1 for a warhead, less for a fuel flash.
    // stretch: how much taller than wide it draws out as it rises (0 keeps it round).
    spawn(at, radius, {heat = 1, life = 2.1, rise = .5, velocity = {x: 0, y: 0, z: 0}, cooling = .42, stretch = .45} = {}) {
        const mesh = this.pool.find(m => !m.visible) || this.items.sort((a, b) => b.t - a.t)[0]?.mesh;
        if (!mesh) return;
        this.items = this.items.filter(item => item.mesh !== mesh);
        mesh.visible = true;
        const item = {mesh, center: new THREE.Vector3(at.x, at.y, at.z), radius, heat, life, rise, cooling, stretch, t: 0, velocity: new THREE.Vector3(velocity.x, velocity.y, velocity.z), seed: Math.random() * 40};
        this.items.push(item);
        this.present(item);
    }

    setSoft(on) {
        for (const mesh of this.pool) mesh.material.uniforms.uSoft.value = on ? 1 : 0;
    }

    clear() {
        for (const item of this.items) item.mesh.visible = false;
        this.items = [];
    }

    update(dt) {
        this.items = this.items.filter(item => {
            item.t += dt;
            const k = item.t / item.life;
            if (k >= 1) {
                item.mesh.visible = false;
                return false;
            }
            // Thrown out at blast speed and stopped by the air within a fraction of a second; then buoyancy
            // lifts it, more slowly as it cools and mixes.
            integrateDrag(item.center, item.velocity, dt, 1.8, item.rise * Math.exp(-(item.t - dt * .5) / .8));
            this.present(item);
            return true;
        });
    }

    present(item) {
        const k = item.t / item.life;
        const grow = 1 - Math.exp(-item.t / .065);
        const radius = item.radius * (.12 + .88 * grow) * (1 + Math.sqrt(item.t) * .22);
        const u = item.mesh.material.uniforms;
        u.uCenter.value.copy(item.center);
        u.uRadius.value = radius;
        u.uHeat.value = item.heat * Math.exp(-item.t / item.cooling);
        u.uDensity.value = (1 - Math.pow(k, 2)) * 1.6 / (1 + item.t * .35);
        u.uSeed.value = item.seed;
        u.uRoll.value = item.t * 1.3;
        // Rising gas draws out vertically: a buoyant thermal is taller than wide within a second or so.
        const stretch = 1 + item.stretch * (1 - Math.exp(-item.t / .7));
        u.uStretch.value = stretch;
        item.mesh.position.copy(item.center);
        item.mesh.scale.set(radius * 1.02, radius * stretch * 1.02, radius * 1.02);
    }
}
