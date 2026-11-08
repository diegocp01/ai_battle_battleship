import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { FIGHTERS, fighterDecals } from './ships.js';
import { place, box, cyl } from './shipkit.js';
import { RAMP, FRAME } from './effects.js';

// Life in the air: a Black Hawk helicopter flying a lazy circuit round each fleet, rotors turning, and now and then
// a pair of Super Hornets on combat air patrol crossing high over the battle. Sizes are real (75 m squares): the
// helicopter is 19.8 m long with its rotors turning, at about 45 m up; the jets 18 m long at 320–400 m.
const GRAY = 0x8a9198;

function merge(pieces) {
    return mergeGeometries(pieces.map(g => {
        const n = g.index ? g.toNonIndexed() : g;
        for (const name of Object.keys(n.attributes)) if (!['position', 'normal', 'uv'].includes(name)) n.deleteAttribute(name);
        if (!n.attributes.uv) n.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n.attributes.position.count * 2), 2));
        return n;
    }), false);
}

// A UH-60 Black Hawk at true size (built in metres, then scaled to the 75 m squares): a 15.3 m fuselage with the
// low, wide cabin and the sloped, glazed nose; twin engine nacelles either side of the transmission fairing on
// the roof, their exhausts turned out; the long tail boom to a swept tail pylon carrying the four-bladed tail
// rotor, canted 20 degrees, on its right side; the big stabilator low on the pylon; a 16.4 m four-bladed main
// rotor; two main wheels under the cockpit and a tail wheel; sliding cabin doors with windows. Painted the
// dark olive-black of an Army Black Hawk.
function blackHawk(materials) {
    const M = 1 / 75;
    const body = [], dark = [], glass = [];
    // The fuselage, from its side profile (x forward, y up from the belly), rounded at the edges.
    const profile = (points, width, bevel) => {
        const shape = new THREE.Shape();
        points.forEach(([x, y], i) => (i ? shape.lineTo(x, y) : shape.moveTo(x, y)));
        shape.closePath();
        const g = new THREE.ExtrudeGeometry(shape, {depth: width, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 6});
        g.translate(0, 0, -width / 2);
        return g;
    };
    body.push(profile([[-2.2, .05], [3.6, .05], [4.55, .2], [5.2, .55], [5.45, .95], [5.35, 1.3], [5.05, 1.5], [3.9, 2.05], [-2.0, 2.05], [-3.7, 1.75], [-3.7, 1.05]], 1.9, .22));
    // Cockpit glazing: windshield and the side windows of the cockpit doors.
    glass.push(profile([[3.75, 1.25], [4.65, 1.2], [5.3, 1.25], [5.08, 1.49], [3.92, 2.03], [3.75, 2.03]], 1.96, .22));
    // Transmission fairing and the twin engines on the roof, exhausts turned outward.
    body.push(place(box(3.4, .55, 1.15), [.2, 2.3, 0]));
    for (const side of [-1, 1]) {
        body.push(place(cyl(.34, .38, 2.9, 12), [.0, 2.35, side * .72], [0, 0, Math.PI / 2]));
        dark.push(place(cyl(.3, .3, .06, 12), [1.46, 2.35, side * .72], [0, 0, Math.PI / 2]));
        dark.push(place(box(.7, .34, .26), [-1.75, 2.42, side * .98], [0, side * .45, 0]));
        // The external stores stub wing and its fuel tank.
        body.push(place(box(.55, .06, 1.5), [.4, 1.95, side * 1.85], [side * .12, 0, 0]));
        body.push(place(cyl(.24, .24, 2.3, 10), [.4, 1.55, side * 2.35], [0, 0, Math.PI / 2]));
        body.push(place(new THREE.SphereGeometry(.24, 10, 8), [1.55, 1.55, side * 2.35], [0, 0, 0], [1.6, 1, 1]));
        // Cabin door windows and the gunner's window behind the cockpit.
        dark.push(place(box(1.0, .5, .04), [1.1, 1.45, side * 1.19]));
        dark.push(place(box(.55, .45, .04), [2.55, 1.5, side * 1.19]));
        // Door rails along the cabin roof line.
        dark.push(place(box(2.6, .05, .05), [.7, 1.98, side * 1.18]));
        // Main landing gear: a wheel under each side of the cockpit on a drag strut.
        dark.push(place(cyl(.36, .36, .22, 14), [2.9, -.15, side * 1.38], [Math.PI / 2, 0, 0]));
        dark.push(place(box(.12, .9, .12), [2.9, .25, side * 1.25], [side * .35, 0, 0]));
    }
    // The tail boom, tapering and rising a little toward the pylon.
    body.push(place(cyl(.27, .37, 6.6, 14), [-6.95, 1.5, 0], [0, 0, Math.PI / 2 - .025]));
    // The swept tail pylon.
    body.push(profile([[-9.8, 1.35], [-10.6, 1.35], [-11.3, 3.9], [-10.6, 4.0]], .2, .06));
    // The stabilator, low on the pylon.
    body.push(place(box(1.05, .08, 4.4), [-10.55, 1.7, 0]));
    // Tail wheel.
    dark.push(place(box(.1, .8, .1), [-8.6, .75, 0], [0, 0, .25]));
    dark.push(place(cyl(.2, .2, .14, 12), [-8.75, .25, 0], [Math.PI / 2, 0, 0]));
    // Wire cutters above and below the nose, and the infrared jammer on the roof.
    dark.push(place(box(.06, .55, .06), [4.25, 2.3, 0], [0, 0, -.5]));
    dark.push(place(box(.06, .45, .06), [4.6, -.1, 0], [0, 0, .5]));
    dark.push(place(cyl(.16, .16, .3, 10), [-1.9, 2.45, 0]));
    const airframe = new THREE.Group();
    airframe.scale.setScalar(M);
    airframe.add(new THREE.Mesh(merge(body), materials.olive));
    airframe.add(new THREE.Mesh(merge(dark), materials.dark));
    airframe.add(new THREE.Mesh(merge(glass), materials.glass));
    // Main rotor: mast, hub and four blades (8.2 m) drooping a little, with a faint disc where they blur.
    dark.length = 0;
    airframe.add(new THREE.Mesh(place(cyl(.18, .22, .75, 10), [.35, 2.95, 0]), materials.dark));
    const rotor = new THREE.Group();
    rotor.position.set(.35, 3.38, 0);
    const blades = [0, 1, 2, 3].map(i => place(box(8.2, .07, .53).translate(4.1, 0, 0), [0, -.12, 0], [0, i * Math.PI / 2, -.015]));
    blades.push(place(cyl(.42, .42, .3, 10), [0, 0, 0]));
    rotor.add(new THREE.Mesh(merge(blades), materials.dark));
    const disc = new THREE.Mesh(new THREE.CircleGeometry(8.2, 48).rotateX(-Math.PI / 2), materials.blur);
    disc.position.y = -.1;
    rotor.add(disc);
    airframe.add(rotor);
    // Tail rotor on the right of the pylon, canted 20 degrees; it spins about its own axis (the group's z).
    const pivot = new THREE.Group();
    pivot.position.set(-10.85, 3.3, .32);
    pivot.rotation.x = -.35;
    const tail = new THREE.Group();
    tail.add(new THREE.Mesh(merge([0, 1].map(i => place(box(.24, 3.36, .05), [0, 0, 0], [0, 0, i * Math.PI / 2])).concat([place(cyl(.16, .16, .25, 8), [0, 0, 0], [Math.PI / 2, 0, 0])])), materials.dark));
    pivot.add(tail);
    airframe.add(pivot);
    const group = new THREE.Group();
    group.add(airframe);
    group.traverse(o => { if (o.isMesh && o !== disc) o.castShadow = true; });
    return {group, rotor, tail};
}

export class AirTraffic {
    constructor(scene, theater) {
        this.scene = scene;
        this.t = theater;
        this.materials = {
            gray: new THREE.MeshStandardMaterial({color: GRAY, roughness: .55, metalness: .1}),
            olive: new THREE.MeshStandardMaterial({color: 0x30352b, roughness: .62, metalness: .12}),
            dark: new THREE.MeshStandardMaterial({color: 0x24272b, roughness: .6, metalness: .2}),
            glass: new THREE.MeshPhysicalMaterial({color: 0x0a1016, roughness: .08, metalness: .1, clearcoat: 1}),
            blur: new THREE.MeshBasicMaterial({color: 0x2a2d31, transparent: true, opacity: .14, depthWrite: false, side: THREE.DoubleSide}),
        };
        this.helos = {};
        for (const team of ['gpt', 'claude']) {
            const helo = blackHawk(this.materials);
            helo.angle = Math.random() * Math.PI * 2;
            helo.speed = .07 + Math.random() * .02;
            helo.group.visible = false;
            scene.add(helo.group);
            this.helos[team] = helo;
        }
        // Each fleet's own fighters fly its patrols.
        this.jetParts = {};
        for (const [team, fighter] of Object.entries(FIGHTERS)) {
            const jet = fighter.model(1.15);
            const decals = fighterDecals(team);
            const paint = fighter.color ? new THREE.MeshStandardMaterial({color: fighter.color, roughness: .5, metalness: .12}) : this.materials.gray;
            const materials = {gray: paint, accent: decals.fighterAccent, glass: this.materials.glass, dark: this.materials.dark, glow: decals.fighterGlow, badge: decals.fighterBadge, logo: decals.fighterLogo};
            this.jetParts[team] = Object.entries(materials).filter(([part]) => jet[part]?.length).map(([part, material]) => ({geometry: merge(jet[part].map(g => g.clone())), material}));
        }
        this.flights = [];
        this.nextFlight = 12 + Math.random() * 15;
        this.previous = new THREE.Vector3();
    }

    clear() {
        for (const flight of this.flights) for (const jet of flight.jets) this.scene.remove(jet);
        this.flights = [];
        this.nextFlight = 20;
    }

    // A pair of fighters on patrol: high, fast, straight across one fleet and out over the sea.
    launchFlight() {
        const team = Math.random() < .5 ? 'gpt' : 'claude';
        const center = this.t.grid.center(team);
        const dir = Math.random() < .5 ? 1 : -1;
        // Well above the barrier (about 215 m): 320–400 m.
        const altitude = 4.3 + Math.random() * 1.0;
        const x = center.x + (Math.random() - .5) * 6;
        const jets = [0, 1].map(i => {
            const group = new THREE.Group();
            for (const part of this.jetParts[team]) group.add(new THREE.Mesh(part.geometry, part.material));
            group.traverse(o => { if (o.isMesh) o.castShadow = true; });
            this.scene.add(group);
            return group;
        });
        this.flights.push({jets, from: new THREE.Vector3(x, altitude, -dir * 34), to: new THREE.Vector3(x + (Math.random() - .5) * 8, altitude + .4, dir * 34), t: 0, duration: 23 + Math.random() * 5});
    }

    update(dt, time) {
        const fleets = this.t.fleets;
        for (const [team, helo] of Object.entries(this.helos)) {
            const fleet = fleets[team];
            const afloat = fleet && [...fleet.ships.values()].some(s => s.state === 'afloat');
            helo.group.visible = Boolean(afloat);
            if (!afloat) continue;
            // A lazy oval round the fleet, nose down a little into its flight, banked into the turn.
            const center = this.t.grid.center(team);
            helo.angle += helo.speed * dt;
            const a = helo.angle, rx = 3.6, rz = 2.6;
            const x = center.x + Math.cos(a) * rx, z = center.z + Math.sin(a) * rz;
            const y = .58 + Math.sin(a * 2.3 + (team === 'gpt' ? 0 : 2)) * .08;
            const vx = -Math.sin(a) * rx, vz = Math.cos(a) * rz;
            helo.group.position.set(x, y, z);
            helo.group.rotation.set(0, Math.atan2(-vz, vx), 0, 'YXZ');
            helo.group.rotateX(-.22);
            helo.group.rotateZ(-.08);
            helo.rotor.rotation.y += dt * 31;
            helo.tail.rotation.z += dt * 140;
        }
        this.nextFlight -= dt;
        if (this.nextFlight <= 0 && !this.t.attract) {
            this.launchFlight();
            this.nextFlight = 35 + Math.random() * 30;
        }
        const fx = this.t.effects;
        this.flights = this.flights.filter(flight => {
            flight.t += dt;
            const k = flight.t / flight.duration;
            if (k >= 1) {
                for (const jet of flight.jets) this.scene.remove(jet);
                return false;
            }
            const direction = flight.to.clone().sub(flight.from).normalize();
            const side = new THREE.Vector3(-direction.z, 0, direction.x);
            flight.jets.forEach((jet, i) => {
                // The wingman sits back and out to one side, in loose formation.
                const lag = i ? .045 : 0;
                const p = flight.from.clone().lerp(flight.to, Math.max(0, k - lag)).addScaledVector(side, i ? .55 : 0).add(new THREE.Vector3(0, i ? -.08 : 0, 0));
                this.previous.copy(jet.position);
                jet.position.copy(p);
                jet.rotation.set(0, Math.atan2(-direction.z, direction.x), 0, 'YXZ');
                jet.rotateX(Math.sin(time * .6 + i) * .05);
                // Afterburners off on patrol: a faint heat glow at the nozzles and nothing else.
                if (fx && Math.random() < .5) {
                    const tail = p.clone().addScaledVector(direction, -.14);
                    fx.spawn({x: tail.x, y: tail.y, z: tail.z, ramp: RAMP.EXHAUST, frame: FRAME.GLOW, size: .05, life: .05, drag: 0, intensity: .6});
                }
            });
            return true;
        });
    }
}
