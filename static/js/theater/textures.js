import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

// Every texture in the theater is generated here, so the game ships no image assets. Patterns that need a
// lot of noise (ocean normals, foam, smoke sprites, grime) are baked once on the GPU into render targets;
// text and deck markings are drawn with the 2D canvas.

export const GLSL_NOISE = /* glsl */`
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
// Gradient noise that repeats every 'period' lattice cells, in about [-0.7, 0.7].
float gnoise(vec2 p, vec2 period) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * f * (f * (f * 6. - 15.) + 10.);
    float a = dot(hash22(mod(i, period)) * 2. - 1., f);
    float b = dot(hash22(mod(i + vec2(1., 0.), period)) * 2. - 1., f - vec2(1., 0.));
    float c = dot(hash22(mod(i + vec2(0., 1.), period)) * 2. - 1., f - vec2(0., 1.));
    float d = dot(hash22(mod(i + vec2(1., 1.), period)) * 2. - 1., f - vec2(1., 1.));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p, vec2 period, int octaves) {
    float sum = 0., amp = .5;
    for (int i = 0; i < 8; i++) {
        if (i >= octaves) break;
        sum += amp * gnoise(p, period);
        p = p * 2. + vec2(13.7, 7.1); period *= 2.; amp *= .5;
    }
    return sum;
}
`;

const FULLSCREEN_VERTEX = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }
`;

function bake(renderer, width, height, fragmentShader, {uniforms = {}, wrap = THREE.RepeatWrapping, mipmaps = true, type = THREE.UnsignedByteType} = {}) {
    const target = new THREE.WebGLRenderTarget(width, height, {
        type, depthBuffer: false, wrapS: wrap, wrapT: wrap, generateMipmaps: mipmaps,
        minFilter: mipmaps ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter, magFilter: THREE.LinearFilter,
    });
    const material = new THREE.ShaderMaterial({vertexShader: FULLSCREEN_VERTEX, fragmentShader: GLSL_NOISE + fragmentShader, uniforms, depthTest: false, depthWrite: false});
    const quad = new FullScreenQuad(material);
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    quad.render(renderer);
    renderer.setRenderTarget(previous);
    quad.dispose();
    material.dispose();
    target.texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    return target.texture;
}

// Tileable ocean detail: a few dozen directional swells with integer wave vectors (so the tile repeats
// seamlessly) shaped by an ocean-like spectrum, plus gradient-noise chop. RGB holds the normal, A the height.
export function oceanNormalMap(renderer, wind = new THREE.Vector2(1, .35).normalize()) {
    const count = 48;
    const waves = [];
    const random = mulberry32(7);
    const windAngle = Math.atan2(wind.y, wind.x);
    for (let i = 0; i < count; i++) {
        const magnitude = 2 + Math.floor(Math.pow(random(), 1.7) * 30);
        const angle = windAngle + (random() - .5) * 2.2;
        const kx = Math.round(Math.cos(angle) * magnitude), ky = Math.round(Math.sin(angle) * magnitude);
        if (!kx && !ky) continue;
        const k = Math.hypot(kx, ky);
        waves.push(new THREE.Vector4(kx, ky, Math.pow(k, -1.45) * (.7 + random() * .6), random() * Math.PI * 2));
    }
    while (waves.length < count) waves.push(new THREE.Vector4(1, 0, 0, 0));
    return bake(renderer, 1024, 1024, /* glsl */`
        uniform vec4 waves[${count}];
        varying vec2 vUv;
        void main() {
            float h = 0.; vec2 d = vec2(0.);
            for (int i = 0; i < ${count}; i++) {
                vec4 w = waves[i];
                float phase = 6.2831853 * dot(w.xy, vUv) + w.w;
                h += w.z * sin(phase);
                d += w.z * 6.2831853 * w.xy * cos(phase);
            }
            // Fine chop from tileable noise, differentiated numerically.
            float e = 1. / 1024.;
            float n0 = fbm(vUv * 24., vec2(24.), 4);
            float nx = fbm((vUv + vec2(e, 0.)) * 24., vec2(24.), 4);
            float ny = fbm((vUv + vec2(0., e)) * 24., vec2(24.), 4);
            d += vec2(nx - n0, ny - n0) / e * .0022;
            h += n0 * .02;
            vec3 n = normalize(vec3(-d.x * .012, 1., -d.y * .012));
            gl_FragColor = vec4(n.x * .5 + .5, n.z * .5 + .5, n.y, h * 2. + .5);
        }
    `, {uniforms: {waves: {value: waves}}});
}

// Tileable foam: bubbly Voronoi edges (R), a soft coverage field (G) and fine grain (B).
export function foamTexture(renderer) {
    return bake(renderer, 512, 512, /* glsl */`
        varying vec2 vUv;
        vec2 voronoi(vec2 p, float period) {
            vec2 i = floor(p), f = fract(p);
            float f1 = 8., f2 = 8.;
            for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
                vec2 g = vec2(float(x), float(y));
                vec2 o = hash22(mod(i + g, period));
                float dist = length(g + o - f);
                if (dist < f1) { f2 = f1; f1 = dist; } else if (dist < f2) f2 = dist;
            }
            return vec2(f1, f2);
        }
        void main() {
            vec2 v1 = voronoi(vUv * 18., 18.);
            vec2 v2 = voronoi(vUv * 42. + 3.7, 42.);
            float cells = smoothstep(.0, .22, v1.y - v1.x);
            float fine = smoothstep(.0, .25, v2.y - v2.x);
            float bubbles = (1. - cells) * .7 + (1. - fine) * .45;
            float coverage = fbm(vUv * 6., vec2(6.), 5) + .5;
            float grain = fbm(vUv * 64., vec2(64.), 3) + .5;
            gl_FragColor = vec4(clamp(bubbles, 0., 1.), coverage, grain, 1.);
        }
    `);
}

// Tileable paint wear for ships: R blotches, G vertical rust streaks, B fine grain, A rust spots.
export function grimeTexture(renderer) {
    return bake(renderer, 512, 512, /* glsl */`
        varying vec2 vUv;
        void main() {
            float blotch = fbm(vUv * 5., vec2(5.), 6) + .5;
            float streak = fbm(vec2(vUv.x * 48., vUv.y * 3.), vec2(48., 3.), 4) + .5;
            float grain = fbm(vUv * 96., vec2(96.), 3) + .5;
            float spots = smoothstep(.62, .78, fbm(vUv * 22. + 4.1, vec2(22.), 4) + .5);
            gl_FragColor = vec4(blotch, streak, grain, spots);
        }
    `);
}

// The particle atlas: 4 × 4 frames of 512 px. Frames 0–3 smoke, 4–5 flame, 6 glow, 7 spark, 8 spray,
// 9 water column, 10 ring, 11 flare, 12–13 wisps, 14 ember, 15 bubble. RGB is self-shading, A coverage.
export function particleAtlas(renderer) {
    return bake(renderer, 2048, 2048, /* glsl */`
        varying vec2 vUv;
        const vec2 NP = vec2(1e4);
        float smokeField(vec2 q, float s) {
            vec2 w = vec2(fbm(q * 1.7 + s, NP, 4), fbm(q * 1.7 + s + 5.2, NP, 4));
            float n = fbm(q * 2.6 + w * 1.6 + s, NP, 6);
            float billow = 1. - abs(gnoise(q * 4.4 + w * 2.2 + s * 1.7, NP)) * 1.6;
            return n + billow * .18;
        }
        void main() {
            vec2 cell = floor(vUv * 4.);
            float frame = cell.x + cell.y * 4.;
            vec2 p = fract(vUv * 4.);
            vec2 q = p * 2. - 1.;
            float r = length(q);
            float s = frame * 17.31;
            vec4 color = vec4(0.);
            if (frame < 3.5 || (frame > 11.5 && frame < 13.5)) {
                vec2 qq = frame > 11.5 ? vec2(q.x * .75, q.y * 1.35) : q;
                float n = smokeField(qq, s);
                float e = .012;
                float nx = smokeField(qq + vec2(e, 0.), s), ny = smokeField(qq + vec2(0., e), s);
                float edge = length(qq) + (.25 - n) * .62;
                float mask = smoothstep(.98, .38, edge);
                float density = mask * clamp(.55 + n * 1.2, 0., 1.);
                vec3 normal = normalize(vec3(-(nx - n) / e, -(ny - n) / e, 2.4));
                float light = clamp(dot(normal, normalize(vec3(-.45, .65, .62))), 0., 1.);
                float shade = clamp(.42 + light * .5 + n * .35, 0., 1.);
                color = vec4(vec3(shade), density);
            } else if (frame < 5.5) {
                float n = fbm(vec2(q.x * 2.4, q.y * 1.6 - s), NP, 5);
                vec2 fq = vec2(q.x * (1.45 + q.y * .55), q.y * .85 + .18);
                float d = length(fq) + n * .55;
                float mask = smoothstep(.95, .25, d);
                float core = smoothstep(.75, .05, d);
                color = vec4(vec3(.55 + core * .45), mask);
            } else if (frame < 6.5) {
                color = vec4(1., 1., 1., exp(-r * r * 4.2));
            } else if (frame < 7.5) {
                color = vec4(1., 1., 1., exp(-(q.x * q.x * 1.6 + q.y * q.y * 55.)));
            } else if (frame < 8.5) {
                float dots = 0.;
                for (int y = 0; y < 10; y++) for (int x = 0; x < 10; x++) {
                    vec2 id = vec2(float(x), float(y));
                    vec2 c = (id + hash22(id + s)) / 10. * 2. - 1.;
                    float size = .012 + hash12(id * 3.1) * .045;
                    dots += smoothstep(size, size * .3, length(q - c)) * step(.35, hash12(id + 9.));
                }
                float mist = fbm(q * 3. + s, NP, 4) + .5;
                float mask = smoothstep(1., .25, r + (mist - .5) * .4);
                color = vec4(vec3(.85 + mist * .15), clamp(dots + mist * .35, 0., 1.) * mask);
            } else if (frame < 9.5) {
                float n = fbm(vec2(q.x * 5., q.y * 1.4 + s), NP, 5);
                float column = smoothstep(.9, .15, abs(q.x) * 1.25 + n * .45);
                float top = smoothstep(1., .35, q.y + n * .8);
                float bottom = smoothstep(-1., -.75, q.y);
                color = vec4(vec3(.7 + n * .5), column * top * bottom);
            } else if (frame < 10.5) {
                float n = fbm(q * 6. + s, NP, 3);
                color = vec4(1., 1., 1., exp(-pow((r - .72 + n * .06) / .085, 2.)));
            } else if (frame < 11.5) {
                float rays = max(0., 1. - abs(q.x) * 30.) * exp(-abs(q.y) * 2.5) + max(0., 1. - abs(q.y) * 30.) * exp(-abs(q.x) * 2.5);
                color = vec4(1., 1., 1., clamp(exp(-r * r * 7.) + rays * .55, 0., 1.));
            } else if (frame < 14.5) {
                color = vec4(1., 1., 1., smoothstep(.55, .2, r));
            } else {
                float ring = exp(-pow((r - .7) / .1, 2.)) * .8 + smoothstep(.35, .1, length(q - vec2(-.3, .32))) * .9;
                color = vec4(1., 1., 1., clamp(ring + smoothstep(.75, .0, r) * .12, 0., 1.));
            }
            gl_FragColor = color;
        }
    `, {wrap: THREE.ClampToEdgeWrapping});
}

// Color over life for each particle kind. Each ramp is two rows of the texture: rgb + alpha, then
// (additive, size multiplier, emissive / 10, water fade).
export function rampTexture(ramps) {
    const width = 64;
    const rows = ramps.length * 2;
    const data = new Uint8Array(width * rows * 4);
    const sample = (stops, t) => {
        let i = 0;
        while (i < stops.length - 2 && stops[i + 1][0] < t) i++;
        const a = stops[i], b = stops[Math.min(i + 1, stops.length - 1)];
        const k = b[0] === a[0] ? 0 : THREE.MathUtils.clamp((t - a[0]) / (b[0] - a[0]), 0, 1);
        return a.map((value, index) => value + (b[index] - value) * k);
    };
    ramps.forEach((stops, index) => {
        for (let x = 0; x < width; x++) {
            const v = sample(stops, x / (width - 1));
            const top = ((index * 2) * width + x) * 4, bottom = ((index * 2 + 1) * width + x) * 4;
            data.set([v[1], v[2], v[3], v[4]].map(c => Math.round(THREE.MathUtils.clamp(c, 0, 1) * 255)), top);
            data.set([v[5], v[6] / 2, v[7] / 10, v[8]].map(c => Math.round(THREE.MathUtils.clamp(c, 0, 1) * 255)), bottom);
        }
    });
    const texture = new THREE.DataTexture(data, width, rows, THREE.RGBAFormat);
    texture.magFilter = texture.minFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    return texture;
}

export function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export function hashString(text) {
    let h = 2166136261;
    for (const char of text) h = Math.imul(h ^ char.charCodeAt(0), 16777619);
    return h >>> 0;
}

function canvas(width, height) {
    const element = document.createElement('canvas');
    element.width = width;
    element.height = height;
    return [element, element.getContext('2d')];
}

function canvasTexture(element, {srgb = true, repeat = false, anisotropy = 8} = {}) {
    const texture = new THREE.CanvasTexture(element);
    if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
    if (repeat) texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = anisotropy;
    return texture;
}

function speckle(context, width, height, count, colors, random, size = [1, 3]) {
    for (let i = 0; i < count; i++) {
        context.fillStyle = colors[Math.floor(random() * colors.length)];
        const s = size[0] + random() * (size[1] - size[0]);
        context.globalAlpha = .08 + random() * .18;
        context.fillRect(random() * width, random() * height, s, s);
    }
    context.globalAlpha = 1;
}

// A painted steel deck with non-skid grain, stains and a helicopter landing spot near the stern.
// u runs stern → bow along the canvas width, v port → starboard down its height.
export function steelDeckTexture({helo = null, seed = 1, tone = '#4b4f54'} = {}) {
    const [element, context] = canvas(1024, 256);
    const random = mulberry32(seed);
    context.fillStyle = tone;
    context.fillRect(0, 0, 1024, 256);
    speckle(context, 1024, 256, 9000, ['#2f3236', '#5c6167', '#3a3d41'], random);
    for (let i = 0; i < 26; i++) {
        const gradient = context.createRadialGradient(0, 0, 0, 0, 0, 1);
        gradient.addColorStop(0, 'rgba(20,20,22,.22)');
        gradient.addColorStop(1, 'rgba(20,20,22,0)');
        context.save();
        context.translate(random() * 1024, random() * 256);
        context.scale(20 + random() * 60, 8 + random() * 26);
        context.fillStyle = gradient;
        context.beginPath();
        context.arc(0, 0, 1, 0, Math.PI * 2);
        context.fill();
        context.restore();
    }
    context.strokeStyle = 'rgba(15,16,18,.35)';
    context.lineWidth = 1;
    for (let x = 0; x < 1024; x += 64) {
        context.beginPath();
        context.moveTo(x + .5, 0);
        context.lineTo(x + .5, 256);
        context.stroke();
    }
    if (helo) {
        const [u0, u1] = helo;
        const cx = (u0 + u1) / 2 * 1024, w = (u1 - u0) * 1024;
        context.strokeStyle = 'rgba(240,240,235,.92)';
        context.lineWidth = 5;
        context.strokeRect(u0 * 1024 + 8, 22, w - 16, 212);
        context.beginPath();
        context.arc(cx, 128, Math.min(w, 212) * .32, 0, Math.PI * 2);
        context.stroke();
        context.strokeStyle = 'rgba(245,200,40,.95)';
        context.lineWidth = 4;
        context.beginPath();
        context.moveTo(u0 * 1024 + 8, 128);
        context.lineTo(u1 * 1024 - 8, 128);
        context.stroke();
    }
    return canvasTexture(element);
}

// Teak planking for the battleship, laid fore and aft with staggered butt joints.
export function teakDeckTexture(seed = 3) {
    const [element, context] = canvas(2048, 256);
    const random = mulberry32(seed);
    const plank = 9;
    for (let y = 0; y < 256; y += plank) {
        let x = -random() * 300;
        while (x < 2048) {
            const length = 180 + random() * 260;
            const tone = 120 + random() * 34;
            context.fillStyle = `rgb(${tone + 22}, ${tone - 6}, ${tone - 46})`;
            context.fillRect(x, y, length, plank);
            for (let g = 0; g < 6; g++) {
                context.fillStyle = `rgba(70, 45, 25, ${.05 + random() * .08})`;
                context.fillRect(x, y + random() * plank, length, .6 + random());
            }
            context.fillStyle = 'rgba(35,24,15,.75)';
            context.fillRect(x, y, 1.4, plank);
            x += length;
        }
        context.fillStyle = 'rgba(30,22,14,.85)';
        context.fillRect(0, y, 2048, 1.3);
    }
    speckle(context, 2048, 256, 6000, ['#3b2a1c', '#c9a77e'], random);
    return canvasTexture(element);
}

// The carrier's flight deck seen from above. Coordinates come from the deck outline in ship units so
// the markings line up with the angled deck, elevators and island.
export function flightDeckTexture({bounds, outline, mascot = null, seed = 5}) {
    const W = 2048, H = 512;
    const [element, context] = canvas(W, H);
    const random = mulberry32(seed);
    const toX = x => (x - bounds.minX) / (bounds.maxX - bounds.minX) * W;
    const toY = z => (z - bounds.minZ) / (bounds.maxZ - bounds.minZ) * H;
    const sx = W / (bounds.maxX - bounds.minX);
    context.fillStyle = '#3d4044';
    context.fillRect(0, 0, W, H);
    speckle(context, W, H, 26000, ['#2a2c2f', '#55595e', '#34373a'], random);
    // Rubber and oil along the landing area.
    context.save();
    context.translate(toX(-1.4), toY(-0.12));
    context.rotate(-.16);
    for (let i = 0; i < 160; i++) {
        context.fillStyle = `rgba(12,12,13,${.05 + random() * .12})`;
        context.fillRect(random() * sx * 2.2, (random() - .5) * 60, 30 + random() * 120, 1.5 + random() * 3);
    }
    context.restore();
    // Deck edge lines.
    context.strokeStyle = 'rgba(235,235,230,.85)';
    context.lineWidth = 4;
    context.setLineDash([]);
    context.beginPath();
    outline.forEach(([x, z], i) => (i ? context.lineTo(toX(x) * .985 + W * .0075, toY(z) * .96 + H * .02) : context.moveTo(toX(x) * .985 + W * .0075, toY(z) * .96 + H * .02)));
    context.closePath();
    context.stroke();
    // Angled landing area: boundary lines, dashed centerline, arresting wires.
    const angle = -.16;
    const landing = (fn) => { context.save(); context.translate(toX(-2.3), toY(-0.02)); context.rotate(angle); fn(); context.restore(); };
    landing(() => {
        context.strokeStyle = 'rgba(240,240,236,.9)';
        context.lineWidth = 4;
        context.setLineDash([26, 18]);
        for (const offset of [-48, 48]) {
            context.beginPath();
            context.moveTo(0, offset);
            context.lineTo(sx * 2.9, offset);
            context.stroke();
        }
        context.strokeStyle = 'rgba(250,206,40,.95)';
        context.setLineDash([40, 26]);
        context.lineWidth = 5;
        context.beginPath();
        context.moveTo(0, 0);
        context.lineTo(sx * 3.1, 0);
        context.stroke();
        context.setLineDash([]);
        context.strokeStyle = 'rgba(30,30,32,.9)';
        context.lineWidth = 3;
        for (let i = 0; i < 4; i++) {
            const x = sx * (.55 + i * .13);
            context.beginPath();
            context.moveTo(x, -52);
            context.lineTo(x, 52);
            context.stroke();
        }
    });
    // Main-deck yellow centerline and the bow catapults.
    context.setLineDash([34, 20]);
    context.strokeStyle = 'rgba(250,206,40,.85)';
    context.lineWidth = 4;
    context.beginPath();
    context.moveTo(toX(.2), toY(.08));
    context.lineTo(toX(2.35), toY(.08));
    context.stroke();
    context.setLineDash([]);
    context.strokeStyle = 'rgba(25,25,27,.95)';
    context.lineWidth = 3;
    for (const z of [-.06, .2]) {
        context.beginPath();
        context.moveTo(toX(1.05), toY(z));
        context.lineTo(toX(2.36), toY(z * .7));
        context.stroke();
    }
    // Elevators.
    context.strokeStyle = 'rgba(250,206,40,.75)';
    context.lineWidth = 3;
    context.setLineDash([10, 8]);
    for (const [x, z, w, d] of [[.95, .28, .32, .22], [.35, .28, .32, .22], [-1.25, .28, .32, .22], [-.75, -.5, .3, .2]]) {
        context.strokeRect(toX(x), toY(z), w * sx, d / (bounds.maxZ - bounds.minZ) * H);
    }
    context.setLineDash([]);
    // The fleet's mascot, painted on the bow in thin white deck lines (read from aft, as deck markings are).
    if (mascot) {
        const art = mascotLineArt(mascot, 290);
        context.save();
        context.translate(toX(1.86), toY(-.04));
        context.rotate(Math.PI / 2);
        context.globalAlpha = .92;
        context.drawImage(art, -art.width / 2, -art.height / 2);
        context.restore();
    }
    return canvasTexture(element);
}

// A mascot as minimal white line art on a transparent square canvas of the given size: the outline of its
// silhouette plus a few interior lines (eyes, the visor, the prompt on the chest).
export function mascotLineArt(kind, size = 320) {
    const line = Math.max(3, size / 64);
    const white = 'rgba(244,244,238,1)';
    // Outline of a filled shape: grow it by the line width, then cut the shape itself out, leaving a ring.
    const outline = (drawShape) => {
        const [mask, m] = canvas(size, size);
        m.fillStyle = m.strokeStyle = white;
        m.lineJoin = 'round';
        m.lineWidth = line * 2;
        drawShape(m, true);
        m.globalCompositeOperation = 'destination-out';
        drawShape(m, false);
        return mask;
    };
    const [element, context] = canvas(size, size);
    const u = size / 100;
    context.strokeStyle = context.fillStyle = white;
    context.lineWidth = line;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    if (kind === 'claude') {
        // A wide block of a body with stubby arms out to the sides, square eyes and four short legs.
        context.drawImage(outline((m, grow) => {
            const shape = () => {
                m.beginPath();
                m.rect(16 * u, 14 * u, 68 * u, 52 * u);
                m.rect(5 * u, 30 * u, 12 * u, 14 * u);
                m.rect(83 * u, 30 * u, 12 * u, 14 * u);
                for (const x of [22, 32, 60, 70]) m.rect(x * u, 65 * u, 7 * u, 20 * u);
            };
            shape();
            m.fill();
            if (grow) m.stroke();
        }), 0, 0);
        for (const x of [29, 63]) context.fillRect(x * u, 26 * u, 8 * u, 8 * u);
    } else {
        // A cloud for a head, a rounded visor with two closed, smiling eyes, a small body with a prompt on it,
        // little arms and feet.
        const puffs = [[50, 30, 21], [31, 36, 16], [69, 36, 16], [25, 50, 13], [75, 50, 13], [38, 22, 13], [62, 22, 13], [50, 52, 18]];
        const body = (m) => {
            m.moveTo(36 * u, 62 * u);
            m.roundRect(36 * u, 62 * u, 28 * u, 22 * u, 9 * u);
            m.roundRect(27 * u, 64 * u, 9 * u, 13 * u, 4 * u);
            m.roundRect(64 * u, 64 * u, 9 * u, 13 * u, 4 * u);
            m.roundRect(39 * u, 82 * u, 9 * u, 9 * u, 3 * u);
            m.roundRect(52 * u, 82 * u, 9 * u, 9 * u, 3 * u);
        };
        context.drawImage(outline((m, grow) => {
            m.beginPath();
            for (const [x, y, r] of puffs) { m.moveTo((x + r) * u, y * u); m.arc(x * u, y * u, r * u, 0, Math.PI * 2); }
            body(m);
            m.fill();
            if (grow) m.stroke();
        }), 0, 0);
        context.beginPath();
        context.roundRect(30 * u, 33 * u, 40 * u, 21 * u, 7 * u);
        context.stroke();
        for (const x of [40, 60]) {
            context.beginPath();
            context.arc(x * u, 41 * u, 4.5 * u, Math.PI * .15, Math.PI * .85);
            context.stroke();
        }
        context.beginPath();
        context.moveTo(44 * u, 70 * u); context.lineTo(48 * u, 73 * u); context.lineTo(44 * u, 76 * u);
        context.moveTo(51 * u, 76 * u); context.lineTo(56 * u, 76 * u);
        context.stroke();
    }
    return element;
}

export function hullNumberTexture(code) {
    const [element, context] = canvas(256, 128);
    context.font = 'bold 92px "Helvetica Neue", Arial, sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.lineWidth = 7;
    context.strokeStyle = 'rgba(25,27,30,.85)';
    context.strokeText(code, 128, 68);
    context.fillStyle = '#f2f2ee';
    context.fillText(code, 128, 68);
    return canvasTexture(element);
}

export function vlsTexture() {
    const [element, context] = canvas(256, 128);
    context.fillStyle = '#3b3f44';
    context.fillRect(0, 0, 256, 128);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 8; x++) {
        context.fillStyle = '#4f545a';
        context.fillRect(x * 32 + 3, y * 32 + 3, 26, 26);
        context.strokeStyle = '#25282c';
        context.lineWidth = 2;
        context.strokeRect(x * 32 + 3, y * 32 + 3, 26, 26);
        context.fillStyle = '#2c2f33';
        context.fillRect(x * 32 + 13, y * 32 + 13, 6, 6);
    }
    return canvasTexture(element);
}

export function railTexture() {
    const [element, context] = canvas(256, 32);
    context.clearRect(0, 0, 256, 32);
    context.fillStyle = '#e8e8e4';
    context.fillRect(0, 1, 256, 3);
    context.fillRect(0, 15, 256, 2);
    for (let x = 0; x < 256; x += 32) context.fillRect(x, 0, 3, 32);
    return canvasTexture(element, {repeat: true});
}

export function flagTexture(color, logo) {
    const [element, context] = canvas(256, 160);
    const texture = canvasTexture(element);
    const draw = (image) => {
        context.fillStyle = color;
        context.fillRect(0, 0, 256, 160);
        const gradient = context.createLinearGradient(0, 0, 256, 160);
        gradient.addColorStop(0, 'rgba(255,255,255,.18)');
        gradient.addColorStop(1, 'rgba(0,0,0,.18)');
        context.fillStyle = gradient;
        context.fillRect(0, 0, 256, 160);
        if (image) {
            // Draw the logo in white, using it as a mask.
            const [maskCanvas, mask] = canvas(110, 110);
            mask.drawImage(image, 0, 0, 110, 110);
            mask.globalCompositeOperation = 'source-in';
            mask.fillStyle = '#ffffff';
            mask.fillRect(0, 0, 110, 110);
            context.drawImage(maskCanvas, 73, 25);
        }
        texture.needsUpdate = true;
    };
    draw(null);
    if (logo) {
        const image = new Image();
        image.onload = () => draw(image);
        image.src = logo;
    }
    return texture;
}

export function labelTexture(text, {color = '#ffffff', size = 128, font = 600, scale = .58} = {}) {
    const [element, context] = canvas(size * 2, size);
    context.font = `${font} ${Math.round(size * scale)}px -apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", Arial, sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.shadowColor = 'rgba(0,0,0,.55)';
    context.shadowBlur = size * .08;
    context.fillStyle = color;
    context.fillText(text, size, size * .54);
    return canvasTexture(element, {anisotropy: 4});
}

// The legend under a board: one line of ship silhouettes (team colour afloat, a red dot when damaged, dimmed
// when sunk) and the model's latest reasoning beneath, white over a soft dark glow. Drawn into a canvas that
// becomes a label fixed on the water.
const SHIP_ICONS = {
    Carrier: [45, 'M1 6.5H44M3 6.5 6 10.5H38L42 6.5M28 6.5V3H32.5L33.5 6.5'],
    Battleship: [36, 'M1.5 7H34.5M2 7 4.5 10.5H31L34.5 7M14 7V4.5H17.5V2H19V4.5H22.5V7M6.5 7V5.5H10.5V7M25.5 7V5.5H29.5V7'],
    Cruiser: [27, 'M1.5 7H25.5M2 7 4 10.5H23L25.5 7M9 7V4.5H11.5V2H12.5V4.5H15.5V7M18 7V5.5H20.5V7'],
    Submarine: [27, 'M2.5 8.5C2.5 7 4.5 6.2 7.5 6.2H21.5C24 6.2 25.5 7.2 25.5 8.5S24 10.8 21.5 10.8H7.5C4.5 10.8 2.5 10 2.5 8.5ZM9.5 6.2V3.2H13.5L14.5 6.2'],
    Destroyer: [18, 'M1.5 7H16.5M2 7 3.5 10.5H14.5L16.5 7M6 7V4.5H8.5V2H9.5V4.5H12V7'],
};
export const LEGEND_SIZE = [2048, 400];

export function drawLegend(context, {fleet = [], text = '', color = '#ffffff'}) {
    const [width, height] = LEGEND_SIZE;
    context.clearRect(0, 0, width, height);
    context.save();
    context.shadowColor = 'rgba(0, 8, 24, .85)';
    context.shadowBlur = 14;
    // Ship silhouettes, centred.
    const scale = 7.2, gap = 64;
    const total = fleet.reduce((sum, ship) => sum + (SHIP_ICONS[ship.type]?.[0] || 20) * scale, 0) + gap * Math.max(0, fleet.length - 1);
    let x = (width - total) / 2;
    for (const ship of fleet) {
        const [w, path] = SHIP_ICONS[ship.type] || SHIP_ICONS.Destroyer;
        context.save();
        context.translate(x, 6);
        context.scale(scale, scale);
        context.lineWidth = 1.5;
        context.lineJoin = context.lineCap = 'round';
        context.strokeStyle = ship.sunk ? 'rgba(255,255,255,.3)' : color;
        context.stroke(new Path2D(path));
        context.restore();
        if (ship.damaged && !ship.sunk) {
            context.fillStyle = '#ff5a3c';
            context.beginPath();
            context.arc(x + w * scale - 10, 10, 12, 0, Math.PI * 2);
            context.fill();
        }
        x += w * scale + gap;
    }
    // The reasoning, wrapped to three lines.
    context.font = '500 54px -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Arial, sans-serif';
    context.fillStyle = 'rgba(244, 247, 252, .96)';
    context.textAlign = 'center';
    context.textBaseline = 'top';
    const words = String(text || '').split(/\s+/).filter(Boolean);
    const lines = [];
    let line = '';
    for (const word of words) {
        const next = line ? line + ' ' + word : word;
        if (context.measureText(next).width > width - 80 && line) {
            lines.push(line);
            line = word;
            if (lines.length === 3) break;
        } else line = next;
    }
    if (lines.length < 3 && line) lines.push(line);
    if (lines.length === 3 && words.join(' ').length > lines.join(' ').length) {
        let last = lines[2];
        while (context.measureText(last + '…').width > width - 80 && last.length) last = last.slice(0, -1);
        lines[2] = last.trimEnd() + '…';
    }
    lines.forEach((l, i) => context.fillText(l, width / 2, 130 + i * 70));
    context.restore();
}

export function legendTexture() {
    const [element] = canvas(...LEGEND_SIZE);
    return canvasTexture(element, {anisotropy: 8});
}

// A wide word mark used above each fleet: team name in team color over a soft dark glow.
export function bannerTexture(text, color) {
    const [element, context] = canvas(1024, 192);
    context.font = '700 96px -apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", Arial, sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.shadowColor = 'rgba(0,0,0,.6)';
    context.shadowBlur = 22;
    context.fillStyle = color;
    context.fillText(text, 512, 100);
    return canvasTexture(element, {anisotropy: 4});
}
