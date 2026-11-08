import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { WALL, WALL_CLEARANCE } from './wall.js';

// The camera operator. Tactical mode holds a wide view of both fleets; cinematic mode cuts between close
// rigs for each shot (the ship aiming, the launch, the round in flight from the side and from a drone beside
// it, the impact) and a slow orbit around anything that sinks. Free mode hands the camera to the viewer.
// Moves within a shot are damped springs; changes of shot are hard cuts, and explosions shake the frame by how
// close they are.
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

    // Cinematic mode cuts between camera rigs the way an edited battle sequence does. Establishing: a low
    // three-quarter view of the ship as it trains on the target. Launch: close beside the gun or launcher as it
    // fires. Side: a fixed camera above the barrier panning with the round as it arcs across. Drone: flying
    // right alongside the round as it comes down, in slow motion at the end. Impact: low over the water on the
    // far side as it lands. Tactical mode keeps the wide view and only leans toward each shot.
    beginShot({shooter, target, close}) {
        this.onNear?.(.1);
        if (this.mode !== 'cinematic' || this.reducedMotion) {
            if (this.mode === 'tactical') this.leanToward(shooter, target);
            return;
        }
        const toTarget = target.clone().sub(shooter).setY(0);
        const distance = toTarget.length();
        toTarget.normalize();
        const sideSign = Math.random() < .5 ? 1 : -1;
        const side = new THREE.Vector3().crossVectors(toTarget, UP).multiplyScalar(sideSign);
        this.shot = {shooter: shooter.clone(), target: target.clone(), close: true, side, sideSign, toTarget, distance, phase: 'establish', step: 0, jitter: (Math.random() - .5) * 1.1, last: null};
        this.orbit = null;
        this.releaseAt = undefined;
        // Establishing: low, from the open sea on the firing ship's own side, the ship filling the frame.
        const home = Math.sign(shooter.x) || 1;
        const around = new THREE.Vector3(home * .75, 0, sideSign * .66).normalize();
        const position = shooter.clone().addScaledVector(around, 2.3).add(new THREE.Vector3(0, .55, 0));
        const look = shooter.clone().add(new THREE.Vector3(0, .18, 0)).addScaledVector(toTarget, .4);
        this.cut(position, look);
        // A slow push in while she trains her guns.
        this.goal.position.copy(shooter).addScaledVector(around, 1.85).add(new THREE.Vector3(0, .45, 0));
        this.goal.smooth = 2.2;
        this.goal.lookSmooth = 1.2;
    }

    // Tactical mode: the wide view, leaning a little toward the action.
    leanToward(shooter, target) {
        const {position, look} = this.overview();
        const focus = shooter.clone().lerp(target, .5);
        this.goal.position.copy(position).lerp(focus.clone().add(new THREE.Vector3(0, position.y * .75, position.z * .6)), .1);
        this.goal.look.copy(look).lerp(focus, .18);
        this.goal.smooth = 1.2;
        this.goal.lookSmooth = .8;
    }

    // A hard cut: the camera is simply there, no move.
    cut(position, look) {
        this.position.copy(position);
        this.look.copy(look);
        this.goal.position.copy(position);
        this.goal.look.copy(look);
        this.velocity.set(0, 0, 0);
        this.lookVelocity.set(0, 0, 0);
    }

    // The round leaves the ship: cut to close beside the muzzle or the launcher. dir: the way it leaves.
    cueLaunch({at, dir, vertical = false, scale = 1}) {
        const shot = this.shot;
        if (!shot || this.mode !== 'cinematic') return;
        shot.phase = 'launch';
        shot.step = 1;
        shot.launch = at.clone();
        const flat = (vertical ? shot.toTarget.clone() : dir.clone().setY(0)).normalize();
        const side = new THREE.Vector3().crossVectors(flat, UP).normalize().multiplyScalar(shot.sideSign);
        let position, look;
        if (vertical) {
            // Beside the launcher, low, looking up the column as the missile climbs out of it.
            position = at.clone().addScaledVector(side, .6 * scale).addScaledVector(flat, -.4 * scale).add(new THREE.Vector3(0, .05, 0));
            look = at.clone().add(new THREE.Vector3(0, 1.1 * scale, 0)).addScaledVector(flat, .2);
        } else {
            // Behind and beside the gun, a little above it: the turret and its barrels in the foreground, the
            // blast and the sky the round climbs into ahead.
            position = at.clone().addScaledVector(side, .5 * scale).addScaledVector(flat, -.6 * scale).add(new THREE.Vector3(0, .14 * scale, 0));
            look = at.clone().addScaledVector(flat, 1.3 * scale).add(new THREE.Vector3(0, .3 * scale, 0));
        }
        position.y = Math.max(position.y, .22);
        this.cut(position, look);
        this.goal.position.copy(position).addScaledVector(flat, .12);
        this.goal.smooth = 1.2;
        this.goal.lookSmooth = .35;
    }

    // While the round is in the air: launch, then the side view (long flights only), then the drone.
    follow(projectile, progress, duration = 2) {
        const shot = this.shot;
        if (!shot || this.mode !== 'cinematic') return;
        const velocity = shot.last ? projectile.clone().sub(shot.last) : shot.toTarget.clone();
        shot.last = projectile.clone();
        if (velocity.lengthSq() > 1e-10) shot.dir = velocity.normalize();
        // The drone takes over once the round is over the barrier and coming down on the far side; until then
        // the side view shows it climbing across.
        const homeSide = Math.sign(shot.target.x) || 1;
        if (shot.strike) {
            if (this.followStrike(projectile)) return;
        } else {
            const across = projectile.x * homeSide > .7 && progress > .4;
            const want = progress < (duration > 2.1 ? .14 : .18) ? 1 : across ? 3 : 2;
            if (want > shot.step) {
                shot.step = want;
                if (want === 2) this.cutSide(projectile);
                if (want === 3) shot.phase = 'drone';
            }
        }
        if (shot.phase === 'launch') {
            this.goal.look.lerp(projectile, .35);
        } else if (shot.phase === 'side') {
            // A fixed camera panning with the round.
            this.goal.look.copy(projectile);
            this.goal.lookSmooth = .12;
        } else if (shot.phase === 'drone') {
            const dir = shot.dir || shot.toTarget;
            const side = new THREE.Vector3().crossVectors(dir, UP);
            if (side.lengthSq() < 1e-6) side.copy(shot.side);
            side.normalize().multiplyScalar(shot.sideSign);
            // Just behind and beside the round, looking past it to where it will land: the round in the
            // foreground, the target ship growing ahead.
            const position = projectile.clone().addScaledVector(dir, -.4).addScaledVector(side, .6).add(new THREE.Vector3(0, .18, 0));
            const look = projectile.clone().addScaledVector(dir, .5).lerp(shot.target, .55);
            // Never inside or hugging the barrier.
            if (position.x * homeSide < WALL.baseHalf + .6) position.x = homeSide * (WALL.baseHalf + .6);
            if (!shot.droneStarted) {
                shot.droneStarted = true;
                this.cut(position, look);
            }
            this.goal.position.copy(position);
            this.goal.look.copy(look);
            this.goal.smooth = .05;
            this.goal.lookSmooth = .05;
        }
    }

    // The carrier strike has its own shots. spool: on deck by the jet's nose, low, the afterburners lighting
    // the blast deflector behind it. catapult: a camera low on the bow edge looking back down the track, whipping
    // round as the jet roars past. Then a chase camera behind the jet as it climbs and turns over the barrier;
    // dive: riding just behind and above it as it pushes over, the target growing in the middle of the frame;
    // terminal: a camera by the target, the jet screaming down at it in slow motion.
    cueStrike(stage, data = {}) {
        const shot = this.shot;
        if (!shot || this.mode !== 'cinematic') return;
        shot.strike = true;
        const f = data.forward;
        const side = f ? new THREE.Vector3().crossVectors(f, UP).normalize().multiplyScalar(shot.sideSign) : null;
        if (stage === 'spool' && data.crew) {
            // Low on the deck behind the director's shoulder: the lit wands circling in the foreground, the jet
            // spooling up beyond them, its afterburners lighting the blast deflector.
            shot.phase = 'spool';
            const c = data.crew, at = data.at;
            const away = c.clone().sub(at).setY(0).normalize();
            const across = new THREE.Vector3().crossVectors(away, UP).normalize().multiplyScalar(shot.sideSign);
            const position = c.clone().addScaledVector(away, .1).addScaledVector(across, .03).add(new THREE.Vector3(0, .024, 0));
            this.cut(position, at.clone().lerp(c, .42).add(new THREE.Vector3(0, .016, 0)));
            this.goal.position.copy(position).addScaledVector(across, -.02).addScaledVector(away, .015);
            this.goal.smooth = 3;
            this.goal.lookSmooth = 2;
            this.onNear?.(.02);
        } else if (stage === 'spool') {
            shot.phase = 'spool';
            const at = data.at;
            this.cut(at.clone().addScaledVector(f, .4).addScaledVector(side, .3).add(new THREE.Vector3(0, .05, 0)), at.clone().addScaledVector(f, -.06).add(new THREE.Vector3(0, .015, 0)));
            this.goal.position.copy(at).addScaledVector(f, .3).addScaledVector(side, .25).add(new THREE.Vector3(0, .045, 0));
            this.goal.smooth = 2.6;
            this.goal.lookSmooth = 1.6;
        } else if (stage === 'cockpit') {
            // In the pilot's seat: the canopy bow and nose ahead, the head-up display, the target growing.
            shot.phase = 'cockpit';
            shot.jet = data.jet;
            shot.eye = data.eye.clone();
            shot.diveTarget = data.target.clone();
            this.onNear?.(.003);
        } else if (stage === 'catapult') {
            this.onNear?.(.1);
            // On the deck near the bow, just clear of the jet's wingtip, low: the jet charges at the lens.
            shot.phase = 'catapult';
            shot.forward = f.clone();
            const position = data.camera ? data.camera.clone() : data.start.clone().lerp(data.end, .78).addScaledVector(side, .14).add(new THREE.Vector3(0, .028, 0));
            shot.bow = position.clone();
            this.cut(position, data.start.clone().add(new THREE.Vector3(0, .012, 0)));
            this.goal.smooth = 6;
        } else if (stage === 'dive') {
            shot.phase = 'dive';
            shot.diveTarget = data.target.clone();
        } else if (stage === 'terminal') {
            this.onNear?.(.1);
            // Beside the dive, low over the water (above the deck for a ship), far enough back for the blast to
            // fit the frame. It stays put and turns gently from the incoming jet down to the target.
            shot.phase = 'terminal';
            shot.terminalAt = data.camera.clone();
            this.cut(data.camera, data.look);
            this.goal.position.copy(data.camera);
        }
    }

    // Per frame during the strike's flight. Returns true when it has set the camera itself.
    followStrike(projectile) {
        const shot = this.shot;
        if (shot.phase === 'cockpit' && shot.jet) {
            const jet = shot.jet;
            jet.updateMatrixWorld();
            const position = jet.localToWorld(shot.eye.clone());
            const look = jet.localToWorld(shot.eye.clone().add(new THREE.Vector3(1, -.04, 0)));
            this.cut(position, look);
            return true;
        }
        if (shot.phase === 'dive') {
            // Rigidly behind and above the jet, looking down its dive at the target.
            const dir = shot.dir || shot.forward;
            const side = new THREE.Vector3().crossVectors(dir, UP);
            if (side.lengthSq() < 1e-6) side.copy(shot.side);
            side.normalize().multiplyScalar(shot.sideSign);
            const position = projectile.clone().addScaledVector(dir, -.42).addScaledVector(side, .1).add(new THREE.Vector3(0, .1, 0));
            const look = projectile.clone().addScaledVector(dir, .6).lerp(shot.diveTarget, .35);
            this.cut(position, look);
            return true;
        }
        if (shot.phase === 'terminal') {
            this.goal.position.copy(shot.terminalAt);
            this.goal.look.copy(shot.diveTarget).lerp(projectile, .25);
            this.goal.lookSmooth = .3;
            return true;
        }
        if (shot.phase === 'catapult') {
            // A fixed camera on the bow, whipping round as the jet goes past.
            this.goal.look.copy(projectile).add(new THREE.Vector3(0, .01, 0));
            this.goal.lookSmooth = .03;
            if (projectile.clone().sub(shot.bow).dot(shot.forward) > .45) {
                shot.phase = 'chase';
                shot.chaseStarted = false;
            }
            return true;
        }
        if (shot.phase === 'chase') {
            // Behind and a little above the jet, offset to one side, lagging just enough to feel its speed.
            const dir = shot.dir || shot.forward;
            const side = new THREE.Vector3().crossVectors(dir, UP);
            if (side.lengthSq() < 1e-6) side.copy(shot.side);
            side.normalize().multiplyScalar(shot.sideSign);
            // Behind it on the level and above, so a climb shows the jet's back against the sea, not its belly.
            const flat = dir.clone().setY(0);
            if (flat.lengthSq() < 1e-4) flat.copy(shot.forward);
            flat.normalize();
            // Rigidly mounted, like a camera on a chase plane: no lag, so the jet holds its place in the frame.
            const position = projectile.clone().addScaledVector(flat, -.5).addScaledVector(side, .17).add(new THREE.Vector3(0, .2, 0));
            // Aim ahead on the level, rising only a little with a climb, so the jet sits just below the middle.
            const look = projectile.clone().addScaledVector(flat, .85).add(new THREE.Vector3(0, dir.y * .3 - .02, 0));
            if (!shot.chaseStarted) shot.chaseStarted = true;
            this.cut(position, look);
            return true;
        }
        return false;
    }

    // The side view: a camera hanging above the barrier, square to the round's path, panning with it.
    cutSide(projectile) {
        const shot = this.shot;
        shot.phase = 'side';
        const from = shot.launch || shot.shooter;
        const middle = from.clone().lerp(shot.target, .5);
        const across = new THREE.Vector3().crossVectors(shot.toTarget, UP).normalize().multiplyScalar(shot.sideSign);
        const distance = THREE.MathUtils.clamp(shot.distance * .7, 6, 11);
        const position = middle.clone().addScaledVector(across, distance);
        position.y = WALL_CLEARANCE + 2.2;
        this.cut(position, projectile.clone());
        this.goal.smooth = 3;
    }

    // Look at the impact from the open-sea side of the target's fleet, a little toward the front: never
    // from across the wall, which would hide it.
    impactVantage(shot, distance = 1.9, height = .4) {
        const outward = Math.sign(shot.target.x) || 1;
        const dir = new THREE.Vector3(outward * .62, 0, .78).normalize().applyAxisAngle(UP, shot.jitter * outward);
        const position = shot.target.clone().setY(0).addScaledVector(dir, distance).add(new THREE.Vector3(0, height, 0));
        if (position.x * outward < 2.1) position.x = outward * 2.1;
        return position;
    }

    impact(point, kind) {
        this.onNear?.(.1);
        const shot = this.shot;
        this.shake = Math.max(this.shake, kind === 'miss' ? .05 : kind === 'sunk' ? .3 : .2);
        if (!shot || this.mode !== 'cinematic') return;
        if (shot.phase === 'terminal') {
            // The jet has gone in right in front of the camera by the target: hold the shot and ease back from it.
            shot.phase = 'impact';
            const away = shot.terminalAt.clone().sub(point).setY(0).normalize();
            this.goal.position.copy(shot.terminalAt).addScaledVector(away, .9).add(new THREE.Vector3(0, .35, 0));
            this.goal.look.copy(point).add(new THREE.Vector3(0, .3, 0));
            this.goal.smooth = 1.8;
            this.goal.lookSmooth = .5;
            return;
        }
        // Cut to a low angle over the water on the far side, the strike filling the frame, then ease back.
        shot.phase = 'impact';
        const wide = kind === 'sunk' ? 2.8 : kind === 'miss' ? 1.7 : 2.1;
        const position = this.impactVantage(shot, wide, kind === 'miss' ? .3 : .42);
        const look = point.clone().add(new THREE.Vector3(0, kind === 'miss' ? .3 : .25, 0));
        this.cut(position, look);
        this.goal.position.copy(this.impactVantage(shot, wide * 1.25, kind === 'miss' ? .38 : .55));
        this.goal.look.copy(look).add(new THREE.Vector3(0, .12, 0));
        this.goal.smooth = 2.4;
        this.goal.lookSmooth = 1.6;
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
        this.onNear?.(.1);
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
        // Close rigs (beside a muzzle, next to a falling round, over the water) may sit low; wide shots may not.
        goalPosition.y = Math.max(goalPosition.y, this.shot ? .2 : .45);
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
        // In the cockpit the pilot's head rolls with the jet, so the horizon tilts and the HUD stays square.
        if (this.shot?.phase === 'cockpit' && this.shot.jet) this.camera.up.set(0, 1, 0).applyQuaternion(this.shot.jet.getWorldQuaternion(this.rollQuat || (this.rollQuat = new THREE.Quaternion())));
        else this.camera.up.set(0, 1, 0);
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
