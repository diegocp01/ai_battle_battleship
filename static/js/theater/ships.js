import * as THREE from 'three';
import {
    ShipBuilder, box, rbox, cyl, sphere, dome, prism, taper, chamfered, extrudeXZ, lathe, place, partMesh,
    hullGeometry, hullProfile, deckGeometry, railGeometry, shipMaterials, flagMaterial, lerp,
} from './shipkit.js';
import { steelDeckTexture, teakDeckTexture, flightDeckTexture, hullNumberTexture } from './textures.js';
import { sailor, crewGroup, windowRow, windowsAround, portholes, deckFittings, vents, raftRack, whips, roofRail, outlineRail, anchorGear, canisterLauncher, torpedoTubes, latticeMast, searchlight, ewArrays, stealthJet, hawkeye, seahawk, tugParts, FIGHTER_RIDE_HEIGHT } from './detail.js';
import { DeckCargo } from './deck-cargo.js';
// Each fleet's fighter, after the references: stealth fighters in the fleet's paint, with its trim and glow
// colors, the badge on its intakes (a glowing >_ for Codex, the mascot for Claude) and its logo on the tails.
// The Codex fighter wears its mascot's colors: the blue body, the dark navy of the visor as trim, and the pale
// cyan of the eyes on its lights. The paint is a little lighter than the mascot's #5e8bf7 so that, lit by the
// scene, it shows the same blue.
export const FIGHTERS = {
    gpt: {model: (s) => stealthJet(s, 'codex'), color: 0x7aa2ff, accent: 0x192b68, glow: [1.25, 2.6, 3.4], badge: 'prompt', logo: '/static/img/logo-chatgpt.png'},
    claude: {model: (s) => stealthJet(s, 'claude'), color: 0xd0623e, glow: [3.4, 1.05, .25], badge: 'mascot', logo: '/static/img/logo-claude.png'},
};

// The intake badges, drawn once.
function badgeTexture(kind) {
    const element = document.createElement('canvas');
    element.width = 256; element.height = 128;
    const c = element.getContext('2d');
    if (kind === 'prompt') {
        c.font = 'bold 92px "SF Mono", Menlo, Consolas, monospace';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillStyle = '#a8e6ff';
        c.shadowColor = 'rgba(60, 170, 255, 1)';
        c.shadowBlur = 18;
        for (let i = 0; i < 2; i++) c.fillText('>_', 128, 64);
    } else {
        // The Claude mascot as a pixel badge: a block body with square eyes, stubby arms and four legs.
        const u = 9, x0 = 128 - 5 * u, y0 = 64 - 5.5 * u;
        c.fillStyle = '#f6dcd2';
        c.fillRect(x0 + u, y0, 8 * u, 6 * u);
        c.fillRect(x0, y0 + 2 * u, u, 2 * u);
        c.fillRect(x0 + 9 * u, y0 + 2 * u, u, 2 * u);
        for (const x of [1.6, 3, 6, 7.4]) c.fillRect(x0 + x * u, y0 + 6 * u, u, 3 * u);
        c.fillStyle = '#2b1c18';
        c.fillRect(x0 + 2.6 * u, y0 + 1.6 * u, 1.1 * u, 1.1 * u);
        c.fillRect(x0 + 6.3 * u, y0 + 1.6 * u, 1.1 * u, 1.1 * u);
    }
    const texture = new THREE.CanvasTexture(element);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    return texture;
}

// The trim, the glow, the intake badge and the tail logo of a fleet's fighters (new materials each call; the
// textures are shared).
const decalTextures = {};
export function fighterDecals(team) {
    const fighter = FIGHTERS[team] || FIGHTERS.gpt;
    const badge = fighter.badge;
    decalTextures[badge] = decalTextures[badge] || badgeTexture(badge);
    if (fighter.logo && !decalTextures[fighter.logo]) {
        decalTextures[fighter.logo] = new THREE.TextureLoader().load(fighter.logo);
        decalTextures[fighter.logo].colorSpace = THREE.SRGBColorSpace;
        decalTextures[fighter.logo].anisotropy = 8;
    }
    const decal = {transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, side: THREE.DoubleSide};
    return {
        fighterAccent: new THREE.MeshStandardMaterial({color: fighter.accent ?? 0xe4e2dc, roughness: .48, metalness: .12}),
        fighterGlow: new THREE.MeshBasicMaterial({color: new THREE.Color(...fighter.glow), toneMapped: false}),
        // The >_ glows; the mascot is painted on and takes the light like the rest of the jet.
        fighterBadge: badge === 'prompt'
            ? new THREE.MeshBasicMaterial({map: decalTextures[badge], toneMapped: false, color: new THREE.Color(2.6, 2.6, 2.6), ...decal})
            : new THREE.MeshStandardMaterial({map: decalTextures[badge], alphaTest: .3, roughness: .5, metalness: .1, ...decal}),
        fighterLogo: new THREE.MeshStandardMaterial({map: fighter.logo ? decalTextures[fighter.logo] : null, alphaTest: .25, roughness: .45, metalness: .1, visible: Boolean(fighter.logo), ...decal}),
    };
}

// Every part of a fighter as meshes, by material (paint, glass, dark, and any glow, prompt and logo).
const FIGHTER_PARTS = {gray: 'fighter', accent: 'fighterAccent', glass: 'glass', dark: 'dark', glow: 'fighterGlow', badge: 'fighterBadge', logo: 'fighterLogo'};

// The five ships of the classic game, at their classic sizes (5, 4, 3, 3 and 2 squares), each modeled after a
// real class and built at its real dimensions: a Ford-class carrier, an Iowa-class battleship, a
// Ticonderoga-class cruiser, an Ohio-class submarine, and for the two-square ship a small, fast
// Freedom-class littoral combat ship. Hulls are lofted; everything on them is built from primitives.

export const SHIP_ORDER = ['Carrier', 'Battleship', 'Cruiser', 'Submarine', 'Destroyer'];

// One grid square is 75 m. Each ship is built at the real length and beam of its class, so the carrier is the
// size of USS Gerald R. Ford (or Abraham Lincoln) and everything else is to scale with it.
export const METERS_PER_SQUARE = 75;
export const CLASSES = {
    Carrier: {name: 'Gerald R. Ford-class aircraft carrier', length: 337, beam: 78, waterline: 41},
    Battleship: {name: 'Iowa-class battleship', length: 270.4, beam: 33},
    Cruiser: {name: 'Ticonderoga-class cruiser', length: 173, beam: 16.8},
    Submarine: {name: 'Ohio-class submarine', length: 170.7, beam: 12.8},
    Destroyer: {name: 'Freedom-class littoral combat ship', length: 118.1, beam: 17.5},
};
// The models' own overall length and widest beam, in model units.
const MODEL_SIZE = {Carrier: [4.86, 1.06], Battleship: [4.03, .54], Cruiser: [2.95, .38], Submarine: [2.7, .31], Destroyer: [1.95, .3]};
const SPLITS = {Carrier: -.2, Battleship: -.12, Cruiser: -.05, Destroyer: 0, Submarine: 0};

function classScale(type) {
    const real = CLASSES[type], [length, beam] = MODEL_SIZE[type];
    const s = real.length / METERS_PER_SQUARE / length;
    const across = real.beam / METERS_PER_SQUARE / (beam * s);
    // A submarine's hull is round, so it narrows in height as well as width.
    return new THREE.Vector3(s, type === 'Submarine' ? s * across : s, s * across);
}
const CODES = {
    gpt: {Carrier: '70', Battleship: '61', Cruiser: '52', Submarine: '23', Destroyer: '87'},
    claude: {Carrier: '72', Battleship: '64', Cruiser: '58', Submarine: '21', Destroyer: '93'},
};

// ---------------------------------------------------------------------------------------------------------
// Moving parts
// ---------------------------------------------------------------------------------------------------------

function mainTurret(mats, barrels = 3) {
    const yaw = new THREE.Group();
    const housing = prism(
        [[-.19, -.165], [.12, -.15], [.19, -.105], [.19, .105], [.12, .15], [-.19, .165]],
        [[-.17, -.15], [.1, -.135], [.13, -.095], [.13, .095], [.1, .135], [-.17, .15]],
        .085,
    );
    const ears = place(cyl(.018, .018, .38, 12), [-.12, .06, 0], [Math.PI / 2, 0, 0]);
    const roof = place(box(.12, .012, .1), [-.06, .09, 0]);
    yaw.add(partMesh(mats.steel, [housing, roof]), partMesh(mats.dark, [ears]));
    const pitch = new THREE.Group();
    pitch.position.set(.15, .045, 0);
    yaw.add(pitch);
    const tubes = [], muzzles = [];
    for (let i = 0; i < barrels; i++) {
        const z = (i - (barrels - 1) / 2) * .075;
        const barrel = new THREE.Group();
        barrel.position.z = z;
        const tube = place(cyl(.0105, .016, .44, 14), [.24, 0, 0], [0, 0, -Math.PI / 2]);
        const lip = place(cyl(.0125, .0125, .018, 14), [.455, 0, 0], [0, 0, -Math.PI / 2]);
        barrel.add(partMesh(mats.dark, [tube, lip]), partMesh(mats.canvas, [place(cyl(.024, .028, .05, 12), [.01, 0, 0], [0, 0, -Math.PI / 2])]));
        const muzzle = new THREE.Object3D();
        muzzle.position.set(.47, 0, 0);
        barrel.add(muzzle);
        pitch.add(barrel);
        tubes.push(barrel);
        muzzles.push(muzzle);
    }
    return {kind: 'main', yaw, pitch, barrels: tubes, muzzles, rest: 0};
}

function gunMount(mats) {
    const yaw = new THREE.Group();
    const shield = prism(chamfered(.13, .1, .03), chamfered(.09, .075, .02).map(([x, z]) => [x - .012, z]), .045);
    yaw.add(partMesh(mats.steel, [shield, place(cyl(.05, .055, .012, 18), [0, -.004, 0])]));
    const pitch = new THREE.Group();
    pitch.position.set(.05, .025, 0);
    const barrel = new THREE.Group();
    barrel.add(partMesh(mats.dark, [place(cyl(.0055, .008, .19, 10), [.095, 0, 0], [0, 0, -Math.PI / 2])]));
    const muzzle = new THREE.Object3D();
    muzzle.position.set(.195, 0, 0);
    barrel.add(muzzle);
    pitch.add(barrel);
    yaw.add(pitch);
    return {kind: 'gun', yaw, pitch, barrels: [barrel], muzzles: [muzzle], rest: 0};
}

// The 57 mm Mk 110: a small faceted stealth shield and a long thin barrel.
function gun57(mats) {
    const yaw = new THREE.Group();
    const shield = prism(chamfered(.09, .075, .025), chamfered(.058, .052, .017).map(([x, z]) => [x - .012, z]), .036);
    yaw.add(partMesh(mats.steel, [shield, place(cyl(.038, .042, .01, 16), [0, -.003, 0])]));
    const pitch = new THREE.Group();
    pitch.position.set(.035, .02, 0);
    const barrel = new THREE.Group();
    barrel.add(partMesh(mats.dark, [place(cyl(.0038, .0055, .13, 10), [.065, 0, 0], [0, 0, -Math.PI / 2]), place(cyl(.0062, .0062, .014, 10), [.125, 0, 0], [0, 0, -Math.PI / 2])]));
    const muzzle = new THREE.Object3D();
    muzzle.position.set(.135, 0, 0);
    barrel.add(muzzle);
    pitch.add(barrel);
    yaw.add(pitch);
    return {kind: 'gun', yaw, pitch, barrels: [barrel], muzzles: [muzzle], rest: 0};
}

function rotatingRadar(mats, width = .1, height = .03) {
    const group = new THREE.Group();
    group.add(partMesh(mats.dark, [place(box(.012, height, width), [.008, height / 2 + .012, 0]), place(cyl(.006, .008, .014, 8), [0, .007, 0])]));
    return group;
}

function flag(mats, x, y, z, size = .07) {
    const geometry = new THREE.PlaneGeometry(size, size * .62, 12, 4);
    geometry.translate(size / 2, 0, 0);
    const mesh = new THREE.Mesh(geometry, mats.flag);
    mesh.position.set(x, y, z);
    mesh.rotation.y = Math.PI;   // streams aft
    mesh.castShadow = true;
    return mesh;
}

// ---------------------------------------------------------------------------------------------------------
// Shared fittings
// ---------------------------------------------------------------------------------------------------------

function ciws(b, x, y, z, ry = 0) {
    b.add('steel', cyl(.02, .024, .03, 12), [x, y + .015, z]);
    b.add('white', cyl(.021, .021, .028, 14), [x, y + .044, z]);
    b.add('white', dome(.021), [x, y + .058, z]);
    b.add('dark', cyl(.005, .005, .05, 8), [x + Math.cos(ry) * .025, y + .036, z - Math.sin(ry) * .025], [0, ry, -Math.PI / 2 + .25]);
}

function vls(b, x, y, z, w, d) {
    b.add('vls', box(w, .006, d), [x, y + .003, z]);
}

// A flat-topped octagonal phased-array face leaning back a little. facing is the yaw of its normal: 0 faces
// forward, -π/2 starboard (+z), π/2 port.
function spyPanel(b, x, y, z, facing, r = .046) {
    b.add('dark', cyl(r, r, .008, 8).rotateY(Math.PI / 8).rotateZ(.26 - Math.PI / 2).rotateY(facing), [x, y, z]);
}

function funnel(b, x, y, w, d, h, rake = .02, tone = 'steel') {
    b.add(tone, prism(chamfered(w, d, Math.min(w, d) * .22), chamfered(w * .9, d * .88, Math.min(w, d) * .2).map(([px, pz]) => [px - rake, pz]), h), [x, y, 0]);
    b.add('black', prism(chamfered(w * .9, d * .88, Math.min(w, d) * .2).map(([px, pz]) => [px - rake, pz]), chamfered(w * .86, d * .84, Math.min(w, d) * .19).map(([px, pz]) => [px - rake * 1.1, pz]), .018), [x, y + h, 0]);
}

function tripodMast(b, x, y, height, spread = .05, z = 0) {
    const apex = [x - .02, y + height * .72, z];
    for (const [bx, bz] of [[x + spread * .9, 0], [x - spread * .6, spread], [x - spread * .6, -spread]]) {
        const from = new THREE.Vector3(bx, y, bz + z), to = new THREE.Vector3(...apex);
        const length = from.distanceTo(to);
        const leg = cyl(.0042, .0055, length, 6);
        const mid = from.clone().add(to).multiplyScalar(.5);
        const direction = to.clone().sub(from).normalize();
        const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
        leg.applyQuaternion(quaternion);
        b.add('dark', leg, [mid.x, mid.y, mid.z]);
    }
    b.add('dark', cyl(.0035, .0045, height * .4, 6), [apex[0], apex[1] + height * .2, z]);
    b.add('dark', cyl(.0025, .0025, .16, 5), [apex[0], apex[1] - .01, z], [Math.PI / 2, 0, 0]);
    b.add('steel', box(.04, .008, .05), [apex[0], apex[1] - .02, z]);
    b.add('white', sphere(.012, 12, 8), [apex[0] + .012, apex[1] + height * .1, z + .02]);
    b.add('white', sphere(.012, 12, 8), [apex[0] + .012, apex[1] + height * .1, z - .02]);
    b.add('dark', cyl(.0015, .0015, .09, 4), [apex[0], apex[1] + height * .42, z]);
    return new THREE.Vector3(apex[0], apex[1] + height * .4, z);
}

function navLights(b, x, y, halfBeam, mastTop) {
    b.add('lightRed', sphere(.0045, 8, 6), [x, y, -halfBeam]);
    b.add('lightGreen', sphere(.0045, 8, 6), [x, y, halfBeam]);
    if (mastTop) b.add('lightWhite', sphere(.0042, 8, 6), [mastTop.x, mastTop.y + .005, mastTop.z]);
}

function boat(b, x, y, z, color = 'orange') {
    b.add(color, place(new THREE.CapsuleGeometry(.014, .06, 4, 10), [0, 0, 0], [0, 0, Math.PI / 2], [1, .75, 1]), [x, y + .012, z]);
}

function windowsBand(b, x, y, z, length, height, axis = 'x', lit = false) {
    b.add(lit ? 'windowsLit' : 'glass', axis === 'x' ? box(.004, height, length) : box(length, height, .004), [x, y, z]);
}

// ---------------------------------------------------------------------------------------------------------
// Ship designs
// ---------------------------------------------------------------------------------------------------------

function deckAt(profile, x) {
    return profile.deckY(THREE.MathUtils.clamp(x / profile.spec.L + .5, 0, 1));
}

// Half-beam of the hull side at x and height y above the waterline, for fittings set into the side.
function hullSide(profile, x, y) {
    const s = THREE.MathUtils.clamp(x / profile.spec.L + .5, 0, 1);
    return lerp(profile.halfBeamDeck(s), profile.halfBeamWater(s), 1 - y / profile.deckY(s));
}

function addHull(b, spec, split, {deck = true, rail = true} = {}) {
    const s = split / spec.L + .5;
    b.add('hull', hullGeometry(spec, 0, s), [], [], [], 'aft');
    b.add('hull', hullGeometry(spec, s, 1), [], [], [], 'fore');
    if (deck) {
        b.add('deck', deckGeometry(spec, 0, s), [], [], [], 'aft');
        b.add('deck', deckGeometry(spec, s, 1), [], [], [], 'fore');
    }
    if (rail) {
        b.add('rail', railGeometry(spec, .04, s), [], [], [], 'aft');
        b.add('rail', railGeometry(spec, s, .97), [], [], [], 'fore');
    }
    return hullProfile(spec);
}

// The two-square ship: a Freedom-class littoral combat ship (118 m), the smallest US surface combatant. A
// semi-planing hull with a broad transom and four waterjets; one faceted, nearly full-width deckhouse with the
// bridge forward, an enclosed mast on top and the hangar aft; a big flight deck; a 57 mm gun, Naval Strike
// Missile canisters, RAM and 30 mm guns.
function littoral(b) {
    const spec = {L: 1.86, B: .3, draft: .05, freeboard: .1, sheerFwd: .05, sheerAft: 0, transom: .92, bowLen: .42, sternLen: .05, flare: .38, rake: .05, forefoot: .015, camber: .006};
    const P = addHull(b, spec, 0);
    const d = x => deckAt(P, x);
    const parts = {turrets: [], radars: [], launchers: [], flags: []};
    const base = d(-.1);
    // The deckhouse, with a roller door to the hangar in its after face.
    b.add('steel', prism(chamfered(.85, .27, .05), chamfered(.8, .23, .045), .1), [-.075, base, 0]);
    b.add('dark', box(.004, .078, .16), [-.492, base + .042, 0], [0, 0, -.245]);
    for (let i = 0; i < 6; i++) {
        const y = base + .008 + i * .013;
        b.add('steel', box(.003, .0025, .156), [-.506 + (y - base) * .25, y, 0], [0, 0, -.245]);
    }
    // Bridge: back-raked glass across the front and down the sides, wings, searchlights, side lights.
    b.add('steel', taper(.24, .23, .2, .2, .07, -.012), [.2, base + .1, 0]);
    b.add('glass', box(.004, .017, .17), [.307, base + .133, 0], [0, 0, .43]);
    roofRail(b, {x: .188, y: base + .17, w: .2, d: .2});
    for (const side of [1, -1]) {
        windowRow(b, {x: .194, y: base + .136, z: side * .1088, length: .15, axis: 'x', count: 7, h: .011});
        windowRow(b, {x: -.1, y: base + .055, z: side * .1255, length: .62, axis: 'x', count: 15, w: .009, h: .007});
        b.add('steel', box(.05, .006, .05), [.25, base + .14, side * .13]);
        searchlight(b, .26, base + .143, side * .14, -side * Math.PI / 4);
    }
    navLights(b, .24, base + .1475, .152);
    // The enclosed mast: a faceted pyramid with domes on its flanks, the air-search radar and a light pole on top.
    b.add('steel', prism(chamfered(.13, .15, .035), chamfered(.06, .07, .016), .21), [.15, base + .17, 0]);
    const mastY = base + .38;
    b.add('steel', box(.04, .008, .05), [.15, mastY, 0]);
    for (const side of [1, -1]) b.add('white', sphere(.014, 12, 8), [.15, base + .27, side * .066]);
    b.add('dark', cyl(.0016, .0016, .095, 5), [.15, mastY + .0475, 0]);
    b.add('lightWhite', sphere(.0042, 8, 6), [.15, mastY + .097, 0]);
    const radar = rotatingRadar(b.materials, .07, .028);
    radar.position.set(.15, mastY + .004, 0);
    parts.radars.push({object: radar, speed: 2.6, x: radar.position.x});
    whips(b, [[.06, base + .1, .09, .12], [.06, base + .1, -.09, .12], [-.2, base + .1, .1, .1]]);
    // RAM on the hangar roof.
    b.add('steel', box(.05, .02, .05), [-.4, base + .11, 0]);
    b.add('white', box(.045, .036, .04), [-.4, base + .138, 0]);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) b.add('dark', box(.003, .007, .007), [-.376, base + .127 + r * .01, -.015 + c * .01]);
    for (const side of [1, -1]) {
        // Exhaust stacks, 30 mm guns, life rafts and the missile canisters behind the gun, angled outboard.
        b.add('steel', prism(chamfered(.07, .05, .012), chamfered(.058, .04, .01).map(([x, z]) => [x - .012, z]), .075), [-.27, base + .1, side * .08]);
        b.add('black', box(.045, .006, .035), [-.282, base + .178, side * .08]);
        b.add('steel', box(.03, .018, .03), [-.02, base + .1, side * .09]);
        b.add('dark', place(cyl(.0028, .0028, .05, 6), [0, 0, 0], [0, 0, Math.PI / 2]), [.01, base + .112, side * .09]);
        raftRack(b, {x: .04, y: base + .1, z: side * .06, count: 3});
        canisterLauncher(b, {x: .43, y: d(.43), z: side * .065, yaw: -side * .5});
        // The side door the boats launch from, low in the hull, and the safety nets around the flight deck.
        b.add('dark', box(.08, .035, .003), [-.3, .055, side * (hullSide(P, -.3, .055) + .0016)]);
        b.add('dark', box(.34, .002, .022), [-.69, d(-.69) - .003, side * .16], [side * .3, 0, 0]);
    }
    // Four waterjets and the stern door in the transom.
    for (const z of [-.105, -.035, .035, .105]) b.add('dark', place(cyl(.017, .02, .03, 12), [0, 0, 0], [0, 0, Math.PI / 2]), [-.935, .006, z]);
    b.add('dark', box(.003, .045, .15), [-.9325, .07, 0]);
    deckFittings(b, P, {x0: -.85, x1: .6, spacing: .15});
    anchorGear(b, P, {x: .7, spread: .035});
    for (const [x, z, m] of [[-.7, .06, 'crewBlue'], [-.78, -.08, 'yellow'], [.66, .05, 'crewBlue'], [-.5, .12, 'crewBlue']]) sailor(b, x, d(x), z, m);
    portholes(b, P, {x0: -.75, x1: -.39, y: .062, spacing: .06});
    portholes(b, P, {x0: -.21, x1: .5, y: .062, spacing: .06});
    vents(b, [[.53, d(.53), .06], [.53, d(.53), -.06]]);
    const gun = gun57(b.materials);
    gun.yaw.position.set(.6, d(.6), 0);
    parts.turrets.push(gun);
    for (const side of [1, -1]) parts.launchers.push(new THREE.Vector3(.43, d(.43) + .03, side * .065));
    parts.flags.push(flag(b.materials, .15, mastY + .072, 0, .05));
    return {spec, profile: P, parts, deckTexture: () => steelDeckTexture({helo: [0, .23], seed: 11}), number: [.5, .032, .2, .06], stripe: [.66, .05, .55, .012], bootTop: .022, weapons: ['gun', 'gun', 'missile']};
}

// Ticonderoga-class cruiser (173 m): two deckhouses carrying the four SPY-1 faces on their cut-off corners,
// lattice masts, two funnels, two Mk 41 launchers and two 5-inch guns.
function cruiser(b) {
    const spec = {L: 2.86, B: .38, draft: .08, freeboard: .085, sheerFwd: .042, sheerAft: .004, transom: .8, bowLen: .38, sternLen: .1, flare: .26, rake: .03, forefoot: .05, camber: .007};
    const P = addHull(b, spec, -.05);
    const d = x => deckAt(P, x);
    const parts = {turrets: [], radars: [], launchers: [], flags: []};
    const fy = d(.42), ay = d(-.55);
    vls(b, .83, d(.83), 0, .22, .17);
    vls(b, -.96, d(-.96), 0, .2, .17);
    // Forward deckhouse: two levels and the bridge, the forward SPY faces on its cut corners.
    b.add('steel', prism(chamfered(.62, .3, .07), chamfered(.58, .27, .065).map(([x, z]) => [x - .01, z]), .1), [.42, fy, 0]);
    b.add('steel', taper(.36, .24, .32, .21, .08, -.01), [.5, fy + .1, 0]);
    b.add('steel', taper(.2, .22, .17, .2, .05, -.01), [.56, fy + .18, 0]);
    b.add('glass', box(.004, .014, .17), [.648, fy + .207, 0], [0, 0, .46]);
    b.add('steel', box(.05, .006, .34), [.58, fy + .22, 0]);
    // Aft deckhouse, its after corners cut for the other two faces.
    b.add('steel', prism(chamfered(.5, .28, .07), chamfered(.46, .25, .065).map(([x, z]) => [x + .01, z]), .09), [-.55, ay, 0]);
    b.add('steel', taper(.26, .2, .22, .18, .06, .01), [-.58, ay + .09, 0]);
    for (const side of [1, -1]) {
        spyPanel(b, .681, fy + .052, side * .109, -side * Math.PI / 4);
        spyPanel(b, -.751, ay + .045, side * .099, -side * Math.PI * .75, .042);
    }
    const foreTop = latticeMast(b, {x: .4, y: fy + .18, height: .32, base: .075, top: .03});
    const aftTop = latticeMast(b, {x: -.42, y: ay + .09, height: .24, base: .05, top: .032, crown: false});
    ciws(b, .2, fy + .1, 0);
    ciws(b, -.74, ay + .09, 0, Math.PI);
    funnel(b, .03, d(.03), .13, .15, .15, .02);
    funnel(b, -.3, d(-.3), .13, .15, .15, .02);
    navLights(b, .565, fy + .228, .165, foreTop);
    const radar = rotatingRadar(b.materials, .13, .045);
    radar.position.set(aftTop.x, aftTop.y + .003, 0);
    parts.radars.push({object: radar, speed: 1.3, x: radar.position.x});
    for (const [x, rest] of [[1.06, 0], [-1.2, Math.PI]]) {
        const gun = gunMount(b.materials);
        gun.yaw.position.set(x, d(x), 0);
        gun.rest = rest;
        gun.yaw.rotation.y = rest;
        parts.turrets.push(gun);
    }
    // Windows, railings, electronic warfare, domes and searchlights.
    windowsAround(b, {x: .495, y: fy + .14, w: .34, d: .225, spacing: .026});
    windowsAround(b, {x: -.575, y: ay + .12, w: .24, d: .19, spacing: .03});
    outlineRail(b, chamfered(.58, .27, .065), {x: .41, y: fy + .1});
    roofRail(b, {x: .49, y: fy + .18, w: .32, d: .21});
    roofRail(b, {x: .55, y: fy + .23, w: .17, d: .2});
    outlineRail(b, chamfered(.46, .25, .065), {x: -.54, y: ay + .09});
    ewArrays(b, {x: .28, y: fy + .065, halfBeam: .14});
    for (const side of [1, -1]) {
        windowRow(b, {x: .414, y: fy + .055, z: side * .1433, length: .38, axis: 'x', count: 10});
        windowRow(b, {x: -.544, y: ay + .05, z: side * .1332, length: .28, axis: 'x', count: 7});
        searchlight(b, .59, fy + .223, side * .16, -side * .6);
        b.add('white', sphere(.017, 12, 8), [.28, fy + .118, side * .1]);
        b.add('white', sphere(.014, 12, 8), [-.66, ay + .163, side * .07]);
        // Boats, life rafts, Harpoons on the fantail and torpedo tubes amidships.
        boat(b, -.14, d(-.14) + .02, side * .15, side > 0 ? 'orange' : 'white');
        raftRack(b, {x: .08, y: d(.08), z: side * .15, count: 4});
        raftRack(b, {x: -.42, y: ay + .09, z: side * .1, count: 2});
        raftRack(b, {x: .2, y: fy + .1, z: side * .11, count: 2});
        canisterLauncher(b, {x: -1.33, y: d(-1.33), z: side * .06, yaw: -side * .45});
        torpedoTubes(b, {x: .01, y: d(.01), z: side * .155});
    }
    whips(b, [[.59, fy + .223, .145, .1], [.59, fy + .223, -.145, .1], [-.675, ay + .15, .085, .1], [-.675, ay + .15, -.085, .1], [-1.38, d(-1.38), .12, .07], [-1.38, d(-1.38), -.12, .07]]);
    deckFittings(b, P, {x0: -1.3, x1: 1.25, spacing: .18});
    anchorGear(b, P, {x: 1.2, spread: .045});
    for (const [x, z] of [[1.18, .05], [-1.32, .12], [-1.36, -.1], [.08, .1], [-.12, -.12]]) sailor(b, x, d(x), z, 'crewBlue');
    portholes(b, P, {x0: -1.25, x1: .9, y: .05, spacing: .05});
    vents(b, [[.95, d(.95), .1], [.95, d(.95), -.1], [-.85, d(-.85), .12], [-.85, d(-.85), -.12], [-.15, d(-.15), .05], [.05, d(.05), -.12]]);
    parts.launchers.push(new THREE.Vector3(.83, d(.83) + .01, 0), new THREE.Vector3(-.96, d(-.96) + .01, 0));
    parts.flags.push(flag(b.materials, foreTop.x, foreTop.y + .02, 0, .07));
    return {spec, profile: P, parts, deckTexture: () => steelDeckTexture({seed: 23}), number: [.86, .022, .24, .058], stripe: [1.0, .06, .55, .014], bootTop: .022, weapons: ['missile', 'gun', 'missile']};
}

// Iowa-class battleship (270 m): three triple 16-inch turrets on a teak deck, the stepped tower bridge and two
// funnels, and a wide 01 level carrying the twin 5-inch mounts, Tomahawk box launchers, Harpoons and CIWS.
function battleship(b) {
    const spec = {L: 3.86, B: .54, draft: .11, freeboard: .105, sheerFwd: .075, sheerAft: .016, transom: .42, bowLen: .36, sternLen: .16, flare: .32, rake: .045, forefoot: .06, camber: .012};
    const P = addHull(b, spec, -.12);
    const d = x => deckAt(P, x);
    const parts = {turrets: [], radars: [], launchers: [], flags: []};
    const level = d(0) + .07;
    // Barbettes for the three main turrets.
    b.add('steel', cyl(.15, .155, .03, 28), [1.18, d(1.18) + .015, 0]);
    b.add('steel', cyl(.15, .155, .09, 28), [.8, d(.8) + .045, 0]);
    b.add('steel', cyl(.15, .155, .03, 28), [-1.2, d(-1.2) + .015, 0]);
    // Superstructure: 01 level, conning tower, the stepped forward tower, bridge wings and directors.
    b.add('steel', taper(1.2, .46, 1.17, .44, .07), [-.03, d(-.03), 0]);
    b.add('steel', place(cyl(.075, .08, .13, 22), [0, 0, 0], [0, 0, 0], [1, 1, .8]), [.47, level + .065, 0]);
    b.add('steel', taper(.34, .3, .3, .27, .07, -.01), [.31, level, 0]);
    b.add('steel', taper(.26, .24, .22, .2, .07, -.01), [.3, level + .07, 0]);
    b.add('steel', taper(.19, .2, .16, .18, .05, -.01), [.31, level + .14, 0]);
    b.add('glass', box(.004, .013, .15), [.3935, level + .167, 0], [0, 0, .46]);
    windowsBand(b, .31, level + .167, .097, .12, .01, 'z');
    windowsBand(b, .31, level + .167, -.097, .12, .01, 'z');
    b.add('steel', box(.04, .005, .26), [.35, level + .155, 0]);
    b.add('lightRed', sphere(.0045, 8, 6), [.35, level + .162, -.128]);
    b.add('lightGreen', sphere(.0045, 8, 6), [.35, level + .162, .128]);
    b.add('steel', rbox(.09, .05, .08, .01), [.31, level + .215, 0]);
    b.add('dark', cyl(.008, .008, .2, 8), [.31, level + .225, 0], [Math.PI / 2, 0, 0]);
    b.add('steel', rbox(.07, .04, .07, .01), [.29, level + .27, 0]);
    // Funnels, main mast and the aft tower.
    funnel(b, .08, level, .18, .15, .17, .03);
    funnel(b, -.25, level, .17, .14, .15, .03);
    const mastTop = tripodMast(b, -.08, level, .42, .06);
    b.add('lightWhite', sphere(.0042, 8, 6), [mastTop.x, mastTop.y + .005, mastTop.z]);
    b.add('steel', taper(.22, .24, .18, .2, .08, .01), [-.46, level, 0]);
    b.add('steel', rbox(.07, .045, .07, .01), [-.47, level + .1, 0]);
    b.add('dark', cyl(.006, .006, .15, 8), [-.47, level + .11, 0], [Math.PI / 2, 0, 0]);
    for (const side of [-1, 1]) {
        // Twin 5-inch mounts, armored box launchers, Harpoons and CIWS.
        for (const x of [.36, .14, -.1, -.34]) {
            b.add('steel', rbox(.075, .04, .065, .008), [x, level + .02, side * .2]);
            for (const offset of [-.014, .014]) b.add('dark', cyl(.0035, .0045, .09, 6), [x + .065, level + .025, side * .2 + offset], [0, 0, -Math.PI / 2 + .08]);
        }
        b.add('steel', rbox(.13, .035, .05, .006), [-.4, level + .017, side * .14]);
        ciws(b, .52, level, side * .14);
        ciws(b, -.58, level, side * .13, Math.PI);
        canisterLauncher(b, {x: -.2, y: level, z: side * .125, yaw: -side * .9});
        // Boats with their crane, life rafts, searchlights.
        boat(b, -.08, level + .005, side * .14, 'white');
        b.add('dark', box(.004, .09, .004), [-.02, level + .045, side * .185]);
        b.add('dark', place(box(.104, .004, .004), [0, 0, 0], [0, 0, 2.85]), [-.07, level + .105, side * .185]);
        raftRack(b, {x: .04, y: level, z: side * .125, count: 4});
        searchlight(b, .25, level + .19, side * .075, -side * .5);
        searchlight(b, -.5, level + .08, side * .08, -side * 2.2);
    }
    windowsAround(b, {x: .305, y: level + .035, w: .32, d: .285, spacing: .03});
    windowsAround(b, {x: .295, y: level + .105, w: .24, d: .22, spacing: .028});
    windowsAround(b, {x: -.455, y: level + .04, w: .2, d: .22, spacing: .03});
    windowsAround(b, {x: -.03, y: d(-.03) + .035, w: 1.185, d: .45, spacing: .045});
    roofRail(b, {x: .3, y: level + .07, w: .3, d: .27});
    roofRail(b, {x: -.45, y: level + .08, w: .18, d: .2});
    anchorGear(b, P, {x: 1.5, spread: .07});
    for (const [x, z] of [[1.45, .06], [1.42, -.05], [-.7, .17], [-.75, -.15], [-1.6, .05], [.6, .21], [-.05, -.2]]) sailor(b, x, d(x), z, 'crewBlue');
    deckFittings(b, P, {x0: -1.85, x1: 1.75, spacing: .2});
    portholes(b, P, {x0: -1.7, x1: 1.2, y: .072, spacing: .048});
    vents(b, [[1.0, d(1.0), .16], [1.0, d(1.0), -.16], [-.9, d(-.9), .17], [-.9, d(-.9), -.17], [-1.5, d(-1.5), .1], [-1.5, d(-1.5), -.1], [1.45, d(1.45), .12], [1.45, d(1.45), -.12]]);
    whips(b, [[.29, level + .29, .03, .12], [-.47, level + .1225, .03, .1], [.555, level, .19, .09], [.555, level, -.19, .09], [-.61, level, .19, .09], [-.61, level, -.19, .09]]);
    const radar = rotatingRadar(b.materials, .15, .05);
    radar.position.set(mastTop.x + .01, mastTop.y - .07, 0);
    parts.radars.push({object: radar, speed: 1.1, x: radar.position.x});
    const placements = [[1.18, d(1.18) + .03, 0], [.8, d(.8) + .09, 0], [-1.2, d(-1.2) + .03, Math.PI]];
    for (const [x, y, rest] of placements) {
        const turret = mainTurret(b.materials, 3);
        turret.yaw.position.set(x, y, 0);
        turret.yaw.rotation.y = rest;
        turret.rest = rest;
        parts.turrets.push(turret);
    }
    parts.flags.push(flag(b.materials, mastTop.x, mastTop.y + .03, 0, .09));
    return {spec, profile: P, parts, deckTexture: () => teakDeckTexture(31), number: [1.3, .03, .32, .07], stripe: [1.55, .07, .5, .016], bootTop: .028, weapons: ['salvo']};
}

const CARRIER_DECK = [
    [2.43, -.13], [2.43, .13], [2.12, .3], [1.4, .4], [.4, .45], [-.2, .47], [-1.6, .45], [-2.43, .38],
    [-2.43, -.32], [-1.5, -.44], [-.5, -.55], [.55, -.59], [.95, -.44], [1.6, -.33], [2.12, -.25],
];

// z of the flight deck's edge at x, on the starboard (side 1) or port (side -1) side.
function deckEdge(x, side) {
    const points = CARRIER_DECK.filter(([, z]) => Math.sign(z) === side).sort((p, q) => p[0] - q[0]);
    for (let i = 0; i < points.length - 1; i++) {
        const [x0, z0] = points[i], [x1, z1] = points[i + 1];
        if (x >= x0 && x <= x1) return lerp(z0, z1, (x - x0) / (x1 - x0));
    }
    return (x < points[0][0] ? points[0] : points.at(-1))[1];
}

// The strike jet the carrier launches: the same fighter as its deck park, with its landing gear (named 'gear',
// so it can be retracted once airborne).
export function jetMesh(mats, scale = 1.1, team = 'gpt') {
    const pieces = (FIGHTERS[team] || FIGHTERS.gpt).model(scale);
    const group = new THREE.Group();
    for (const [part, key] of Object.entries(FIGHTER_PARTS)) {
        if (pieces[part]?.length) group.add(partMesh(mats[key] || mats.jet, pieces[part]));
    }
    if (pieces.gear?.length) {
        const gear = partMesh(mats.dark || mats.jet, pieces.gear);
        gear.name = 'gear';
        group.add(gear);
    }
    return group;
}
export { FIGHTER_RIDE_HEIGHT };

// Gerald R. Ford-class carrier (337 m): the angled flight deck with a deck park of Super Hornets, Hawkeyes,
// Seahawks and tractors; the island set well aft with its flat radar faces; deck-edge antennas, sponsons with
// CIWS and missile launchers, and hangar openings under the overhang.
function carrier(b) {
    const spec = {L: 4.62, B: .5, draft: .11, freeboard: .17, sheerFwd: .02, sheerAft: 0, transom: .86, bowLen: .32, sternLen: .08, flare: .42, rake: .06, forefoot: .07, camber: 0};
    const P = addHull(b, spec, -.2, {deck: true, rail: false});
    const parts = {turrets: [], radars: [], launchers: [], flags: []};
    const deckY = .175, top = deckY + .028;
    const bounds = {minX: -2.43, maxX: 2.43, minZ: -.59, maxZ: .47};
    // The flight deck slab, split at the break so it can tear in two.
    for (const [side, keep] of [['fore', x => x >= -.2], ['aft', x => x < -.2]]) {
        const outline = clipPolygon(CARRIER_DECK, keep);
        if (outline.length < 3) continue;
        const slab = extrudeXZ(outline, .028);
        const p = slab.attributes.position, uv = slab.attributes.uv;
        for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) - bounds.minX) / (bounds.maxX - bounds.minX), 1 - (p.getZ(i) - bounds.minZ) / (bounds.maxZ - bounds.minZ));
        b.add('flight', slab, [0, deckY, 0], [], [], side);
    }
    // Hangar gallery under the overhang and supports for the angled deck.
    for (const [x, z, w, d] of [[-.4, -.33, .9, .16], [.4, -.33, .5, .12], [-1.6, .3, .5, .08], [1.1, .3, .4, .08]]) b.add('steel', box(w, .03, d), [x, deckY - .015, z]);
    for (const x of [-1.2, -.6, 0, .5]) b.add('dark', box(.02, .05, .02), [x, deckY - .03, -.45]);
    // The island: stacked levels, bridge, pri-fly, the radar block with its three flat faces, the mast on top.
    const ix = -.4, iz = .38;
    b.add('steel', taper(.4, .11, .38, .1, .09), [ix, top, iz]);
    b.add('steel', taper(.32, .1, .3, .09, .07), [ix + .02, top + .09, iz]);
    b.add('steel', taper(.22, .11, .2, .1, .05), [ix + .06, top + .16, iz]);
    b.add('glass', box(.004, .016, .1), [ix + .167, top + .185, iz], [0, 0, .2]);
    windowsBand(b, ix + .06, top + .185, iz - .0545, .18, .012, 'z');
    windowsBand(b, ix - .08, top + .125, iz - .0495, .1, .01, 'z', true);
    b.add('steel', box(.08, .03, .12), [ix - .1, top + .175, iz]);
    windowsBand(b, ix - .1, top + .178, iz - .0625, .07, .016, 'z');
    b.add('steel', taper(.13, .095, .12, .085, .055), [ix + .03, top + .21, iz]);
    spyPanel(b, ix + .0935, top + .2375, iz, 0, .025);
    spyPanel(b, ix + .03, top + .2375, iz - .046, Math.PI / 2, .025);
    spyPanel(b, ix + .03, top + .2375, iz + .046, -Math.PI / 2, .025);
    const mastTop = tripodMast(b, ix + .04, top + .265, .28, .035, iz);
    b.add('white', sphere(.016, 14, 10), [ix + .13, top + .22, iz + .03]);
    b.add('white', sphere(.02, 14, 10), [ix - .075, top + .202, iz + .035]);
    windowsAround(b, {x: ix, y: top + .045, z: iz, w: .39, d: .105, spacing: .03});
    windowsAround(b, {x: ix + .02, y: top + .105, z: iz, w: .316, d: .098, spacing: .028});
    roofRail(b, {x: ix + .06, y: top + .21, z: iz, w: .2, d: .1});
    whips(b, [[ix - .135, top + .19, iz + .045, .1], [ix + .13, top + .21, iz - .035, .08]]);
    b.add('lightRed', sphere(.0045, 8, 6), [ix + .06, top + .2, iz - .056]);
    b.add('lightGreen', sphere(.0045, 8, 6), [ix + .06, top + .2, iz + .056]);
    b.add('lightWhite', sphere(.0042, 8, 6), [mastTop.x, mastTop.y + .005, mastTop.z]);
    // The deck park: the fleet's fighters along the bow and the starboard side, Hawkeyes, Seahawks, tractors.
    // They are loose bodies on the deck (deck-cargo.js), not part of the hull: a listing or sinking carrier
    // sheds them over the side, and a hit among them wrecks and scatters them.
    const jets = (FIGHTERS[b.team] || FIGHTERS.gpt).model(.95);
    const cargo = {kinds: {}, items: [], deck: CARRIER_DECK, island: {minX: -.62, maxX: -.18, minZ: .32, maxZ: .45}};
    cargo.kinds.jet = {parts: Object.fromEntries(Object.entries(FIGHTER_PARTS).map(([part, key]) => [key, jets[part] || []])), radius: .065, mass: 20000, draft: .008};
    // Parked on their landing gear.
    cargo.kinds.jet.parts.dark = [...cargo.kinds.jet.parts.dark, ...(jets.gear || [])];
    const park = [[2.15, .14, 2.4], [1.98, .22, 2.4], [1.81, .28, 2.4], [1.64, .33, 2.4], [1.47, .36, 2.4], [1.75, -.22, -.2],
        [-.78, .34, 2.25], [-1.0, .34, 2.25], [-1.22, .34, 2.25], [-1.44, .34, 2.25], [-1.66, .34, 2.25], [-1.88, .33, 2.25], [-2.1, .31, 2.25],
        [-.9, .19, 2.25], [-1.12, .19, 2.25], [-1.34, .19, 2.25], [-1.56, .19, 2.25], [-1.78, .18, 2.25], [1.2, .38, 2.5], [1.0, .4, 2.5]];
    for (const [x, z, yaw] of park) cargo.items.push({kind: 'jet', x, y: top + FIGHTER_RIDE_HEIGHT * .95, z, yaw});
    // The Hawkeyes wear the fleet's paint too, so every plane on the deck is in its colors.
    const hawk = hawkeye(1);
    cargo.kinds.hawkeye = {parts: {fighter: hawk.gray, white: hawk.white}, radius: .1, mass: 23000, draft: .008};
    for (const [x, z, yaw] of [[.3, .33, 2.6], [.6, .35, 2.6]]) cargo.items.push({kind: 'hawkeye', x, y: top + .006, z, yaw});
    cargo.kinds.seahawk = {parts: {jet: seahawk(1).gray}, radius: .055, mass: 10000, draft: .01};
    for (const [x, z, yaw] of [[-2.25, .24, 1.57], [-2.28, .07, 1.57]]) cargo.items.push({kind: 'seahawk', x, y: top, z, yaw});
    cargo.kinds.tug = {parts: tugParts(), radius: .022, mass: 8000, draft: .004};
    for (const [x, z, yaw] of [[-.66, .2, 0], [1.3, .24, .8], [-1.95, .2, 1.2], [.15, .38, 2]]) cargo.items.push({kind: 'tug', x, y: top, z, yaw});
    parts.cargo = cargo;
    // The flight deck crew, in their jerseys: at the catapult, round the parked jets, by the island and the fuel.
    const jerseys = ['yellow', 'crewPurple', 'crewGreen', 'crewRed', 'crewBrown', 'white', 'crewBlue'];
    for (const [x, z, n] of [[1.0, -.2, 4], [1.45, .1, 3], [2.15, .1, 2], [1.75, .2, 3], [1.3, .3, 3], [.45, .24, 3], [-.15, .3, 4], [-.62, .27, 2], [-1.05, .26, 4], [-1.5, .27, 3], [-1.85, .1, 3], [-2.15, .16, 2], [.9, .3, 2]]) {
        crewGroup(b, x, top, z, jerseys, n, .04);
    }
    // Hangar openings under the overhang, deck-edge antennas folded outboard, sponsons with launchers and CIWS.
    for (const x of [.95, .35, -1.25]) b.add('black', box(.22, .05, .003), [x, .13, hullSide(P, x, .13) + .0016]);
    b.add('black', box(.2, .05, .003), [-.75, .13, -(hullSide(P, -.75, .13) + .0016)]);
    for (const x of [-2.0, -1.5, -1.0, -.1, .7, 1.6]) b.add('dark', cyl(.0018, .0018, .12, 4), [x, deckY + .051, deckEdge(x, -1) - .047], [-.9, 0, 0]);
    for (const [x, s] of [[1.98, 1], [-2.12, -1], [-2.2, 1]]) {
        const z = deckEdge(x, s) + s * .03;
        b.add('steel', box(.075, .012, .07), [x, deckY - .018, z]);
        b.add('white', box(.04, .028, .05), [x, deckY + .002, z]);
        b.add('dark', box(.004, .022, .042), [x + .021, deckY + .002, z]);
    }
    for (const [x, s] of [[2.15, 1], [2.15, -1], [-2.3, 1], [-2.3, -1]]) {
        const z = deckEdge(x, s) + s * .028;
        b.add('steel', box(.06, .01, .06), [x, deckY - .04, z]);
        ciws(b, x, deckY - .035, z, x > 0 ? 0 : Math.PI);
    }
    anchorGear(b, P, {x: 2.0, spread: .07});
    const radar = rotatingRadar(b.materials, .12, .06);
    radar.position.set(mastTop.x, mastTop.y - .1, mastTop.z);
    parts.radars.push({object: radar, speed: 1.6, x: radar.position.x});
    const radar2 = rotatingRadar(b.materials, .09, .03);
    radar2.position.set(ix - .12, top + .19, iz - .02);
    parts.radars.push({object: radar2, speed: -2.1, x: radar2.position.x});
    parts.flags.push(flag(b.materials, mastTop.x, mastTop.y + .03, mastTop.z, .09));
    parts.catapult = {start: new THREE.Vector3(1.0, top + .015, -.05), end: new THREE.Vector3(2.4, top + .015, -.04)};
    return {spec, profile: P, parts, deckTexture: () => steelDeckTexture({seed: 41}), number: [1.7, .05, .34, .075], stripe: [1.95, .08, .45, .016], bootTop: .026, weapons: ['strike'], islandZ: iz};
}

// Keep the part of a polygon on one side of a vertical cut (x = constant), adding the cut edge.
function clipPolygon(points, keep) {
    const out = [];
    const cut = -.2;
    for (let i = 0; i < points.length; i++) {
        const a = points[i], c = points[(i + 1) % points.length];
        const inA = keep(a[0]), inC = keep(c[0]);
        if (inA) out.push(a);
        if (inA !== inC) {
            const t = (cut - a[0]) / (c[0] - a[0]);
            out.push([cut, a[1] + (c[1] - a[1]) * t]);
        }
    }
    return out;
}

function submarine(b) {
    const L = 2.7;
    const axis = -.095;
    const parts = {turrets: [], radars: [], launchers: [], flags: []};
    const profile = [[1.35, 0], [1.335, .05], [1.29, .093], [1.2, .127], [1.04, .149], [.7, .155], [-.45, .155], [-.78, .142], [-1.0, .115], [-1.16, .08], [-1.27, .045], [-1.33, .02], [-1.35, 0]];
    for (const [side, keep] of [['fore', x => x >= 0], ['aft', x => x <= 0]]) {
        const points = profile.filter(([x]) => keep(x));
        if (side === 'fore') points.push([0, .155]); else points.unshift([0, .155]);
        b.add('rubber', lathe(points, 40), [0, axis, 0], [], [], side);
    }
    b.add('rubber', box(1.7, .006, .07), [.05, .058, 0], [], [], 'fore');
    // The missile deck: a raised casing aft of the sail with the 24 Trident hatches in two rows and limber holes
    // along its sides; cleats along the deck.
    b.add('rubber', rbox(1.0, .024, .1, .01), [-.2, .066, 0]);
    for (let i = 0; i < 12; i++) {
        for (const z of [-.024, .024]) {
            const x = .26 - i * .08;
            b.add('dark', box(.034, .003, .034), [x, .0785, z]);
            b.add('rubber', box(.028, .004, .028), [x, .079, z]);
        }
    }
    for (let x = -.66; x <= .26; x += .04) for (const side of [1, -1]) b.add('black', box(.02, .005, .002), [x, .066, side * .0505]);
    for (const [x, y] of [[1.0, .057], [.82, .0635], [-.75, .0635], [-.88, .037]]) b.add('dark', box(.012, .005, .006), [x, y, 0]);
    // The sail, with planes, bridge windows and masts.
    const sail = [];
    for (let i = 0; i < 24; i++) {
        const a = i / 24 * Math.PI * 2;
        const x = Math.cos(a) > 0 ? Math.cos(a) * .12 : Math.cos(a) * .24;
        sail.push([x, Math.sin(a) * .042 * (Math.cos(a) > 0 ? 1 : 1 - Math.pow(-Math.cos(a), 3) * .55)]);
    }
    b.add('rubber', extrudeXZ(sail.reverse(), .2), [.58, .035, 0]);
    b.add('rubber', box(.08, .008, .27), [.6, .17, 0]);
    b.add('team', box(.2, .012, .086), [.56, .229, 0]);
    for (const [x, h, r] of [[.6, .09, .006], [.55, .07, .005], [.5, .05, .008], [.64, .06, .004]]) b.add('dark', cyl(r, r, h, 8), [x, .235 + h / 2, 0]);
    for (const side of [1, -1]) b.add('glass', box(.012, .007, .003), [.675, .214, side * .0275], [0, side * .43, 0]);
    b.add('rubber', prism([[-1.2, -.006], [-1.02, -.006], [-1.02, .006], [-1.2, .006]], [[-1.22, -.004], [-1.14, -.004], [-1.14, .004], [-1.22, .004]], .16), [0, -.04, 0]);
    parts.torpedo = new THREE.Vector3(1.3, -.04, 0);
    parts.flags.push(flag(b.materials, .52, .28, 0, .06));
    const spec = {L, B: .31, draft: .25, freeboard: .06};
    return {spec, profile: null, parts, deckTexture: () => steelDeckTexture({seed: 51, tone: '#26292c'}), number: [0, 0, 0, 0], stripe: [9, 0, 0, 0], bootTop: -1, weapons: ['subMissile'], submarine: true};
}

const DESIGNS = {Carrier: carrier, Battleship: battleship, Cruiser: cruiser, Submarine: submarine, Destroyer: littoral};

// ---------------------------------------------------------------------------------------------------------
// A ship in the fleet: its model, how it rides the sea, burns, fights and sinks.
// ---------------------------------------------------------------------------------------------------------

export class Ship {
    constructor(type, team, shared, textures) {
        this.type = type;
        this.team = team.id;
        this.teamInfo = team;
        this.state = 'afloat';
        this.hits = new Set();
        this.uniforms = {
            inverse: {value: new THREE.Matrix4()},
            burn: {value: Array.from({length: 6}, () => new THREE.Vector4(0, 0, 0, 0))},
            holes: {value: Array.from({length: 12}, () => new THREE.Vector4(0, 0, 0, 0))},
            teamColor: {value: new THREE.Color(team.color)},
            numberMap: {value: hullNumberTexture(CODES[team.id][type])},
            number: {value: new THREE.Vector4()},
            stripe: {value: new THREE.Vector4()},
            bootTop: {value: .02},
            paint: team.paint,
            superstructure: team.superstructure,
            fighter: FIGHTERS[team.id]?.color,
        };
        const scale = classScale(type);
        this.scale = scale;
        const builder = new ShipBuilder(SPLITS[type]);
        builder.post = new THREE.Matrix4().makeScale(scale.x, scale.y, scale.z);
        // Moving parts are created during the design, so the builder needs the materials up front.
        const deckTextures = {deck: null, vls: textures.vls, rail: textures.rail};
        const mats = shipMaterials(shared, this.uniforms, deckTextures);
        mats.flag = textures.flags[team.id];
        mats.fighter = mats.fighter || mats.jet;
        Object.assign(mats, fighterDecals(team.id));
        builder.materials = mats;
        builder.team = team.id;
        const design = DESIGNS[type](builder);
        mats.deck.map = design.deckTexture();
        mats.deck.needsUpdate = true;
        if (type === 'Carrier') {
            mats.flight = mats.deck.clone();
            mats.flight.map = flightDeckTexture({bounds: {minX: -2.43, maxX: 2.43, minZ: -.59, maxZ: .47}, outline: CARRIER_DECK, mascot: team.id === 'gpt' ? 'codex' : 'claude', seed: team.id === 'gpt' ? 5 : 9});
            mats.flight.onBeforeCompile = mats.deck.onBeforeCompile;
            mats.flight.customProgramCacheKey = mats.deck.customProgramCacheKey;
        }
        const [nx, ny, nw, nh] = design.number, [sx0, sw, slant, thin] = design.stripe;
        this.uniforms.number.value.set(nx * scale.x, ny * scale.y, nw * scale.x, nh * scale.y);
        this.uniforms.stripe.value.set(sx0 * scale.x, sw * scale.x, slant * scale.x / scale.y, thin * scale.x);
        this.uniforms.bootTop.value = design.bootTop * scale.y;
        this.design = design;
        this.spec = design.spec;
        this.class = CLASSES[type];
        this.length = CLASSES[type].length / METERS_PER_SQUARE;
        this.beam = (CLASSES[type].waterline || CLASSES[type].beam) / METERS_PER_SQUARE;
        this.materials = mats;
        // Split point between the halves (where the hull breaks).
        this.split = SPLITS[type] * scale.x;
        // Moving parts were modeled in model units too: move them to scale.
        for (const turret of design.parts.turrets) {
            turret.yaw.position.multiply(scale);
            turret.yaw.scale.set(scale.x, scale.y, scale.z);
        }
        for (const radar of design.parts.radars) {
            radar.object.position.multiply(scale);
            radar.object.scale.setScalar(scale.x);
            radar.x *= scale.x;
        }
        for (const f of design.parts.flags) {
            f.position.multiply(scale);
            f.scale.setScalar(scale.x);
        }
        for (const v of design.parts.launchers) v.multiply(scale);
        design.parts.torpedo?.multiply(scale);
        if (design.parts.catapult) {
            design.parts.catapult.start.multiply(scale);
            design.parts.catapult.end.multiply(scale);
        }
        const halves = builder.build(mats);
        this.root = new THREE.Group();
        this.root.name = `${team.id}-${type}`;
        this.body = new THREE.Group();
        this.root.add(this.body);
        this.pivots = {};
        for (const side of ['fore', 'aft']) {
            const pivot = new THREE.Group();
            pivot.position.x = this.split;
            halves[side].position.x = -this.split;
            pivot.add(halves[side]);
            this.body.add(pivot);
            this.pivots[side] = {pivot, group: halves[side]};
        }
        const attach = (object, x) => this.pivots[x >= this.split ? 'fore' : 'aft'].group.add(object);
        this.turrets = design.parts.turrets;
        for (const turret of this.turrets) attach(turret.yaw, turret.yaw.position.x);
        this.radars = design.parts.radars;
        for (const radar of this.radars) attach(radar.object, radar.x);
        for (const f of design.parts.flags) attach(f, f.position.x);
        this.launchers = design.parts.launchers;
        this.torpedoTube = design.parts.torpedo || null;
        this.catapult = design.parts.catapult || null;
        this.weapons = design.weapons;
        // A carrier's deck park, loose on the deck. effects is set when the fleet is deployed (for the splashes).
        this.cargo = design.parts.cargo ? new DeckCargo(this, design.parts.cargo, mats) : null;
        this.root.traverse(object => {
            if (object.isMesh && object.material !== mats.rail) {
                object.castShadow = true;
                object.receiveShadow = true;
            }
        });
        this.fires = [];
        this.cells = [];
        this.cellLocal = new Map();
        this.burningCells = new Set();
        this.motion = {heave: 0, pitch: 0, roll: 0, vHeave: 0, vPitch: 0, vRoll: 0};
        // Water taken in through the holes: a list toward the damage, trim toward the flooded end, lower in the water.
        this.flooding = {list: 0, trim: 0, settle: 0, target: {list: 0, trim: 0, settle: 0}};
        this.sinking = null;
        this.sail = null;
        this.speed = 0;
        this.seed = Math.random() * 100;
    }

    // Place the ship on its cells. Headings: 0 = bow toward +x, π/2 = bow toward -z, and so on.
    setPlacement(center, heading) {
        this.home = center.clone();
        this.heading = heading;
        this.root.position.copy(center);
        this.root.rotation.y = heading;
    }

    // Where a shot on one of this ship's cells lands, in the ship's own frame.
    localForCell(coord) {
        const base = this.cellLocal.get(coord) || {x: 0, z: 0};
        const reach = this.length / 2 - .12;
        return {x: THREE.MathUtils.clamp(base.x + (Math.random() - .5) * .22, -reach, reach), z: (Math.random() - .5) * this.beam * .3};
    }

    // Parent an object to whichever half of the hull it sits on, so it moves with that half.
    attach(object) {
        this.pivots[object.position.x >= this.split ? 'fore' : 'aft'].group.add(object);
    }

    deckHeight(x) {
        if (this.type === 'Submarine') return .06 * this.scale.y;
        if (this.type === 'Carrier') return .2 * this.scale.y;
        return deckAt(this.design.profile, x / this.scale.x) * this.scale.y;
    }

    // A hit tears the plating open and lets the sea in. local: the hit in the ship's frame. Returns what was
    // wrecked (radars blown off, turrets jammed) so the battle can throw their pieces.
    damage(local, {waterline = false, size = 1} = {}) {
        const holes = this.uniforms.holes.value;
        this.holeCount = (this.holeCount || 0) + 1;
        const slot = holes.find(v => v.w <= 0) || holes[this.holeCount % holes.length];
        const side = Math.sign(local.z) || (Math.random() < .5 ? -1 : 1);
        const radius = (.016 + .012 * size) * Math.sqrt(this.scale.x);
        if (waterline && this.type !== 'Submarine') {
            // On the side, just above the waterline, where the shell went in.
            slot.set(local.x, .02 * this.scale.y, side * this.beam * .5, radius * 1.15);
        } else {
            slot.set(local.x, local.y - .004, local.z, radius);
        }
        // Flooding: each hit lists her a few degrees toward it, more at the waterline; she settles and trims.
        const t = this.flooding.target;
        const per = (waterline ? .07 : .035) * (this.type === 'Carrier' ? .6 : this.type === 'Submarine' ? .5 : 1);
        t.list = THREE.MathUtils.clamp(t.list - side * per, -.2, .2);
        t.trim = THREE.MathUtils.clamp(t.trim - local.x / Math.max(this.length, .1) * .05, -.06, .06);
        t.settle = Math.min(.04, t.settle + (waterline ? .009 : .005) * this.scale.y);
        // On the deck, the blast wrecks the aircraft it hit and shoves the ones near it.
        if (!waterline) this.cargo?.blast(local, size);
        // Fittings near the hit: radar antennas are blown off, turrets jam with their barrels drooping.
        const wrecked = [];
        const reach = Math.max(.12, this.length * .1);
        for (const radar of this.radars) {
            if (!radar.object.visible) continue;
            const p = radar.object.position;
            if (Math.hypot(p.x - local.x, p.z - local.z) < reach) {
                radar.object.visible = false;
                wrecked.push(radar.object.getWorldPosition(new THREE.Vector3()));
            }
        }
        for (const turret of this.turrets) {
            if (turret.jammed) continue;
            const p = turret.yaw.position;
            if (Math.hypot(p.x - local.x, p.z - local.z) < reach * .8) {
                turret.jammed = true;
                turret.yaw.rotation.y += (Math.random() - .5) * .9;
                turret.pitch.rotation.z = -.07;
                turret.barrels.forEach((barrel, i) => { barrel.rotation.z = -.05 * (i + 1) * Math.random(); });
                wrecked.push(turret.yaw.getWorldPosition(new THREE.Vector3()));
            }
        }
        return wrecked;
    }

    // A heavy hit amidships tears the side open: a gash from the deck edge down the side toward the waterline,
    // about 8-14 m across for a warhead (more for the strike jet), ragged at the edge. Returns where it is, in
    // the ship's frame, so the fire and the torn plates can be put in it.
    tearSide(x, side, size = 1) {
        if (this.type === 'Submarine') return null;
        const holes = this.uniforms.holes.value;
        this.holeCount = (this.holeCount || 0) + 1;
        const slot = holes.find(v => v.w <= 0) || holes[this.holeCount % holes.length];
        const deck = this.deckHeight(x);
        const radius = (.04 + .045 * size) * Math.min(1.4, Math.sqrt(this.scale.x));
        // Centred just below the deck edge, so it opens both the deck edge and the side beneath it.
        const y = Math.max(radius * .55, deck - radius * .45);
        const z = side * this.beam * .5;
        slot.set(x, y, z, radius);
        // The deck edge above it goes too (on a carrier, the flight deck overhangs the side).
        const edge = holes.find(v => v.w <= 0) || holes[(this.holeCount + 5) % holes.length];
        edge.set(x + (Math.random() - .5) * radius * .6, deck, side * (this.beam * .5 + radius * .55), radius * .8);
        // The strike jet tears a long gash along the hull, not a round hole.
        if (size >= 1.5) {
            const more = holes.find(v => v.w <= 0) || holes[(this.holeCount + 9) % holes.length];
            more.set(x + (Math.random() < .5 ? -1 : 1) * radius * 1.1, y - radius * .15, z, radius * .85);
        }
        const t = this.flooding.target;
        t.list = THREE.MathUtils.clamp(t.list - side * .03, -.2, .2);
        this.cargo?.blast({x, y: deck, z: side * this.beam * .45}, size);
        return {x, y, z, radius, deck};
    }

    // Scorch the hull around a hit and keep the burn glowing.
    addBurn(x, z = 0, radius = .22) {
        this.burnCount = (this.burnCount || 0) + 1;
        const slot = this.uniforms.burn.value.find(v => v.w <= 0) || this.uniforms.burn.value[this.burnCount % 6];
        slot.set(x, z, radius, 0.001);
        slot.target = 1;
        return slot;
    }

    update(dt, time, ocean) {
        // Burns spread in over a second.
        for (const slot of this.uniforms.burn.value) if (slot.target && slot.w < slot.target) slot.w = Math.min(slot.target, slot.w + dt * 1.2);
        if (this.state === 'afloat') for (const radar of this.radars) radar.object.rotation.y += radar.speed * dt;
        if (this.sail) this.updateSail(dt);
        else if (this.home && this.state === 'afloat') this.keepStation(time, dt);
        // Ride the swell: sample the sea at bow, stern and both sides, then follow with spring damping.
        const r = this.root, cos = Math.cos(r.rotation.y), sin = Math.sin(r.rotation.y);
        const px = r.position.x, pz = r.position.z;
        const half = this.length * .42, beam = this.beam * .5;
        const sample = (lx, lz) => ocean.height(px + lx * cos + lz * sin, pz - lx * sin + lz * cos, time);
        const bow = sample(half, 0), stern = sample(-half, 0), port = sample(0, -beam), starboard = sample(0, beam);
        const heave = (bow + stern + port + starboard) / 4;
        const pitch = Math.atan2(bow - stern, half * 2) * .9;
        const roll = Math.atan2(port - starboard, beam * 2) * .55 + Math.sin(time * .7 + this.seed) * .006;
        const m = this.motion;
        // Flooding takes hold over several seconds as compartments fill.
        const f = this.flooding, ease = 1 - Math.exp(-dt / 4);
        for (const key of ['list', 'trim', 'settle']) f[key] += (f.target[key] - f[key]) * ease;
        // A damped spring toward the sea surface, integrated in small steps so any frame time stays stable.
        const steps = Math.min(30, Math.ceil(dt / (1 / 120)));
        const h = dt / Math.max(1, steps);
        for (let i = 0; i < steps; i++) {
            m.vHeave += ((heave - m.heave) * 14 - m.vHeave * 6) * h;
            m.vPitch += ((pitch - m.pitch) * 14 - m.vPitch * 6) * h;
            m.vRoll += ((roll - m.roll) * 14 - m.vRoll * 6) * h;
            m.heave += m.vHeave * h;
            m.pitch += m.vPitch * h;
            m.roll += m.vRoll * h;
        }
        if (!Number.isFinite(m.heave + m.pitch + m.roll + m.vHeave + m.vPitch + m.vRoll)) Object.assign(m, {heave, pitch, roll, vHeave: 0, vPitch: 0, vRoll: 0});
        this.body.position.y = m.heave - f.settle;
        this.body.rotation.set(m.roll + f.list, 0, m.pitch + f.trim);
        if (this.sinking) this.updateSinking(dt);
        if (this.cargo) {
            this.root.updateMatrixWorld(true);
            this.cargo.update(dt, time, ocean);
        }
    }

    // Under way at steerage speed on her own cells: a slow surge ahead and astern of her berth (at most a fifth
    // of a square), so the hull pushes real waves into the water and trails a wake that comes and goes.
    keepStation(time, dt) {
        // Eases in after she arrives, so there is no jump at the berth.
        this.stationBlend = Math.min(1, (this.stationBlend ?? 0) + dt / 8);
        const amplitude = .2 * Math.min(1, this.length / 3) * this.stationBlend;
        const omega = Math.PI * 2 / (64 + this.seed % 20);
        const phase = time * omega + this.seed;
        const offset = amplitude * Math.sin(phase);
        const heading = this.root.rotation.y;
        this.root.position.set(this.home.x + Math.cos(heading) * offset, this.home.y, this.home.z - Math.sin(heading) * offset);
        // Speed through the water, for the wake (0..1 of a brisk speed).
        this.speed = .22 + Math.abs(amplitude * omega * Math.cos(phase)) / .02 * .38;
    }

    // Sail in from beyond the grid edge to the berth, slowing as it arrives.
    sailIn(from, duration, delay = 0) {
        this.sail = {from: from.clone(), to: this.home.clone(), t: -delay / duration, duration};
        this.root.position.copy(from);
    }

    updateSail(dt) {
        const s = this.sail;
        s.t = Math.min(1, s.t + dt / s.duration);
        const k = Math.max(0, s.t);
        const ease = 1 - Math.pow(1 - k, 2.6);
        const previous = this.root.position.clone();
        this.root.position.lerpVectors(s.from, s.to, ease);
        this.speed = s.t > 0 ? previous.distanceTo(this.root.position) / Math.max(dt, 1e-4) / 2.2 : 0;
        if (s.t >= 1) {
            this.sail = null;
            this.speed = 0;
        }
    }

    // Settle by the bow or the stern, or break in two, listing as she goes. She stops about halfway down, deck
    // awash, and stays there burning: the wreck itself marks a sunk ship for the rest of the battle.
    sink(style) {
        const big = this.type === 'Carrier' || this.type === 'Battleship';
        const mode = style || (big && Math.random() < .55 ? 'break' : Math.random() < .5 ? 'bow' : 'stern');
        this.state = 'sinking';
        this.speed = 0;
        const deck = this.deckHeight(0);
        this.sinking = {
            mode, t: 0, duration: big ? 7 : 5.5,
            // Broken in two, the ends lift as the middle goes down, so she sinks deeper at the break.
            depth: this.type === 'Submarine' ? .05 : deck * .8 + .012 + (mode === 'break' ? this.length * .035 : 0),
            list: (Math.random() < .5 ? -1 : 1) * (.1 + Math.random() * .12),
            trim: this.type === 'Submarine' ? .025 : (.06 + Math.random() * .04) * Math.min(1.4, 2.6 / this.length),
        };
        return this.sinking;
    }

    // The top of the ship at a point of its deck plan (body-local x, z): the deck, or the roof of whatever
    // stands there. A hit lands, and a fire burns, on the surface that was struck, not inside a deckhouse.
    surfaceAt(x, z) {
        this.root.updateMatrixWorld(true);
        const body = this.body;
        const origin = body.localToWorld(new THREE.Vector3(x, 3, z));
        const down = new THREE.Vector3(0, -1, 0).transformDirection(body.matrixWorld);
        const ray = this.raycaster || (this.raycaster = new THREE.Raycaster());
        ray.set(origin, down);
        ray.far = 6;
        const skip = new Set([this.materials.rail, this.materials.flag, this.materials.glass]);
        const targets = [];
        this.root.traverse(object => { if (object.isMesh && !skip.has(object.material)) targets.push(object); });
        const hit = ray.intersectObjects(targets, false)[0];
        if (!hit) return this.deckHeight(x);
        return body.worldToLocal(hit.point.clone()).y;
    }

    // Where a wreck keeps burning: up on the superstructure, clear of the water she settles into.
    wreckFireSpots() {
        const s = this.scale;
        if (this.type === 'Carrier') return [[-.42 * s.x, .37 * s.y, .38 * s.z], [.7 * s.x, .21 * s.y, -.12 * s.z]];
        if (this.type === 'Submarine') return [[.56 * s.x, .24 * s.y, 0], [-.25 * s.x, .08 * s.y, 0]];
        const lift = {Battleship: .075, Cruiser: .1, Destroyer: .1}[this.type] * s.y;
        return [this.length * .06, -this.length * .16].map(x => [x, this.deckHeight(x) + lift, 0]);
    }

    // Where her fuel burns on the water as she goes down (world points beside the hull, at the waterline): the
    // fires on her decks drown as she settles, and these keep the wreck burning and smoking.
    oilSpots() {
        const count = this.type === 'Carrier' || this.type === 'Battleship' ? 3 : 2;
        this.root.updateMatrixWorld(true);
        return Array.from({length: count}, (_, i) => {
            const x = (i / Math.max(1, count - 1) - .5) * this.length * .6 + (Math.random() - .5) * .2;
            const side = Math.random() < .5 ? -1 : 1;
            return this.root.localToWorld(new THREE.Vector3(x, 0, side * (this.beam * .5 + .04 + Math.random() * .16)));
        });
    }

    // Skip the animation: straight to the settled wreck (when a saved game is restored).
    settle(style) {
        this.sink(style);
        this.sinking.t = this.sinking.duration;
        this.state = 'sunk';
        this.cargo?.settle();
    }

    updateSinking(dt) {
        const s = this.sinking;
        s.t = Math.min(s.duration, s.t + dt);
        const k = s.t / s.duration;
        // Quick at first as she floods, then slowly settling.
        const ease = 1 - Math.pow(1 - k, 2.4);
        this.body.position.y -= s.depth * ease;
        this.body.rotation.x += s.list * ease;
        const fore = this.pivots.fore.pivot, aft = this.pivots.aft.pivot;
        if (s.mode === 'break') {
            // Broken in the middle: both ends lift, the break sinks lowest.
            fore.rotation.z = ease * .13;
            aft.rotation.z = -ease * .11;
            fore.position.y = aft.position.y = -ease * .03;
        } else {
            this.body.rotation.z += (s.mode === 'bow' ? -1 : 1) * ease * s.trim;
        }
        if (k >= 1 && this.state === 'sinking') this.state = 'sunk';
    }

    // A broadside heels the ship away from the guns.
    kick(direction) {
        const across = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.root.rotation.y);
        this.motion.vRoll += -Math.sign(across.dot(direction) || 1) * .55;
        this.motion.vHeave -= .08;
    }

    // Aim a turret at a world point: returns the yaw/pitch it needs.
    aim(turret, world) {
        const local = turret.yaw.parent.worldToLocal(world.clone());
        const dx = local.x - turret.yaw.position.x, dz = local.z - turret.yaw.position.z;
        const yaw = Math.atan2(-dz, dx);
        const range = Math.hypot(dx, dz);
        const pitch = THREE.MathUtils.clamp(.18 + range * .025, .12, .55);
        return {yaw, pitch};
    }

    dispose() {
        this.cargo?.dispose();
        this.root.traverse(object => {
            if (object.isMesh) object.geometry.dispose();
        });
        for (const material of Object.values(this.materials)) {
            if (material && material.dispose && material !== this.materials.flag) material.dispose();
        }
        this.uniforms.numberMap.value.dispose();
        this.materials.deck.map?.dispose();
        this.materials.flight?.map?.dispose();
    }
}

export function sharedTextures(textures) {
    return textures;
}

export { lerp };
