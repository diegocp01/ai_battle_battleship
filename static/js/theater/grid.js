import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { labelTexture, bannerTexture } from './textures.js';
import { NO_REFLECTION_LAYER } from './ocean.js';

// The two battle grids: where each cell sits in the world, coordinate labels, the white marker buoys
// dropped on every miss, and the lock-on reticle that closes in on the cell under fire.
export const COLUMNS = 'ABCDEFGHIJ';
export const GRID_SIZE = 10;

export class Battlefield {
    constructor(scene, ocean, {origins, colors, names}) {
        this.scene = scene;
        this.ocean = ocean;
        this.origins = origins;   // team → [x, z] of the A1 corner
        this.colors = colors;
        this.group = new THREE.Group();
        scene.add(this.group);
        this.labels = [];
        for (const team of ['gpt', 'claude']) this.addLabels(team, names[team]);
        this.buoys = new Buoys(scene, ocean);
        this.reticle = new Reticle(scene);
    }

    index(coord) {
        return [COLUMNS.indexOf(coord[0]), Number(coord.slice(1)) - 1];
    }

    cellCenter(team, coord, target = new THREE.Vector3()) {
        const [col, row] = this.index(coord);
        const [x0, z0] = this.origins[team];
        return target.set(x0 + col + .5, 0, z0 + row + .5);
    }

    center(team) {
        const [x0, z0] = this.origins[team];
        return new THREE.Vector3(x0 + 5, 0, z0 + 5);
    }

    gridIndex(team) {
        return team === 'gpt' ? 0 : 1;
    }

    addLabels(team, name) {
        const [x0, z0] = this.origins[team];
        const make = (text, x, z, scale, map) => {
            const sprite = new THREE.Sprite(new THREE.SpriteMaterial({map: map || labelTexture(text), transparent: true, depthWrite: false, opacity: .88}));
            sprite.position.set(x, .16, z);
            sprite.scale.set(scale * 2, scale, 1);
            sprite.layers.set(NO_REFLECTION_LAYER);
            sprite.renderOrder = 5;
            this.group.add(sprite);
            this.labels.push(sprite);
            return sprite;
        };
        for (let c = 0; c < GRID_SIZE; c++) make(COLUMNS[c], x0 + c + .5, z0 - .45, .34);
        for (let r = 0; r < GRID_SIZE; r++) make(String(r + 1), x0 - .5, z0 + r + .5, .34);
        const banner = make(name, x0 + 5, z0 - 1.25, .62, bannerTexture(name.toUpperCase(), this.colors[team]));
        banner.position.y = .55;
        banner.scale.set(3.4, .64, 1);
        banner.userData.banner = team;
        banner.userData.text = name;
    }

    // The fleet banners name the models in play.
    setNames(names) {
        for (const label of this.labels) {
            const team = label.userData.banner;
            if (!team || !names[team] || label.userData.text === names[team]) continue;
            label.material.map.dispose();
            label.material.map = bannerTexture(names[team].toUpperCase(), this.colors[team]);
            label.material.needsUpdate = true;
            label.userData.text = names[team];
        }
    }

    setBannerVisible(visible) {
        for (const label of this.labels) if (label.userData.banner) label.visible = visible;
    }

    markMiss(team, coord, {instant = false} = {}) {
        const [col, row] = this.index(coord);
        this.ocean.setCell(this.gridIndex(team), col, row, {miss: true});
        this.buoys.add(this.cellCenter(team, coord), instant);
    }

    markHit(team, coord) {
        const [col, row] = this.index(coord);
        this.ocean.setCell(this.gridIndex(team), col, row, {hit: true});
    }

    // A sunk ship's burning wreck marks its cells from now on, so the water there loses its red.
    markSunk(team, cells) {
        for (const coord of cells) {
            const [col, row] = this.index(coord);
            this.ocean.setCell(this.gridIndex(team), col, row, {sunk: true, hit: false});
        }
    }

    markLast(team, coord) {
        this.ocean.clearLast();
        if (!coord) return;
        const [col, row] = this.index(coord);
        this.ocean.setCell(this.gridIndex(team), col, row, {last: true});
    }

    lockOn(team, coord, color) {
        const center = this.cellCenter(team, coord);
        this.reticle.lock(center, color);
        this.ocean.setTarget(center.x, center.z, color, 1);
    }

    release() {
        this.reticle.release();
        this.ocean.setTarget(0, 0, null, 0);
    }

    clear() {
        this.buoys.clear();
        this.release();
        this.ocean.clearMarks();
    }

    update(dt, time) {
        this.buoys.update(dt, time);
        this.reticle.update(dt, time);
        const target = this.ocean.uniforms.uTarget.value;
        if (this.reticle.state === 'release' && target.w > 0) target.w = Math.max(0, target.w - dt * 4);
    }
}

// Miss markers: small white spar buoys with a blinking light, riding the swell.
class Buoys {
    constructor(scene, ocean) {
        this.ocean = ocean;
        const body = mergeGeometries([
            new THREE.CylinderGeometry(.03, .045, .1, 14).translate(0, .02, 0),
            new THREE.CylinderGeometry(.006, .006, .07, 6).translate(0, .1, 0),
            new THREE.SphereGeometry(.05, 14, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2).translate(0, -.03, 0),
        ].map(g => g.toNonIndexed()));
        const band = new THREE.CylinderGeometry(.0335, .037, .022, 14).translate(0, .045, 0);
        const light = new THREE.SphereGeometry(.013, 10, 8).translate(0, .14, 0);
        const max = 120;
        this.body = new THREE.InstancedMesh(body, new THREE.MeshStandardMaterial({color: 0xf2f2ee, roughness: .45, metalness: .05}), max);
        this.band = new THREE.InstancedMesh(band, new THREE.MeshStandardMaterial({color: 0xd9472b, roughness: .5}), max);
        this.light = new THREE.InstancedMesh(light, new THREE.MeshBasicMaterial({color: new THREE.Color(1, .9, .7).multiplyScalar(5)}), max);
        for (const mesh of [this.body, this.band, this.light]) {
            mesh.count = 0;
            mesh.frustumCulled = false;
            mesh.castShadow = mesh !== this.light;
            scene.add(mesh);
        }
        this.items = [];
        this.matrix = new THREE.Matrix4();
        this.q = new THREE.Quaternion();
        this.e = new THREE.Euler();
        this.v = new THREE.Vector3();
        this.s = new THREE.Vector3();
    }

    add(position, instant) {
        this.items.push({x: position.x + (Math.random() - .5) * .12, z: position.z + (Math.random() - .5) * .12, seed: Math.random() * 10, t: instant ? 1 : -.6});
    }

    clear() {
        this.items = [];
        for (const mesh of [this.body, this.band, this.light]) mesh.count = 0;
    }

    update(dt, time) {
        this.items.forEach((item, i) => {
            item.t = Math.min(1, item.t + dt * 1.4);
            const appear = THREE.MathUtils.clamp(item.t, 0, 1);
            const bob = this.ocean.height(item.x, item.z, time);
            const pop = 1 - Math.pow(1 - appear, 3);
            this.q.setFromEuler(this.e.set(Math.sin(time * 1.7 + item.seed) * .14, item.seed, Math.cos(time * 1.3 + item.seed) * .14));
            this.v.set(item.x, bob - (1 - pop) * .2, item.z);
            this.s.setScalar(Math.max(.001, pop));
            this.matrix.compose(this.v, this.q, this.s);
            this.body.setMatrixAt(i, this.matrix);
            this.band.setMatrixAt(i, this.matrix);
            const blink = (Math.sin(time * 3.2 + item.seed * 5) > .55 ? 1 : .08) * pop;
            this.s.setScalar(Math.max(.001, blink));
            this.matrix.compose(this.v, this.q, this.s);
            this.light.setMatrixAt(i, this.matrix);
        });
        for (const mesh of [this.body, this.band, this.light]) {
            mesh.count = this.items.length;
            mesh.instanceMatrix.needsUpdate = true;
        }
    }
}

// Four glowing corner brackets that spin in and close on the target cell.
class Reticle {
    constructor(scene) {
        this.group = new THREE.Group();
        this.material = new THREE.MeshBasicMaterial({color: 0xffffff, transparent: true, depthTest: false, depthWrite: false, opacity: 0, blending: THREE.AdditiveBlending});
        const pieces = [];
        for (let i = 0; i < 4; i++) {
            const angle = i * Math.PI / 2;
            const a = new THREE.BoxGeometry(.2, .012, .03).translate(-.4, 0, -.5 + .015);
            const b = new THREE.BoxGeometry(.03, .012, .2).translate(-.5 + .015, 0, -.4);
            for (const piece of [a, b]) {
                piece.rotateY(angle);
                pieces.push(piece);
            }
        }
        const ring = new THREE.RingGeometry(.1, .125, 40).rotateX(-Math.PI / 2);
        pieces.push(ring.toNonIndexed());
        const geometry = mergeGeometries(pieces.map(g => (g.index ? g.toNonIndexed() : g)));
        this.mesh = new THREE.Mesh(geometry, this.material);
        this.mesh.renderOrder = 20;
        this.mesh.layers.set(NO_REFLECTION_LAYER);
        this.group.add(this.mesh);
        this.group.visible = false;
        scene.add(this.group);
        this.state = 'idle';
        this.t = 0;
    }

    lock(position, color) {
        this.group.position.set(position.x, .32, position.z);
        this.material.color.set(color).multiplyScalar(2.2);
        this.state = 'lock';
        this.t = 0;
        this.group.visible = true;
    }

    release() {
        if (this.state === 'idle') return;
        this.state = 'release';
        this.t = 0;
    }

    update(dt, time) {
        if (this.state === 'idle') return;
        this.t += dt;
        if (this.state === 'lock') {
            const k = Math.min(1, this.t / .5);
            const ease = 1 - Math.pow(1 - k, 3);
            this.group.scale.setScalar(THREE.MathUtils.lerp(2.4, 1, ease) * (1 + Math.sin(time * 12) * .03 * ease));
            this.group.rotation.y = (1 - ease) * Math.PI / 2;
            this.material.opacity = ease * .95;
        } else {
            const k = Math.min(1, this.t / .3);
            this.material.opacity = (1 - k) * .95;
            this.group.scale.setScalar(1 + k * .4);
            if (k >= 1) {
                this.state = 'idle';
                this.group.visible = false;
            }
        }
    }
}
