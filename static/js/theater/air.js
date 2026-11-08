import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { hornet } from './detail.js';
import { place, box, cyl } from './shipkit.js';
import { RAMP, FRAME } from './effects.js';

// Life in the air: a Seahawk helicopter flying a lazy circuit round each fleet, rotors turning, and now and then a
// pair of Super Hornets on combat air patrol crossing high over the battle. Sizes are real (75 m squares): the
// helicopter is 20 m long at about 45 m up, the jets 18 m long at 320–400 m.
const GRAY = 0x8a9198;

function merge(pieces) {
    return mergeGeometries(pieces.map(g => {
        const n = g.index ? g.toNonIndexed() : g;
        for (const name of Object.keys(n.attributes)) if (!['position', 'normal', 'uv'].includes(name)) n.deleteAttribute(name);
        if (!n.attributes.uv) n.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n.attributes.position.count * 2), 2));
        return n;
    }), false);
}

function helicopter(materials) {
    const group = new THREE.Group();
    const s = 1.35;
    const body = new THREE.CapsuleGeometry(.016 * s, .05 * s, 4, 12);
    place(body, [0, .016 * s, 0], [0, 0, Math.PI / 2], [1, 1, .85]);
    const nose = place(new THREE.SphereGeometry(.014 * s, 12, 8), [.03 * s, .014 * s, 0], [0, 0, 0], [1.2, .9, .85]);
    const boom = place(cyl(.004 * s, .007 * s, .085 * s, 8), [-.068 * s, .022 * s, 0], [0, 0, Math.PI / 2]);
    const fin = place(box(.014 * s, .026 * s, .003 * s), [-.11 * s, .032 * s, 0], [0, 0, -.25]);
    const stab = place(box(.012 * s, .002 * s, .03 * s), [-.104 * s, .02 * s, 0]);
    const mast = place(cyl(.003 * s, .004 * s, .012 * s, 8), [0, .036 * s, 0]);
    const gear = [-1, 1].map(side => place(cyl(.002 * s, .002 * s, .012 * s, 6), [.01 * s, .002 * s, side * .012 * s]));
    group.add(new THREE.Mesh(merge([body, nose, boom, fin, stab, mast, ...gear]), materials.gray));
    group.add(new THREE.Mesh(place(new THREE.SphereGeometry(.0105 * s, 12, 8), [.034 * s, .02 * s, 0], [0, 0, 0], [1.3, .7, .95]), materials.glass));
    // Main rotor: four blades and a faint disc where they blur.
    const rotor = new THREE.Group();
    rotor.position.set(0, .043 * s, 0);
    rotor.add(new THREE.Mesh(merge([0, 1, 2, 3].map(i => place(box(.15 * s, .0012 * s, .006 * s), [.075 * s, 0, 0], [0, i * Math.PI / 2, 0]).translate(0, 0, 0))), materials.dark));
    const disc = new THREE.Mesh(new THREE.CircleGeometry(.15 * s, 40).rotateX(-Math.PI / 2), materials.blur);
    rotor.add(disc);
    group.add(rotor);
    const tail = new THREE.Group();
    tail.position.set(-.112 * s, .036 * s, .004 * s);
    tail.add(new THREE.Mesh(merge([0, 1, 2, 3].map(i => place(box(.002 * s, .028 * s, .003 * s), [0, 0, 0], [0, 0, i * Math.PI / 4]))), materials.dark));
    group.add(tail);
    group.traverse(o => { if (o.isMesh && o !== disc) o.castShadow = true; });
    return {group, rotor, tail};
}

export class AirTraffic {
    constructor(scene, theater) {
        this.scene = scene;
        this.t = theater;
        this.materials = {
            gray: new THREE.MeshStandardMaterial({color: GRAY, roughness: .55, metalness: .1}),
            dark: new THREE.MeshStandardMaterial({color: 0x24272b, roughness: .6, metalness: .2}),
            glass: new THREE.MeshPhysicalMaterial({color: 0x0a1016, roughness: .08, metalness: .1, clearcoat: 1}),
            blur: new THREE.MeshBasicMaterial({color: 0x2a2d31, transparent: true, opacity: .14, depthWrite: false, side: THREE.DoubleSide}),
        };
        this.helos = {};
        for (const team of ['gpt', 'claude']) {
            const helo = helicopter(this.materials);
            helo.angle = Math.random() * Math.PI * 2;
            helo.speed = .07 + Math.random() * .02;
            helo.group.visible = false;
            scene.add(helo.group);
            this.helos[team] = helo;
        }
        const jet = hornet(1.15);
        this.jetGeometry = {gray: merge(jet.gray.map(g => g.clone())), glass: merge(jet.glass.map(g => g.clone()))};
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
            group.add(new THREE.Mesh(this.jetGeometry.gray, this.materials.gray), new THREE.Mesh(this.jetGeometry.glass, this.materials.glass));
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
