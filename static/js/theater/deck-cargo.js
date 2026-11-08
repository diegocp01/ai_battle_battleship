import * as THREE from 'three';
import { partMesh } from './shipkit.js';

// Everything parked on a carrier's flight deck (the fleet's fighters, the Hawkeyes, the Seahawks and the deck
// tractors) as loose bodies instead of part of the hull.
//  - Parked, each is held by its chocks and tie-downs until the deck tilts further than they can hold. They part
//    at a different angle for each plane, so a listing carrier sheds her deck park a few at a time.
//  - Loose, it rolls downhill under gravity against the friction of its tyres, turning as it goes, and shoves
//    whatever it runs into (a hard knock breaks the other one loose too). The island stops it.
//  - Past the deck edge (or into the gap where a broken carrier has parted) it tips over the edge and falls,
//    tumbling, hits the water at the speed it fell with a splash sized by its mass and speed, floats a few
//    seconds and goes down tail first, breathing out bubbles.
//  - Where the deck itself goes under, the sea lifts the aircraft off it.
//  - A hit next to the park wrecks what was at the blast and shoves the rest outward.
// The theater runs on battle time, faster than life, so gravity is scaled up here as it is for debris.

const GRAVITY = 2.4;            // squares/s² of battle time
const FALL_DRAG = .15;
const SINK_DEPTH = .07;         // how far under the surface something is gone from sight
const up = new THREE.Vector3(0, 1, 0);

function inside(points, x, z) {
    let hit = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const [xi, zi] = points[i], [xj, zj] = points[j];
        if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) hit = !hit;
    }
    return hit;
}

export class DeckCargo {
    // cargo: {kinds: {name: {parts: {materialKey: [geometry]}, radius, mass, draft}}, items: [{kind, x, y, z, yaw}],
    // deck: outline [[x, z]], island: {minX, maxX, minZ, maxZ}}, all in model units (scaled here to the ship).
    constructor(ship, cargo, materials) {
        this.ship = ship;
        const s = ship.scale;
        this.size = s.x;
        this.deck = cargo.deck.map(([x, z]) => [x * s.x, z * s.z]);
        const i = cargo.island;
        this.island = i && {minX: i.minX * s.x, maxX: i.maxX * s.x, minZ: i.minZ * s.z, maxZ: i.maxZ * s.z};
        this.fx = null;
        this.group = new THREE.Group();
        this.group.name = 'deck-cargo';
        ship.root.add(this.group);
        const counts = {};
        for (const item of cargo.items) counts[item.kind] = (counts[item.kind] || 0) + 1;
        this.meshes = {};
        for (const [kind, count] of Object.entries(counts)) {
            this.meshes[kind] = Object.entries(cargo.kinds[kind].parts).filter(([, pieces]) => pieces.length).map(([key, pieces]) => {
                const material = materials[key];
                const mesh = new THREE.InstancedMesh(partMesh(material, pieces).geometry, material, count);
                mesh.frustumCulled = false;
                mesh.castShadow = !material.transparent;
                mesh.receiveShadow = true;
                mesh.name = `${kind}-${key}`;
                this.group.add(mesh);
                return mesh;
            });
        }
        const seen = {};
        this.items = cargo.items.map(item => {
            const kind = cargo.kinds[item.kind];
            const x = item.x * s.x, z = item.z * s.z;
            // Each tie-down parts at its own angle (8 to 17 degrees); loose, the tyres roll with a little drag.
            const hold = Math.tan(THREE.MathUtils.degToRad(8 + Math.random() * 9));
            return {
                kind: item.kind, index: (seen[item.kind] = (seen[item.kind] ?? -1) + 1), half: x >= ship.split ? 'fore' : 'aft',
                x, y: item.y * s.y, z, yaw: item.yaw, vx: 0, vz: 0, spin: (Math.random() - .5) * 3,
                hold, roll: .06 + Math.random() * .1, radius: kind.radius * s.x, mass: kind.mass, draft: (kind.draft ?? .004) * s.y,
                state: 'parked', p: new THREE.Vector3(), v: new THREE.Vector3(), q: new THREE.Quaternion(), w: new THREE.Vector3(),
                t: 0, float: 1.5 + Math.random() * 4, depth: 0,
            };
        });
        this.lastSplash = -1;
        this.clock = 0;
        this.pendingSettle = false;
        this.matrix = new THREE.Matrix4();
        this.hidden = new THREE.Matrix4().makeScale(0, 0, 0);
        this.halves = {fore: {}, aft: {}};
    }

    get broken() {
        return this.ship.sinking?.mode === 'break';
    }

    // A hit at a point of the deck (the ship's frame): wreck what stood there, shove what stood near.
    blast(local, size = 1) {
        const deck = this.ship.deckHeight(local.x);
        if (local.y !== undefined && local.y < deck - .05 * this.size) return;
        const wreck = (.035 + .03 * size) * this.size, reach = (.16 + .1 * size) * this.size;
        for (const item of this.items) {
            if (item.state !== 'parked' && item.state !== 'sliding') continue;
            const dx = item.x - local.x, dz = item.z - local.z, d = Math.hypot(dx, dz);
            if (d < wreck) {
                item.state = 'gone';
            } else if (d < reach) {
                const push = .45 * size * (1 - d / reach) * this.size;
                item.state = 'sliding';
                item.vx += dx / Math.max(d, 1e-4) * push;
                item.vz += dz / Math.max(d, 1e-4) * push;
                item.spin = (Math.random() - .5) * 14;
            }
        }
    }

    // A wreck restored from a saved game: whatever the deck could not hold is already gone.
    settle() {
        this.pendingSettle = true;
    }

    update(dt, time, ocean) {
        this.clock += dt;
        const root = this.ship.root;
        const rootInverse = new THREE.Matrix4().copy(root.matrixWorld).invert();
        for (const side of ['fore', 'aft']) {
            const half = this.halves[side];
            half.world = this.ship.pivots[side].group.matrixWorld;
            half.quaternion = new THREE.Quaternion().setFromRotationMatrix(half.world);
            // Gravity in the deck's own frame: what presses the wheels down, and what pulls them downhill.
            half.gravity = new THREE.Vector3(0, -GRAVITY, 0).applyQuaternion(half.quaternion.clone().invert());
            half.toRoot = new THREE.Matrix4().multiplyMatrices(rootInverse, half.world);
        }
        if (this.pendingSettle) {
            this.pendingSettle = false;
            for (const item of this.items) {
                const g = this.halves[item.half].gravity;
                if (item.state === 'parked' && (Math.hypot(g.x, g.z) > item.hold * -g.y || this.underwater(item, time, ocean))) item.state = 'gone';
            }
        }
        for (const item of this.items) {
            if (item.state === 'parked' || item.state === 'sliding') this.onDeck(item, dt, time, ocean);
        }
        this.collide();
        for (const item of this.items) {
            if (item.state === 'falling' || item.state === 'floating' || item.state === 'sinking') this.free(item, dt, time, ocean);
        }
        this.present(rootInverse);
    }

    onDeck(item, dt, time, ocean) {
        const g = this.halves[item.half].gravity;
        const pressing = -g.y;
        if (pressing <= 0) return this.release(item, 'falling');
        const pull = Math.hypot(g.x, g.z);
        if (item.state === 'parked') {
            if (pull <= item.hold * pressing) {
                if (this.underwater(item, time, ocean)) this.release(item, 'floating');
                return;
            }
            item.state = 'sliding';
        }
        // Rolling: gravity downhill, the tyres' drag against the motion; at rest it stays put until the slope
        // beats the drag.
        const speed = Math.hypot(item.vx, item.vz), drag = item.roll * pressing;
        if (speed > 1e-5) {
            const vx = item.vx + (g.x - drag * item.vx / speed) * dt, vz = item.vz + (g.z - drag * item.vz / speed) * dt;
            if (vx * item.vx + vz * item.vz < 0) { item.vx = 0; item.vz = 0; } else { item.vx = vx; item.vz = vz; }
        } else if (pull > drag) {
            item.vx += g.x * (1 - drag / pull) * dt;
            item.vz += g.z * (1 - drag / pull) * dt;
        }
        item.x += item.vx * dt;
        item.z += item.vz * dt;
        item.yaw += item.spin * Math.hypot(item.vx, item.vz) * dt;
        item.spin *= Math.exp(-dt * 1.5);
        // The island is in the way.
        const box = this.island;
        if (box && item.x > box.minX - item.radius && item.x < box.maxX + item.radius && item.z > box.minZ - item.radius && item.z < box.maxZ + item.radius) {
            const out = [[box.minX - item.radius - item.x, 0], [box.maxX + item.radius - item.x, 0], [0, box.minZ - item.radius - item.z], [0, box.maxZ + item.radius - item.z]]
                .sort((a, b) => Math.hypot(...a) - Math.hypot(...b))[0];
            item.x += out[0];
            item.z += out[1];
            if (out[0]) item.vx *= -.2; else item.vz *= -.2;
        }
        // Over the edge: the deck's own outline, or the gap where the hull has broken in two.
        const split = this.ship.split;
        if (item.half === 'fore' ? item.x < split : item.x >= split) {
            if (this.broken) return this.release(item, 'falling');
            item.half = item.half === 'fore' ? 'aft' : 'fore';
        }
        if (!inside(this.deck, item.x, item.z)) return this.release(item, 'falling');
        if (this.underwater(item, time, ocean)) this.release(item, 'floating');
    }

    underwater(item, time, ocean) {
        const p = new THREE.Vector3(item.x, item.y, item.z).applyMatrix4(this.halves[item.half].world);
        return p.y < ocean.height(p.x, p.z, time) - item.draft;
    }

    // From the deck's frame into the world, carrying its motion: over the edge it tips, nose first.
    release(item, state) {
        const half = this.halves[item.half];
        const local = new THREE.Matrix4().compose(new THREE.Vector3(item.x, item.y, item.z), new THREE.Quaternion().setFromAxisAngle(up, item.yaw), new THREE.Vector3(1, 1, 1));
        new THREE.Matrix4().multiplyMatrices(half.world, local).decompose(item.p, item.q, new THREE.Vector3());
        item.v.set(item.vx, 0, item.vz).applyQuaternion(half.quaternion);
        item.w.set(0, 0, 0);
        const speed = item.v.length();
        if (state === 'falling' && speed > 1e-5) {
            const axis = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0).applyQuaternion(half.quaternion), item.v).normalize();
            item.w.copy(axis).multiplyScalar(Math.min(5, 1.2 + speed / Math.max(item.radius, .01) * .8));
        }
        item.state = state;
        item.t = 0;
    }

    // Aircraft against aircraft on the deck: they push each other apart, and a hard knock breaks a parked one loose.
    collide() {
        const onDeck = this.items.filter(item => item.state === 'parked' || item.state === 'sliding');
        for (let i = 0; i < onDeck.length; i++) {
            for (let j = i + 1; j < onDeck.length; j++) {
                const a = onDeck[i], b = onDeck[j];
                if (a.half !== b.half || (a.state === 'parked' && b.state === 'parked')) continue;
                const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz), reach = (a.radius + b.radius) * .8;
                if (d >= reach || d < 1e-6) continue;
                const nx = dx / d, nz = dz / d;
                const closing = (a.vx - b.vx) * nx + (a.vz - b.vz) * nz;
                if (closing > .02 * this.size) {
                    if (a.state === 'parked') a.state = 'sliding';
                    if (b.state === 'parked') b.state = 'sliding';
                }
                const wa = a.state === 'parked' ? 0 : a.mass, wb = b.state === 'parked' ? 0 : b.mass, total = wa + wb;
                const overlap = reach - d;
                a.x -= nx * overlap * wa / total; a.z -= nz * overlap * wa / total;
                b.x += nx * overlap * wb / total; b.z += nz * overlap * wb / total;
                if (closing > 0 && total) {
                    // Inelastic: they leave the knock moving together along the line between them.
                    const shared = (a.mass * ((a.vx * nx + a.vz * nz)) + b.mass * ((b.vx * nx + b.vz * nz))) / (a.mass + b.mass);
                    for (const item of [a, b]) {
                        if (item.state === 'parked') continue;
                        const along = item.vx * nx + item.vz * nz;
                        item.vx += (shared - along) * nx;
                        item.vz += (shared - along) * nz;
                    }
                }
            }
        }
    }

    // Off the ship: falling, then afloat, then going down.
    free(item, dt, time, ocean) {
        item.t += dt;
        const sea = ocean.height(item.p.x, item.p.z, time);
        if (item.state === 'falling') {
            item.v.y -= GRAVITY * dt;
            item.v.multiplyScalar(Math.exp(-FALL_DRAG * dt));
            item.p.addScaledVector(item.v, dt);
            this.turn(item, dt);
            if (item.p.y <= sea) {
                if (this.fx) {
                    const sound = this.clock - this.lastSplash > .4;
                    if (sound) this.lastSplash = this.clock;
                    this.fx.waterImpact(item.p.clone().setY(sea), {velocity: item.v.clone(), mass: item.mass, top: 120, sound});
                }
                // The water stops it hard; it bobs back up to float.
                item.v.set(item.v.x * .3, item.v.y * .15, item.v.z * .3);
                item.w.multiplyScalar(.25);
                item.state = 'floating';
                item.t = 0;
            }
            return;
        }
        if (item.state === 'floating' && item.t > item.float) {
            item.state = 'sinking';
            item.t = 0;
            this.fx?.bubbles(item.p, item.radius * .6, .6);
        }
        // Afloat it rides at its draft, slowing in the water and settling level; going down, the heavy tail
        // takes it under nose up.
        if (item.state === 'sinking') item.depth += (.008 + item.t * .01) * this.size * dt;
        const target = sea - item.draft - item.depth;
        item.v.y += ((target - item.p.y) * 30 - item.v.y * 9) * dt;
        item.v.x *= Math.exp(-dt * 1.4);
        item.v.z *= Math.exp(-dt * 1.4);
        item.p.addScaledVector(item.v, dt);
        item.w.multiplyScalar(Math.exp(-dt * 2.5));
        this.turn(item, dt);
        const nose = new THREE.Vector3(1, 0, 0).applyQuaternion(item.q);
        const heading = Math.atan2(-nose.z, nose.x);
        const rest = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, heading, item.state === 'sinking' ? Math.min(.75, item.t * .35) : 0, 'YXZ'));
        item.q.slerp(rest, 1 - Math.exp(-dt * (item.state === 'sinking' ? 1.2 : 1.8)));
        if (item.state === 'sinking') {
            if (Math.random() < dt * 3) this.fx?.bubbles(item.p, item.radius * .4, .3);
            if (item.depth > SINK_DEPTH * this.size) item.state = 'gone';
        }
    }

    turn(item, dt) {
        const angle = item.w.length() * dt;
        if (angle > 1e-6) item.q.premultiply(new THREE.Quaternion().setFromAxisAngle(item.w.clone().normalize(), angle));
    }

    present(rootInverse) {
        const scale = new THREE.Vector3(this.size, this.size, this.size);
        const world = new THREE.Matrix4(), local = new THREE.Matrix4(), turn = new THREE.Quaternion();
        for (const item of this.items) {
            const meshes = this.meshes[item.kind];
            if (item.state === 'gone') {
                this.matrix.copy(this.hidden);
            } else if (item.state === 'parked' || item.state === 'sliding') {
                local.compose(new THREE.Vector3(item.x, item.y, item.z), turn.setFromAxisAngle(up, item.yaw), scale);
                this.matrix.multiplyMatrices(this.halves[item.half].toRoot, local);
            } else {
                world.compose(item.p, item.q, scale);
                this.matrix.multiplyMatrices(rootInverse, world);
            }
            for (const mesh of meshes) mesh.setMatrixAt(item.index, this.matrix);
        }
        for (const meshes of Object.values(this.meshes)) for (const mesh of meshes) mesh.instanceMatrix.needsUpdate = true;
    }

    dispose() {
        for (const meshes of Object.values(this.meshes)) for (const mesh of meshes) mesh.dispose();
    }
}
