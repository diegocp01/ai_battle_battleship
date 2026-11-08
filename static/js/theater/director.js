import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { WALL, WALL_CLEARANCE } from './wall.js';

// The camera operator. Tactical mode holds a wide view of both fleets; cinematic mode follows each shot:
// over the shoulder of the ship that fires, along the shell's flight, a close angle on the impact, and a
// slow orbit around anything that sinks. Free mode hands the camera to the viewer. All moves are damped
// springs, so cuts never jump, and explosions shake the frame by how close they are.
const UP = new THREE.Vector3(0, 1, 0);

function smoothDamp(current, target, velocity, smoothTime, dt) {
    const omega = 2 / Math.max(1e-4, smoothTime);
    const x = omega * dt;
    const exp = 1 / (1 + x + .48 * x * x + .235 * x * x * x);
    const change = current.clone().sub(target);
    const temp = velocity.clone().addScaledVector(change, omega).multiplyScalar(dt);
    velocity.sub(temp.clone().multiplyScalar(omega)).multiplyScalar(exp);
    current.copy(target).add(change.add(temp).multiplyScalar(exp));
}

export class Director {
    constructor(camera, element, {bounds}) {
        this.camera = camera;
        this.bounds = bounds;   // {center, width, depth}
        this.mode = 'cinematic';
        this.position = camera.position.clone();
        this.look = new THREE.Vector3();
        this.velocity = new THREE.Vector3();
        this.lookVelocity = new THREE.Vector3();
        this.goal = {position: new THREE.Vector3(), look: new THREE.Vector3(), smooth: 1.4, lookSmooth: .9};
        this.shake = 0;
        this.shakeSeed = Math.random() * 100;
        this.time = 0;
        this.shot = null;
        this.orbit = null;
        this.aspect = 16 / 9;
        this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
        // The viewer can always take the camera: scrolling zooms whatever shot is running, and dragging
        // hands over control (free mode) from exactly the current view.
        this.zoom = 1;
        this.onModeChange = null;
        this.controls = new OrbitControls(camera, element);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = .08;
        this.controls.maxPolarAngle = Math.PI / 2 - .06;
        this.controls.minDistance = 1.5;
        this.controls.maxDistance = 70;
        this.controls.zoomSpeed = 1.2;
        this.controls.target.copy(bounds.center);
        this.controls.addEventListener('start', () => { this.dragging = true; });
        this.controls.addEventListener('end', () => { this.dragging = false; });
        this.controls.addEventListener('change', () => {
            if (this.mode !== 'free' && this.dragging) this.takeOver();
        });
        element.addEventListener('wheel', (event) => {
            if (this.mode === 'free') return;
            event.preventDefault();
            event.stopImmediatePropagation();
            this.zoom = THREE.MathUtils.clamp(this.zoom * Math.exp(Math.sign(event.deltaY) * Math.min(Math.abs(event.deltaY), 120) * .0011), .3, 2.4);
        }, {capture: true, passive: false});
        this.attract = false;
        this.frameOverview(true);
    }

    // A drag started during an automatic shot: continue from this exact view under the viewer's control.
    takeOver() {
        this.mode = 'free';
        this.shot = null;
        this.orbit = null;
        this.onModeChange?.('free');
    }

    setAspect(aspect) {
        this.aspect = aspect;
        if (!this.shot && !this.orbit) this.frameOverview(false);
    }

    // The free part of the screen: its aspect ratio and the share of the view height it covers.
    setFrame(frame) {
        this.frame = frame;
    }

    // A wide shot that fits both grids for the current aspect ratio.
    overview() {
        const {center, width, depth} = this.bounds;
        const fov = THREE.MathUtils.degToRad(this.camera.fov);
        const aspect = this.frame?.aspect ?? this.aspect;
        const tanV = Math.tan(fov / 2) * (this.frame?.heightRatio ?? 1);
        const portrait = aspect < 1.05;
        const pitch = THREE.MathUtils.degToRad(portrait ? 48 : 31);
        const spanW = portrait ? depth : width, spanD = portrait ? width : depth;
        const distW = (spanW / 2) / (tanV * aspect) * 1.02;
        const distD = (spanD * .62) / tanV;
        const distance = Math.max(distW, distD) + 1.5;
        // A few degrees toward the sun, so the barrier shows its sunlit face rather than a thin top edge.
        const azimuth = portrait ? -Math.PI / 2 : -.17;
        const look = center.clone().add(new THREE.Vector3(0, 0, portrait ? 0 : .6));
        const position = look.clone().add(new THREE.Vector3(Math.sin(azimuth) * Math.cos(pitch), Math.sin(pitch), Math.cos(azimuth) * Math.cos(pitch)).multiplyScalar(distance));
        return {position, look};
    }

    frameOverview(snap) {
        const {position, look} = this.overview();
        this.goal.position.copy(position);
        this.goal.look.copy(look);
        this.goal.smooth = 1.8;
        this.goal.lookSmooth = 1.2;
        if (snap) {
            this.position.copy(position);
            this.look.copy(look);
        }
    }

    setMode(mode) {
        if (mode === this.mode) return;
        this.mode = mode;
        if (mode === 'free') {
            this.controls.target.copy(this.look);
            this.camera.position.copy(this.position);
            this.controls.update();
        } else {
            this.position.copy(this.camera.position);
            this.look.copy(this.controls.target);
            this.velocity.set(0, 0, 0);
            this.lookVelocity.set(0, 0, 0);
            this.shot = null;
            this.orbit = null;
            if (this.attract) this.setAttract(true);
            else this.frameOverview(false);
        }
    }

    // ---------------------------------------------------------------------------------------------------
    // Shot choreography
    // ---------------------------------------------------------------------------------------------------

    beginShot({shooter, target, close}) {
        if (this.mode !== 'cinematic' || this.reducedMotion) return;
        const toTarget = target.clone().sub(shooter).setY(0);
        const distance = toTarget.length();
        toTarget.normalize();
        const side = new THREE.Vector3().crossVectors(toTarget, UP).multiplyScalar(Math.random() < .5 ? 1 : -1);
        this.shot = {shooter: shooter.clone(), target: target.clone(), close, side, toTarget, distance, phase: 'aim', jitter: (Math.random() - .5) * 1.1, progress: 0};
        this.orbit = null;
        if (close) {
            // Over the shoulder of the firing ship, the barrier behind it, the sky above it where the round will go.
            const home = Math.sign(shooter.x) || 1;
            const shoulder = shooter.clone().addScaledVector(toTarget, -3.2).addScaledVector(side, 1.5).add(new THREE.Vector3(0, 1.5, 0));
            if (shoulder.x * home < 3.6) shoulder.x = home * 3.6;
            this.shot.shoulder = shoulder;
            this.goal.position.copy(shoulder);
            // Aim at the sky just above the barrier's top, the ship firing in the foreground.
            this.goal.look.set(home * .5, WALL_CLEARANCE - .2, (shooter.z + target.z) / 2).lerp(shooter, .35);
            this.goal.smooth = .85;
            this.goal.lookSmooth = .6;
        } else {
            const {position, look} = this.overview();
            const focus = shooter.clone().lerp(target, .5);
            this.goal.position.copy(position).lerp(focus.clone().add(new THREE.Vector3(0, position.y * .75, position.z * .6)), .1);
            this.goal.look.copy(look).lerp(focus, .18);
            this.goal.smooth = 1.2;
            this.goal.lookSmooth = .8;
        }
    }

    // While the round is in the air, swing toward the impact and keep the projectile in frame.
    follow(projectile, progress) {
        const shot = this.shot;
        if (!shot || this.mode !== 'cinematic') return;
        if (shot.close) {
            // A crane move on a curve: from the shoulder, up and over the barrier, down to the impact vantage.
            shot.progress = Math.max(shot.progress, THREE.MathUtils.smoothstep(progress, .1, .9));
            const t = shot.progress;
            const start = shot.shoulder, end = this.impactVantage(shot);
            const apex = new THREE.Vector3(0, WALL_CLEARANCE + 3.2, (start.z + end.z) / 2 + 2.5);
            this.goal.position.set(0, 0, 0).addScaledVector(start, (1 - t) * (1 - t)).addScaledVector(apex, 2 * (1 - t) * t).addScaledVector(end, t * t);
            this.goal.look.copy(projectile).lerp(shot.target, THREE.MathUtils.smoothstep(progress, .55, 1) * Math.min(1, t * 1.4));
            this.goal.smooth = .5;
            this.goal.lookSmooth = .25;
        } else {
            this.goal.look.lerp(projectile.clone().lerp(shot.target, .6), .12);
        }
    }

    // Look at the impact from the open-sea side of the target's fleet, a little toward the front: never
    // from across the wall, which would hide it.
    impactVantage(shot) {
        const outward = Math.sign(shot.target.x) || 1;
        const dir = new THREE.Vector3(outward * .62, 0, .78).normalize().applyAxisAngle(UP, shot.jitter * outward);
        const position = shot.target.clone().addScaledVector(dir, 3.4).add(new THREE.Vector3(0, 1.15, 0));
        if (position.x * outward < 2.1) position.x = outward * 2.1;
        return position;
    }

    impact(point, kind) {
        const shot = this.shot;
        this.shake = Math.max(this.shake, kind === 'miss' ? .05 : kind === 'sunk' ? .3 : .2);
        if (!shot || this.mode !== 'cinematic') return;
        if (shot.close) {
            this.goal.position.copy(this.impactVantage(shot));
            const outward = Math.sign(shot.target.x) || 1;
            if (kind !== 'miss') this.goal.position.add(new THREE.Vector3(outward * .45, .35, .3));
            this.goal.look.copy(point).add(new THREE.Vector3(0, kind === 'miss' ? .35 : .3, 0));
            this.goal.smooth = 1.1;
            this.goal.lookSmooth = .5;
        } else {
            this.goal.look.lerp(point, .5);
        }
    }

    // A slow, low orbit around a ship going down.
    sinkOrbit(center, radius = 4.2) {
        if (this.mode !== 'cinematic' || this.reducedMotion) return;
        const start = Math.atan2(this.position.z - center.z, this.position.x - center.x);
        this.orbit = {center: center.clone(), radius, height: 1.2, angle: start, speed: .16, look: center.clone().add(new THREE.Vector3(0, .25, 0)), side: Math.sign(center.x) || 1};
        this.shot = null;
    }

    victory(center) {
        if (this.mode === 'free') return;
        this.orbit = {center: center.clone(), radius: 8, height: 5.2, angle: Math.atan2(this.position.z - center.z, this.position.x - center.x), speed: .07, look: center.clone().add(new THREE.Vector3(0, .7, 0))};
        this.shot = null;
    }

    // Attract mode on the setup page: a lazy orbit over both fleets.
    setAttract(on) {
        this.attract = on;
        if (on) {
            const {center} = this.bounds;
            this.orbit = {center: center.clone(), radius: 17, height: 7.5, angle: Math.PI * .42, speed: .028, look: center.clone().add(new THREE.Vector3(0, 0, 0))};
        } else {
            this.orbit = null;
            this.frameOverview(false);
        }
    }

    endShot(hold = 0) {
        this.releaseAt = this.time + hold;
    }

    addShake(at, strength) {
        const distance = at ? this.camera.position.distanceTo(at) : 8;
        this.shake = Math.min(.6, this.shake + strength / (1 + distance * .18));
    }

    update(dt) {
        this.time += dt;
        if (this.mode === 'free') {
            this.controls.update();
            this.shake *= Math.exp(-dt * 4.2);
            return;
        }
        if (this.releaseAt !== undefined && this.time >= this.releaseAt) {
            this.releaseAt = undefined;
            this.shot = null;
            if (!this.attract && !this.orbitLocked) this.orbit = null;
            if (!this.orbit) this.frameOverview(false);
        }
        if (this.orbit) {
            const o = this.orbit;
            o.angle += o.speed * dt;
            this.goal.position.set(o.center.x + Math.cos(o.angle) * o.radius, o.height, o.center.z + Math.sin(o.angle) * o.radius);
            this.goal.look.copy(o.look);
            this.goal.smooth = this.attract ? 2.4 : 1.6;
            this.goal.lookSmooth = 1.1;
        } else if (!this.shot) {
            // Breathing drift on the wide shot.
            const {position, look} = this.overview();
            position.x += Math.sin(this.time * .05) * 1.2;
            position.y += Math.sin(this.time * .07) * .4;
            this.goal.position.copy(position);
            this.goal.look.copy(look);
        }
        if (this.zoom !== 1) {
            const offset = this.goal.position.clone().sub(this.goal.look);
            const length = Math.max(1.4, offset.length() * this.zoom);
            this.zoomedGoal = (this.zoomedGoal || new THREE.Vector3()).copy(this.goal.look).add(offset.setLength(length));
        }
        const goalPosition = this.zoom !== 1 ? this.zoomedGoal : this.goal.position;
        goalPosition.y = Math.max(goalPosition.y, .45);
        if (this.orbit?.side && goalPosition.x * this.orbit.side < 2.1) goalPosition.x = this.orbit.side * 2.1;
        smoothDamp(this.position, goalPosition, this.velocity, this.goal.smooth, dt);
        smoothDamp(this.look, this.goal.look, this.lookVelocity, this.goal.lookSmooth, dt);
        // Never inside the concrete: lift over the barrier.
        const ceiling = WALL_CLEARANCE + .5;
        if (Math.abs(this.position.x) < WALL.baseHalf + 1 && this.position.z > WALL.zMin - 1 && this.position.z < WALL.zMax + 1 && this.position.y < ceiling) {
            this.position.y = ceiling;
            this.velocity.y = Math.max(this.velocity.y, 0);
        }
        this.camera.position.copy(this.position);
        this.camera.lookAt(this.look);
        // Ready for a drag to take over from exactly this view.
        if (!this.dragging) this.controls.target.copy(this.look);
        this.applyShake(dt);
    }

    applyShake(dt) {
        if (this.shake < .001 || this.reducedMotion) return;
        const t = this.time * 24 + this.shakeSeed;
        const s = this.shake;
        const offset = new THREE.Vector3(Math.sin(t * 1.3) + Math.sin(t * 2.9) * .5, Math.sin(t * 1.7 + 1) + Math.sin(t * 3.3) * .4, Math.sin(t * 1.1 + 2) * .6).multiplyScalar(s * .06);
        this.camera.position.add(offset);
        this.camera.rotateZ(Math.sin(t * 1.9) * s * .012);
        this.shake *= Math.exp(-dt * 4.2);
    }
}
