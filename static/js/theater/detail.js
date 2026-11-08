import * as THREE from 'three';
import { box, cyl, sphere, dome, prism, chamfered, place, lathe, extrudeXZ, lerp } from './shipkit.js';

// Small fittings that make a warship read as real up close: windows, portholes, railings around every
// deck, bollards, vents, life-raft racks, anchor gear, launchers, antennas and deck aircraft. All static,
// so they merge into the ship's few draw calls. Units are the designs' model units (see ships.js).

const rand = (() => {
    let seed = 1234567;
    return () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
})();

// A row of windows on a face. axis 'x': the row runs along x on a face at z; axis 'z': along z on a face at x.
export function windowRow(b, {x, y, z, length, axis = 'x', count, w = .011, h = .008, lit = .15}) {
    for (let i = 0; i < count; i++) {
        const t = count === 1 ? 0 : i / (count - 1) - .5;
        const px = axis === 'x' ? x + t * length : x;
        const pz = axis === 'z' ? z + t * length : z;
        b.add(rand() < lit ? 'windowsLit' : 'glass', axis === 'x' ? box(w, h, .003) : box(.003, h, w), [px, y, pz]);
    }
}

// Windows on all four faces of a block (centre x, z; width along x, depth along z; window line at y).
export function windowsAround(b, {x, y, z = 0, w, d, rows = 1, spacing = .022, gap = .016}) {
    for (let r = 0; r < rows; r++) {
        const yy = y + r * gap;
        windowRow(b, {x, y: yy, z: z + d / 2 + .0015, length: w * .8, axis: 'x', count: Math.max(2, Math.floor(w * .8 / spacing))});
        windowRow(b, {x, y: yy, z: z - d / 2 - .0015, length: w * .8, axis: 'x', count: Math.max(2, Math.floor(w * .8 / spacing))});
        windowRow(b, {x: x + w / 2 + .0015, y: yy, z, length: d * .7, axis: 'z', count: Math.max(2, Math.floor(d * .7 / spacing))});
        windowRow(b, {x: x - w / 2 - .0015, y: yy, z, length: d * .7, axis: 'z', count: Math.max(2, Math.floor(d * .7 / spacing))});
    }
}

// Round portholes along both sides of the hull, set into the flared side at height y.
export function portholes(b, P, {x0, x1, y, spacing = .028, r = .0042}) {
    for (let x = x0; x <= x1; x += spacing) {
        const s = x / P.spec.L + .5;
        const deck = P.deckY(s);
        if (y > deck - .012) continue;
        const z = lerp(P.halfBeamDeck(s), P.halfBeamWater(s), 1 - y / deck);
        for (const side of [1, -1]) b.add('glass', place(cyl(r, r, .003, 8), [0, 0, 0], [Math.PI / 2, 0, 0]), [x, y, side * (z + .0012)]);
    }
}

// Pairs of mooring bollards and fairleads along both deck edges.
export function deckFittings(b, P, {x0, x1, spacing = .17, inset = .025}) {
    for (let x = x0; x <= x1; x += spacing) {
        const s = x / P.spec.L + .5;
        const y = P.deckY(s), hb = P.halfBeamDeck(s) - inset;
        if (hb < .03) continue;
        for (const side of [1, -1]) {
            b.add('dark', cyl(.0042, .0048, .011, 8), [x - .006, y + .0055, side * hb]);
            b.add('dark', cyl(.0042, .0048, .011, 8), [x + .006, y + .0055, side * hb]);
            b.add('dark', box(.012, .004, .006), [x + .03, y + .002, side * (hb + .012)]);
        }
    }
}

// Mushroom ventilators.
export function vents(b, points) {
    for (const [x, y, z] of points) {
        b.add('steel', cyl(.0055, .0065, .014, 8), [x, y + .007, z]);
        b.add('steel', cyl(.01, .008, .004, 10), [x, y + .016, z]);
    }
}

// A rack of white life-raft canisters lying fore and aft.
export function raftRack(b, {x, y, z, count = 4, axis = 'x'}) {
    for (let i = 0; i < count; i++) {
        const offset = (i - (count - 1) / 2) * .019;
        b.add('white', place(cyl(.0075, .0075, .024, 8), [0, 0, 0], axis === 'x' ? [0, 0, Math.PI / 2] : [Math.PI / 2, 0, 0]), axis === 'x' ? [x, y + .008, z + offset] : [x + offset, y + .008, z]);
    }
    b.add('dark', axis === 'x' ? box(.03, .003, count * .019) : box(count * .019, .003, .03), [x, y + .001, z]);
}

// Thin whip antennas.
export function whips(b, points, height = .09) {
    for (const [x, y, z, h = height] of points) b.add('dark', cyl(.0012, .0016, h, 4), [x, y + h / 2, z]);
}

function railRibbon(length, h) {
    const g = new THREE.PlaneGeometry(length, h);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * length * 9);
    return g;
}

// A railing along a closed outline (points in x, z) around the edge of a roof at height y.
export function outlineRail(b, points, {x = 0, y, z = 0, h = .014}) {
    for (let i = 0; i < points.length; i++) {
        const [px, pz] = points[i], [qx, qz] = points[(i + 1) % points.length];
        const length = Math.hypot(qx - px, qz - pz);
        if (length < .003) continue;
        b.add('rail', railRibbon(length, h).rotateY(Math.atan2(-(qz - pz), qx - px)), [x + (px + qx) / 2, y + h / 2, z + (pz + qz) / 2]);
    }
}

// A railing around a rectangular roof (centre x, z; width along x, depth along z).
export function roofRail(b, {x, y, z = 0, w, d, h = .014}) {
    outlineRail(b, [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]], {x, y, z, h});
}

// Anchor windlasses on the forecastle and the chains running out to the hawse pipes.
export function anchorGear(b, P, {x, spread = .05}) {
    const s = x / P.spec.L + .5;
    const y = P.deckY(s);
    for (const side of [1, -1]) {
        b.add('dark', place(cyl(.012, .012, .02, 12), [0, 0, 0], [Math.PI / 2, 0, 0]), [x, y + .012, side * spread]);
        const hawseX = x + .12, hs = hawseX / P.spec.L + .5;
        const hawseZ = side * (P.halfBeamDeck(hs) - .012);
        const from = new THREE.Vector3(x + .01, y + .004, side * spread), to = new THREE.Vector3(hawseX, P.deckY(hs) + .003, hawseZ);
        const chain = box(from.distanceTo(to), .004, .007);
        chain.rotateY(-Math.atan2(to.z - from.z, to.x - from.x));
        b.add('black', chain, [(from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2]);
        b.add('dark', cyl(.008, .008, .006, 10), [hawseX, P.deckY(hs) + .003, hawseZ]);
    }
}

// Quad Harpoon (or NSM) canisters, angled up and out.
export function canisterLauncher(b, {x, y, z, yaw = 0, count = 4, length = .085}) {
    for (let i = 0; i < count; i++) {
        const row = i % 2, col = Math.floor(i / 2);
        const offset = new THREE.Vector3(0, row * .017, (col - (count / 2 - 1) / 2) * .019).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
        b.add('steel', place(box(length, .015, .016), [0, 0, 0], [0, yaw, .5]), [x + offset.x, y + .02 + offset.y, z + offset.z]);
    }
    b.add('dark', place(box(.05, .015, count / 2 * .02), [0, 0, 0], [0, yaw, 0]), [x, y + .007, z]);
}

// Triple torpedo tubes.
export function torpedoTubes(b, {x, y, z, yaw = 0}) {
    for (let i = 0; i < 3; i++) {
        const offset = new THREE.Vector3(0, i * .011, 0);
        b.add('dark', place(cyl(.0055, .0055, .07, 8), [0, 0, 0], [0, yaw, Math.PI / 2]), [x + offset.x, y + .008 + offset.y, z]);
    }
    b.add('steel', place(box(.03, .006, .02), [0, 0, 0], [0, yaw, 0]), [x, y + .003, z]);
}

// A four-legged lattice mast with cross bracing and platforms; returns the top.
export function latticeMast(b, {x, y, z = 0, height, base = .06, top = .025, crown = true}) {
    const corners = (k) => {
        const half = lerp(base, top, k) / 2;
        return [[half, half], [half, -half], [-half, -half], [-half, half]];
    };
    const levels = 5;
    const link = (a, c) => {
        const from = new THREE.Vector3(...a), to = new THREE.Vector3(...c);
        const g = cyl(.0018, .0018, from.distanceTo(to), 4);
        g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize()));
        b.add('dark', g, [(from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2]);
    };
    for (let l = 0; l < levels; l++) {
        const k0 = l / levels, k1 = (l + 1) / levels;
        const c0 = corners(k0), c1 = corners(k1);
        const y0 = y + k0 * height, y1 = y + k1 * height;
        for (let i = 0; i < 4; i++) {
            const j = (i + 1) % 4;
            link([x + c0[i][0], y0, z + c0[i][1]], [x + c1[i][0], y1, z + c1[i][1]]);
            link([x + c0[i][0], y0, z + c0[i][1]], [x + c1[j][0], y1, z + c1[j][1]]);
            link([x + c1[i][0], y1, z + c1[i][1]], [x + c1[j][0], y1, z + c1[j][1]]);
        }
        if (l === 2 || l === 4) b.add('steel', box(lerp(base, top, k1) + .025, .004, lerp(base, top, k1) + .025), [x, y1, z]);
    }
    b.add('dark', cyl(.0025, .0025, .18, 5), [x, y + height * .85, z], [Math.PI / 2, 0, 0]);
    // Whips on the yard ends, and one on top unless something (a radar) sits there.
    whips(b, [[x + .01, y + height * .85, z + .07, .04], [x + .01, y + height * .85, z - .07, .04], ...(crown ? [[x, y + height, z, .06]] : [])]);
    return new THREE.Vector3(x, y + height, z);
}

export function searchlight(b, x, y, z, yaw = 0) {
    b.add('dark', cyl(.003, .004, .01, 6), [x, y + .005, z]);
    b.add('steel', place(cyl(.0065, .0075, .012, 10), [0, 0, 0], [0, yaw, Math.PI / 2]), [x, y + .014, z]);
}

// Electronic warfare "ears" on the sides of a deckhouse.
export function ewArrays(b, {x, y, halfBeam}) {
    for (const side of [1, -1]) {
        b.add('steel', box(.03, .028, .012), [x, y, side * (halfBeam + .006)]);
        b.add('dark', box(.026, .022, .003), [x, y, side * (halfBeam + .0135)]);
    }
}

// ---------------------------------------------------------------------------------------------------------
// Deck aircraft
// ---------------------------------------------------------------------------------------------------------

// F/A-18 Super Hornet (18 m): radome and fuselage, the leading-edge extensions running forward to the cockpit,
// the square intakes under them, swept wings with pylons, fuel tanks and wingtip Sidewinders, all-moving
// tailplanes, canted twin fins, the bubble canopy and two engine nozzles.
export function hornet(s = 1) {
    const body = lathe([[.118, 0], [.106, .004], [.09, .008], [.07, .0105], [.04, .0135], [.0, .0155], [-.05, .016], [-.085, .0145], [-.105, .0115], [-.114, .009]].map(([x, r]) => [x * s, r * s]), 18);
    place(body, [0, 0, 0], [0, 0, 0], [1, .72, 1.22]);
    const wing = (points, y, thickness = .003) => place(extrudeXZ(points.map(([x, z]) => [x * s, z * s]), thickness * s), [0, y * s, 0]);
    const wings = wing([[.02, 0], [-.035, .072], [-.06, .072], [-.05, 0], [-.06, -.072], [-.035, -.072]], -.002);
    const tailplane = wing([[-.07, 0], [-.095, .04], [-.112, .04], [-.108, 0], [-.112, -.04], [-.095, -.04]], -.001);
    const fin = (side) => place(prism(
        [[-.11 * s, -.002 * s], [-.075 * s, -.002 * s], [-.075 * s, .002 * s], [-.11 * s, .002 * s]],
        [[-.118 * s, -.002 * s], [-.1 * s, -.002 * s], [-.1 * s, .002 * s], [-.118 * s, .002 * s]],
        .038 * s), [0, .004 * s, side * .016 * s], [side * .32, 0, 0]);
    const canopy = place(sphere(.012 * s, 14, 10), [.058 * s, .0085 * s, 0], [0, 0, 0], [2.3, .82, .85]);
    // Leading-edge extensions: thin plates from the wing root forward along the fuselage to the cockpit.
    const lex = wing([[.085, 0], [.03, .026], [-.005, .031], [-.005, -.031], [.03, -.026]], .0005, .0016);
    const pieces = [body, wings, tailplane, fin(-1), fin(1), lex];
    const dark = [];
    for (const side of [1, -1]) {
        // Intakes under the LEX, the engine nozzles, a pylon with a drop tank, a Sidewinder on each wingtip.
        pieces.push(place(box(.03 * s, .009 * s, .011 * s), [.014 * s, -.0055 * s, side * .0165 * s]));
        dark.push(place(box(.002 * s, .007 * s, .009 * s), [.03 * s, -.0055 * s, side * .0165 * s]));
        dark.push(place(cyl(.0052 * s, .0058 * s, .014 * s, 12), [-.118 * s, 0, side * .0075 * s], [0, 0, Math.PI / 2]));
        pieces.push(place(box(.012 * s, .005 * s, .0018 * s), [-.022 * s, -.0055 * s, side * .036 * s]));
        pieces.push(place(new THREE.CapsuleGeometry(.0046 * s, .032 * s, 4, 10), [-.018 * s, -.0105 * s, side * .036 * s], [0, 0, Math.PI / 2]));
        pieces.push(place(cyl(.0017 * s, .0017 * s, .05 * s, 8), [-.042 * s, -.002 * s, side * .0735 * s], [0, 0, Math.PI / 2]));
        pieces.push(place(new THREE.ConeGeometry(.0017 * s, .006 * s, 8), [-.014 * s, -.002 * s, side * .0735 * s], [0, 0, -Math.PI / 2]));
    }
    return {gray: pieces, glass: [canopy], dark};
}

// E-2 Hawkeye: high wing, the big rotodome on its pylon, four small fins.
export function hawkeye(s = 1) {
    const body = lathe([[.12, 0], [.1, .009], [.06, .014], [-.06, .014], [-.1, .009], [-.12, .004]].map(([x, r]) => [x * s, r * s]), 12);
    const wing = place(box(.03 * s, .004 * s, .26 * s), [.01 * s, .014 * s, 0]);
    const dome = place(cyl(.045 * s, .045 * s, .008 * s, 20), [-.01 * s, .05 * s, 0]);
    const pylon = place(box(.01 * s, .03 * s, .006 * s), [-.01 * s, .032 * s, 0]);
    const tail = place(box(.012 * s, .004 * s, .09 * s), [-.11 * s, .01 * s, 0]);
    const fins = [-.045, -.015, .015, .045].map(z => place(box(.016 * s, .03 * s, .002 * s), [-.11 * s, .025 * s, z * s]));
    const props = [-.07, .07].map(z => place(cyl(.008 * s, .008 * s, .03 * s, 8), [.035 * s, .012 * s, z * s], [0, 0, Math.PI / 2]));
    return {gray: [body, wing, pylon, tail, ...fins, ...props], white: [dome]};
}

// MH-60 Seahawk with its rotor folded fore and aft.
export function seahawk(s = 1) {
    const body = place(new THREE.CapsuleGeometry(.014 * s, .05 * s, 4, 10), [0, .016 * s, 0], [0, 0, Math.PI / 2], [1, 1, .85]);
    const boom = place(cyl(.004 * s, .006 * s, .07 * s, 6), [-.06 * s, .022 * s, 0], [0, 0, Math.PI / 2]);
    const fin = place(box(.012 * s, .022 * s, .003 * s), [-.095 * s, .03 * s, 0]);
    const blades = [-.012, -.004, .004, .012].map(z => place(box(.1 * s, .0015 * s, .004 * s), [-.01 * s, .034 * s, z * s]));
    return {gray: [body, boom, fin, ...blades]};
}

// A yellow deck tractor.
export function tug(b, x, y, z, yaw = 0) {
    b.add('yellow', place(box(.03, .012, .018), [0, 0, 0], [0, yaw, 0]), [x, y + .006, z]);
    b.add('dark', place(box(.008, .008, .014), [0, 0, 0], [0, yaw, 0]), [x - Math.cos(yaw) * .006, y + .016, z + Math.sin(yaw) * .006]);
}

// A sailor, 1.8 m tall: a body in the colour of the job and a helmet or head.
export function sailor(b, x, y, z, material) {
    b.add(material, new THREE.CapsuleGeometry(.0036, .012, 2, 6), [x, y + .0096, z]);
    b.add('white', sphere(.0028, 6, 4), [x, y + .0205, z]);
}

// A handful of sailors scattered round a point.
export function crewGroup(b, x, y, z, materials, count = 3, spread = .03) {
    for (let i = 0; i < count; i++) {
        const a = rand() * Math.PI * 2, d = Math.sqrt(rand()) * spread;
        sailor(b, x + Math.cos(a) * d, y, z + Math.sin(a) * d * .7, materials[Math.floor(rand() * materials.length)]);
    }
}

export { rand };
