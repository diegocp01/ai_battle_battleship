import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// Modeling helpers and materials for the procedural warships. Ships are modeled in their own frame: bow
// toward +x, starboard toward +z, the waterline at y = 0. Static parts are merged per material (and per
// half, so a ship can break in two when it sinks); turrets, radars and flags stay separate so they move.

const ss = (a, b, x) => {
    const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
};
export const lerp = THREE.MathUtils.lerp;

// ---------------------------------------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------------------------------------

export const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
export const rbox = (w, h, d, r = .006) => new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2.1, h / 2.1, d / 2.1));
export const cyl = (rTop, rBottom, h, segments = 16) => new THREE.CylinderGeometry(rTop, rBottom, h, segments);
export const sphere = (r, w = 16, h = 12) => new THREE.SphereGeometry(r, w, h);
export const dome = (r, w = 18) => new THREE.SphereGeometry(r, w, 9, 0, Math.PI * 2, 0, Math.PI / 2);

// A solid between two convex outlines (same vertex count, counter-clockwise seen from above): bottom at
// y = 0, top at y = h. Gives sloped deckhouses, turret faces and raked funnels with crisp edges.
export function prism(bottom, top, h) {
    const n = bottom.length;
    const positions = [];
    const push = (...points) => points.forEach(p => positions.push(...p));
    const B = bottom.map(([x, z]) => [x, 0, z]);
    const T = top.map(([x, z]) => [x, h, z]);
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        push(B[i], T[j], B[j], B[i], T[i], T[j]);
    }
    for (let i = 1; i < n - 1; i++) {
        push(T[0], T[i + 1], T[i]);
        push(B[0], B[i], B[i + 1]);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.computeVertexNormals();
    return planarUv(geometry);
}

// Rectangle-to-rectangle prism, optionally shifted along x at the top (for raked funnels and bridges).
export function taper(w0, d0, w1, d1, h, shift = 0) {
    const rect = (w, d, dx = 0) => [[-w / 2 + dx, -d / 2], [w / 2 + dx, -d / 2], [w / 2 + dx, d / 2], [-w / 2 + dx, d / 2]];
    return prism(rect(w0, d0), rect(w1, d1, shift), h);
}

// An outline with its corners cut, for stealthy funnels and gun shields.
export function chamfered(w, d, cut) {
    const x = w / 2, z = d / 2;
    return [[-x, z - cut], [-x + cut, z], [x - cut, z], [x, z - cut], [x, -z + cut], [x - cut, -z], [-x + cut, -z], [-x, -z + cut]].reverse();
}

export function extrudeXZ(points, height, bevel = 0) {
    const shape = new THREE.Shape(points.map(([x, z]) => new THREE.Vector2(x, -z)));
    const geometry = new THREE.ExtrudeGeometry(shape, {depth: height, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 12});
    geometry.rotateX(-Math.PI / 2);
    return geometry;
}

export function lathe(profile, segments = 28) {
    const ordered = [...profile].sort((p, q) => p[0] - q[0]);
    const geometry = new THREE.LatheGeometry(ordered.map(([x, r]) => new THREE.Vector2(Math.max(r, 1e-4), x)), segments);
    geometry.rotateZ(-Math.PI / 2);
    return geometry;
}

function planarUv(geometry) {
    const p = geometry.attributes.position;
    const uv = new Float32Array(p.count * 2);
    for (let i = 0; i < p.count; i++) {
        uv[i * 2] = p.getX(i) + p.getZ(i);
        uv[i * 2 + 1] = p.getY(i);
    }
    geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    return geometry;
}

const tmpMatrix = new THREE.Matrix4();
const tmpQuat = new THREE.Quaternion();
const tmpEuler = new THREE.Euler();

export function place(geometry, [x = 0, y = 0, z = 0] = [], [rx = 0, ry = 0, rz = 0] = [], [sx = 1, sy = 1, sz = 1] = []) {
    tmpQuat.setFromEuler(tmpEuler.set(rx, ry, rz));
    tmpMatrix.compose(new THREE.Vector3(x, y, z), tmpQuat, new THREE.Vector3(sx, sy, sz));
    geometry.applyMatrix4(tmpMatrix);
    return geometry;
}

function normalizeForMerge(geometry) {
    let g = geometry.index ? geometry.toNonIndexed() : geometry;
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    g.morphAttributes = {};
    return g;
}

// Collects transformed pieces by material, split into the fore and aft halves of the ship.
export class ShipBuilder {
    constructor(split = 0) {
        this.split = split;
        this.buckets = {fore: new Map(), aft: new Map()};
    }

    half(x) {
        return x >= this.split ? 'fore' : 'aft';
    }

    add(material, geometry, position = [], rotation = [], scale = [], half = null) {
        place(geometry, position, rotation, scale);
        // Every static part is scaled from model units to the real class dimensions.
        if (this.post) geometry.applyMatrix4(this.post);
        const side = half || this.half(position[0] || 0);
        const bucket = this.buckets[side];
        if (!bucket.has(material)) bucket.set(material, []);
        bucket.get(material).push(normalizeForMerge(geometry));
        return geometry;
    }

    build(materials) {
        const halves = {};
        for (const side of ['fore', 'aft']) {
            const group = new THREE.Group();
            group.name = side;
            for (const [key, pieces] of this.buckets[side]) {
                const material = materials[key];
                if (!material) throw new Error('Missing ship material ' + key);
                const mesh = new THREE.Mesh(mergeGeometries(pieces, false), material);
                mesh.castShadow = !material.transparent && key !== 'rail';
                mesh.receiveShadow = true;
                mesh.name = key;
                group.add(mesh);
                pieces.forEach(piece => piece.dispose());
            }
            halves[side] = group;
        }
        return halves;
    }
}

// Group-level helper for moving parts: a mesh made of merged pieces with one material.
export function partMesh(material, pieces) {
    const mesh = new THREE.Mesh(mergeGeometries(pieces.map(normalizeForMerge), false), material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
}

// ---------------------------------------------------------------------------------------------------------
// Hull: a lofted surface from station curves. Plan-view beam, sheer line, keel line and section shape all
// vary along the length; the bow rakes forward with a cut-away forefoot, the stern ends in a transom.
// ---------------------------------------------------------------------------------------------------------

export function hullProfile(spec) {
    const {L, B, draft, freeboard, sheerFwd = .03, sheerAft = .01, transom = .7, bowLen = .38, sternLen = .14, flare = .22} = spec;
    const planform = (s) => {
        let b = 1;
        if (s > 1 - bowLen) b = 1 - Math.pow((s - (1 - bowLen)) / bowLen, 1.85);
        if (s < sternLen) {
            const t = 1 - s / sternLen;
            b = lerp(1, transom, t * t);
        }
        return Math.max(b, 0);
    };
    const bowness = (s) => ss(1 - bowLen * 1.15, 1, s);
    return {
        halfBeamDeck: (s) => B / 2 * planform(s),
        halfBeamWater: (s) => B / 2 * planform(s) * (1 - flare * bowness(s)) * (s < sternLen ? lerp(.92, 1, s / sternLen) : 1),
        deckY: (s) => freeboard + sheerFwd * Math.pow(ss(.5, 1, s), 2) + sheerAft * Math.pow(ss(.35, 0, s), 2),
        keelY: (s) => -draft * (1 - ss(.86, 1, s) * .82) * (1 - ss(.1, 0, s) * .55),
        exponent: (s) => lerp(lerp(2.9, 1.55, bowness(s)), 2.1, ss(.12, 0, s)),
        x: (s) => (s - .5) * L,
        bowness,
        spec,
    };
}

export function hullGeometry(spec, s0 = 0, s1 = 1) {
    const P = hullProfile(spec);
    const {L, rake = .03, forefoot = .04} = spec;
    const stations = Math.max(6, Math.round((s1 - s0) * 72));
    const above = 3, below = 10, rows = above + below + 1;
    const ring = [];
    for (let i = 0; i <= stations; i++) {
        // Stations crowd toward the bow, where the shape changes fastest.
        const t = i / stations;
        const s = lerp(s0, s1, t);
        const hbDeck = P.halfBeamDeck(s), hbWater = P.halfBeamWater(s), deck = P.deckY(s), keel = P.keelY(s), n = P.exponent(s);
        const points = [];
        for (let j = 0; j <= above; j++) {
            const k = j / above;
            points.push([deck * (1 - k), lerp(hbDeck, hbWater, k)]);
        }
        for (let j = 1; j <= below; j++) {
            const q = j / below;
            points.push([keel * q, hbWater * Math.pow(Math.max(0, 1 - Math.pow(q, n)), 1 / n)]);
        }
        const xs = points.map(([y]) => {
            let x = P.x(s);
            if (y > 0) x += rake * L * ss(.8, 1, s) * Math.min(1, y / deck);
            else x -= forefoot * L * ss(.84, 1, s) * Math.pow(Math.min(1, y / keel), 1.6);
            return x;
        });
        ring.push(points.map(([y, z], j) => [xs[j], y, z]));
    }
    const positions = [], uvs = [];
    const vertex = ([x, y, z], side) => {
        positions.push(x, y, z * side);
        uvs.push(x / L + .5, y);
    };
    for (const side of [1, -1]) {
        for (let i = 0; i < stations; i++) for (let j = 0; j < rows - 1; j++) {
            const A = ring[i][j], Bv = ring[i + 1][j], C = ring[i][j + 1], D = ring[i + 1][j + 1];
            const quad = side > 0 ? [A, C, Bv, Bv, C, D] : [A, Bv, C, Bv, D, C];
            quad.forEach(p => vertex(p, side));
        }
    }
    // Transom: close the stern with a flat plate.
    if (s0 === 0 && spec.transom > .05) {
        const stern = ring[0];
        const center = [stern[0][0], (stern[0][1] + stern[rows - 1][1]) / 2, 0];
        for (let j = 0; j < rows - 1; j++) {
            for (const side of [1, -1]) {
                const a = stern[j], b = stern[j + 1];
                const tri = side > 0 ? [center, b, a] : [center, a, b];
                tri.forEach(p => vertex(p, side));
            }
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.computeVertexNormals();
    return geometry;
}

// The weather deck over the hull, with a little camber; UVs run stern → bow (u) and port → starboard (v).
export function deckGeometry(spec, s0 = 0, s1 = 1, inset = 0) {
    const P = hullProfile(spec);
    const {L, rake = .03, B, camber = .008} = spec;
    const stations = Math.max(6, Math.round((s1 - s0) * 72));
    const positions = [], uvs = [];
    const row = (s) => {
        const hb = Math.max(0, P.halfBeamDeck(s) - inset), y = P.deckY(s);
        const x = P.x(s) + rake * L * ss(.8, 1, s);
        return [[x, y, -hb], [x, y + camber * (hb / (B / 2)), 0], [x, y, hb]];
    };
    for (let i = 0; i < stations; i++) {
        const a = row(lerp(s0, s1, i / stations)), b = row(lerp(s0, s1, (i + 1) / stations));
        for (let k = 0; k < 2; k++) {
            for (const p of [a[k], a[k + 1], b[k], b[k], a[k + 1], b[k + 1]]) {
                positions.push(...p);
                uvs.push(p[0] / L + .5, p[2] / B + .5);
            }
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.computeVertexNormals();
    return geometry;
}

// Railings along both deck edges: a thin vertical ribbon textured with stanchions and rails.
export function railGeometry(spec, s0, s1, height = .016) {
    const P = hullProfile(spec);
    const {L, rake = .03} = spec;
    const stations = Math.max(4, Math.round((s1 - s0) * 40));
    const positions = [], uvs = [];
    for (const side of [1, -1]) {
        let run = 0;
        let previous = null;
        for (let i = 0; i <= stations; i++) {
            const s = lerp(s0, s1, i / stations);
            const point = [P.x(s) + rake * L * ss(.8, 1, s), P.deckY(s), side * Math.max(0, P.halfBeamDeck(s) - .004)];
            if (previous) {
                const length = Math.hypot(point[0] - previous[0], point[2] - previous[2]);
                const u0 = run * 9, u1 = (run + length) * 9;
                const quad = [[previous, u0, 0], [point, u1, 0], [previous, u0, 1], [point, u1, 0], [point, u1, 1], [previous, u0, 1]];
                for (const [[x, y, z], u, v] of quad) {
                    positions.push(x, y + v * height, z);
                    uvs.push(u, v);
                }
                run += length;
            }
            previous = point;
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.computeVertexNormals();
    return geometry;
}

// ---------------------------------------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------------------------------------

// Paint wear, rust streaks, waterline bands, the team's hull stripe and number, and scorch marks that
// spread (and glow) where the ship has been hit. All in the ship's own frame, so the marks ride with it.
function weathering(material, shared, ship, {hull = false, rust = .5, ember = true} = {}) {
    material.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, {
            uGrime: shared.grime,
            uTime: shared.time,
            uShipInv: ship.inverse,
            uBurn: ship.burn,
            uRust: {value: rust},
            uTeamColor: ship.teamColor,
            uNumberMap: ship.numberMap,
            uNumber: ship.number,
            uStripe: ship.stripe,
            uBootTop: ship.bootTop,
        });
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', '#include <common>\nuniform mat4 uShipInv;\nvarying vec3 vShipPos;\nvarying vec3 vShipNormal;')
            .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
                mat4 toShip = uShipInv * modelMatrix;
                vShipPos = (toShip * vec4(transformed, 1.)).xyz;
                vShipNormal = normalize(mat3(toShip) * objectNormal);`);
        shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', `#include <common>
                uniform sampler2D uGrime; uniform float uTime; uniform vec4 uBurn[6]; uniform float uRust;
                float shipHash(vec3 p) { p = fract(p * .1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
                float shipNoise(vec3 p) {
                    vec3 i = floor(p), f = fract(p);
                    f = f * f * (3. - 2. * f);
                    return mix(mix(mix(shipHash(i), shipHash(i + vec3(1, 0, 0)), f.x), mix(shipHash(i + vec3(0, 1, 0)), shipHash(i + vec3(1, 1, 0)), f.x), f.y),
                               mix(mix(shipHash(i + vec3(0, 0, 1)), shipHash(i + vec3(1, 0, 1)), f.x), mix(shipHash(i + vec3(0, 1, 1)), shipHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
                }
                uniform vec3 uTeamColor; uniform sampler2D uNumberMap; uniform vec4 uNumber; uniform vec4 uStripe; uniform float uBootTop;
                varying vec3 vShipPos; varying vec3 vShipNormal;
                float shipBurn; vec4 shipGrime;`)
            .replace('#include <map_fragment>', `#include <map_fragment>
                vec3 an = abs(normalize(vShipNormal)); an /= (an.x + an.y + an.z + 1e-4);
                shipGrime = texture2D(uGrime, vShipPos.zy * 2.3) * an.x + texture2D(uGrime, vShipPos.xz * 2.3) * an.y + texture2D(uGrime, vShipPos.xy * 2.3) * an.z;
                diffuseColor.rgb *= mix(.8, 1.07, shipGrime.r) * mix(.94, 1.03, shipGrime.b);
                float vertical = 1. - an.y;
                diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.3, .19, .11), smoothstep(.6, .9, shipGrime.g) * vertical * uRust * .55);
                diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.24, .15, .09), shipGrime.a * uRust * .22);
                ${hull ? `
                float wy = vShipPos.y;
                if (wy < -.003) diffuseColor.rgb = vec3(.30, .07, .055) * mix(.75, 1.1, shipGrime.r);
                else if (wy < uBootTop) diffuseColor.rgb = vec3(.035, .036, .04);
                else {
                    float slant = vShipPos.x - uStripe.x + wy * uStripe.z;
                    float band = step(0., slant) * step(slant, uStripe.y);
                    float thin = step(uStripe.y + uStripe.w * .5, slant) * step(slant, uStripe.y + uStripe.w * 1.5);
                    diffuseColor.rgb = mix(diffuseColor.rgb, uTeamColor, band);
                    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.92), thin);
                    vec2 nuv = vec2((vShipPos.x - uNumber.x) / uNumber.z, (wy - uNumber.y) / uNumber.w);
                    if (vShipPos.z < 0.) nuv.x = 1. - nuv.x;
                    if (nuv.x > 0. && nuv.x < 1. && nuv.y > 0. && nuv.y < 1. && abs(vShipNormal.z) > .25) {
                        vec4 t = texture2D(uNumberMap, nuv);
                        diffuseColor.rgb = mix(diffuseColor.rgb, t.rgb, t.a);
                    }
                }` : ''}
                shipBurn = 0.;
                for (int i = 0; i < 6; i++) {
                    vec4 b = uBurn[i];
                    if (b.w <= 0.) continue;
                    float d = length(vShipPos.xz - b.xy) + (shipGrime.r - .5) * b.z * .9;
                    shipBurn = max(shipBurn, (1. - smoothstep(b.z * .3, b.z, d)) * b.w);
                }
                diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.016, .014, .013), shipBurn * .93);
                if (!gl_FrontFacing) diffuseColor.rgb = vec3(.025, .02, .018);`)
            .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
                roughnessFactor = clamp(roughnessFactor + (shipGrime.r - .5) * .22 + shipBurn * .35, .05, 1.);`)
            .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
                ${ember ? `float emberField = shipNoise(vShipPos * 34.) * .62 + shipNoise(vShipPos * 91.) * .38;
                float emberPulse = .6 + .4 * sin(uTime * 3.1 + shipNoise(vShipPos * 9.) * 18.);
                totalEmissiveRadiance += vec3(1., .3, .05) * pow(shipBurn, 3.) * smoothstep(.56, .8, emberField) * emberPulse * 2.;` : ''}`);
    };
    material.customProgramCacheKey = () => (hull ? 'ship-hull' : 'ship-paint') + (ember ? '-e' : '');
    return material;
}

export function sharedShipResources(grime) {
    return {grime: {value: grime}, time: {value: 0}};
}

// One material set per ship, so scorch marks stay on the ship that was hit.
export function shipMaterials(shared, ship, textures) {
    const paint = (color, roughness = .62, metalness = .04, options = {}) => new THREE.MeshStandardMaterial({color, roughness, metalness, envMapIntensity: .7, ...options});
    const mats = {
        hull: weathering(paint(ship.paint, .6, .05, {side: THREE.DoubleSide}), shared, ship, {hull: true, rust: .65}),
        steel: weathering(paint(ship.superstructure, .62, .05), shared, ship, {rust: .4}),
        deck: weathering(paint(0xffffff, .85, .02, {map: textures.deck}), shared, ship, {rust: .1}),
        dark: weathering(paint(0x2c2f33, .52, .35), shared, ship, {rust: .2}),
        black: paint(0x0d0e10, .7, .1),
        glass: new THREE.MeshPhysicalMaterial({color: 0x0a1016, roughness: .06, metalness: .1, clearcoat: 1, clearcoatRoughness: .05, envMapIntensity: 1.1}),
        white: weathering(paint(0xc9ccca, .6, 0), shared, ship, {rust: .25, ember: false}),
        rubber: weathering(paint(0x17191b, .86, 0), shared, ship, {rust: .05}),
        canvas: paint(0x77766a, .9, 0),
        orange: paint(0xd25a22, .6, 0),
        jet: weathering(paint(0x8d949b, .52, .15), shared, ship, {rust: .05, ember: false}),
        vls: weathering(paint(0xffffff, .72, .12, {map: textures.vls}), shared, ship, {rust: .1}),
        rail: new THREE.MeshStandardMaterial({color: 0xd0d2cf, roughness: .5, metalness: .4, map: textures.rail, alphaTest: .5, side: THREE.DoubleSide}),
        team: paint(ship.teamColor.value, .45, .1),
        yellow: paint(0xd8a21c, .55, .1),
        lightRed: new THREE.MeshBasicMaterial({color: new THREE.Color(1, .08, .05).multiplyScalar(6)}),
        lightGreen: new THREE.MeshBasicMaterial({color: new THREE.Color(.1, 1, .3).multiplyScalar(5)}),
        lightWhite: new THREE.MeshBasicMaterial({color: new THREE.Color(1, .95, .8).multiplyScalar(7)}),
        windowsLit: new THREE.MeshBasicMaterial({color: new THREE.Color(1, .72, .4).multiplyScalar(1.6)}),
    };
    return mats;
}

// A team flag that waves in the wind.
export function flagMaterial(map, shared) {
    const material = new THREE.MeshStandardMaterial({map, side: THREE.DoubleSide, roughness: .8});
    material.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = shared.time;
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', '#include <common>\nuniform float uTime;')
            .replace('#include <begin_vertex>', `#include <begin_vertex>
                float along = uv.x;
                transformed.z += sin(position.x * 90. - uTime * 11.) * .006 * along + sin(position.x * 47. - uTime * 6.3) * .004 * along;
                transformed.y += sin(position.x * 60. - uTime * 8.) * .0025 * along;`);
    };
    material.customProgramCacheKey = () => 'flag';
    return material;
}
