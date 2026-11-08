import * as THREE from 'three';
import { RAMP, FRAME } from './effects.js';
import { jetMesh } from './ships.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { WALL_CLEARANCE } from './wall.js';

// How a shot plays out. The attacking fleet picks a ship that is still afloat and uses its weapon: the
// battleship trains a turret and fires a three-gun salvo, cruisers and destroyers fire their 5-inch gun or
// ripple a missile out of a vertical launcher, the submarine sends a torpedo, and the carrier launches a jet
// that drops a bomb. The round lands as a splash, a hit that sets the ship burning, or the blow that sinks it.
const UP = new THREE.Vector3(0, 1, 0);
const other = (team) => (team === 'gpt' ? 'claude' : 'gpt');
// How big a fire each weapon starts, and how readily each ship burns: a carrier's aviation fuel, the
// littoral combat ship's aluminium superstructure, a submarine's small, closed hull.
const FIRE_BY_WEAPON = {gun: .85, salvo: 1.3, missile: 1.25, subMissile: 1.2, strike: 1.45, torpedo: .9};
const FIRE_BY_SHIP = {Carrier: 1.2, Battleship: .95, Cruiser: 1.05, Destroyer: 1.15, Submarine: .6};

export class Combat {
    constructor(theater) {
        this.t = theater;
        this.projectiles = [];
        const white = new THREE.MeshStandardMaterial({color: 0xe9ebe8, roughness: .4, metalness: .2});
        const body = new THREE.CylinderGeometry(.009, .011, .11, 10).rotateZ(-Math.PI / 2);
        const nose = new THREE.ConeGeometry(.009, .03, 10).rotateZ(-Math.PI / 2).translate(.07, 0, 0);
        const fins = [0, 1, 2, 3].map(i => new THREE.BoxGeometry(.025, .03, .002).translate(-.045, 0, 0).rotateX(i * Math.PI / 2 + Math.PI / 4));
        this.missileGeometry = mergeGeometries([body, nose, ...fins].map(g => g.toNonIndexed()));
        this.missileMaterial = white;
        this.bombGeometry = new THREE.CapsuleGeometry(.008, .04, 4, 8).rotateZ(Math.PI / 2);
        this.bombMaterial = new THREE.MeshStandardMaterial({color: 0x3d4146, roughness: .6, metalness: .4});
    }

    // ---------------------------------------------------------------------------------------------------
    // Projectiles
    // ---------------------------------------------------------------------------------------------------

    fly({kind, path, duration, mesh = null, primary = false, orient = true}) {
        return new Promise(resolve => {
            if (mesh) this.t.scene.add(mesh);
            this.projectiles.push({kind, path, duration, mesh, primary, orient, t: 0, previous: path(0).clone(), velocity: new THREE.Vector3(), resolve});
        });
    }

    update(dt) {
        const fx = this.t.effects;
        // Projectiles launched during this pass (a bomb released by a jet) join the list after it.
        const current = this.projectiles;
        this.projectiles = [];
        const survivors = current.filter(p => {
            p.t += dt;
            const k = Math.min(1, p.t / p.duration);
            const position = p.path(k);
            const from = p.previous.clone();
            p.velocity.copy(position).sub(p.previous).divideScalar(Math.max(dt, 1e-4));
            p.previous.copy(position);
            if (p.mesh) {
                p.mesh.position.copy(position);
                if (p.orient && p.velocity.lengthSq() > 1e-6) {
                    const forward = p.velocity.clone().normalize();
                    const right = new THREE.Vector3().crossVectors(forward, UP);
                    if (right.lengthSq() < 1e-6) right.set(0, 0, 1);
                    right.normalize();
                    const up = new THREE.Vector3().crossVectors(right, forward);
                    p.mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(forward, up, right));
                    if (p.bank) p.mesh.rotateX(p.bank);
                }
            }
            if (p.kind && dt > 0) fx.trail(p.kind, position, p.velocity, dt, k, from, p);
            if (p.primary) this.t.director.follow(position, k);
            if (p.onStep) p.onStep(k, position, p);
            if (k >= 1) {
                if (p.mesh && !p.keepMesh) this.t.scene.remove(p.mesh);
                p.resolve(position);
                return false;
            }
            return true;
        });
        this.projectiles = survivors.concat(this.projectiles);
    }

    clear() {
        for (const p of this.projectiles) {
            if (p.mesh) this.t.scene.remove(p.mesh);
            p.resolve(p.previous);
        }
        this.projectiles = [];
    }

    ballistic(from, to, height) {
        const a = from.clone(), b = to.clone();
        return (k) => a.clone().lerp(b, k).addScaledVector(UP, height * 4 * k * (1 - k));
    }

    // How high above the straight line a parabola must rise to pass over the sea wall at x = 0.
    arcHeight(from, to, base) {
        if (Math.sign(from.x) === Math.sign(to.x)) return base;
        const k = from.x / (from.x - to.x);
        const lineY = from.y + (to.y - from.y) * k;
        return Math.max(base, (WALL_CLEARANCE - lineY) / (4 * k * (1 - k)));
    }

    // Barrel elevation for a parabola: its slope as it leaves the muzzle.
    launchPitch(from, to, height) {
        const distance = Math.hypot(to.x - from.x, to.z - from.z);
        return THREE.MathUtils.clamp(Math.atan2(to.y - from.y + 4 * height, Math.max(distance, .1)), .08, 1.15);
    }

    // ---------------------------------------------------------------------------------------------------
    // A full shot
    // ---------------------------------------------------------------------------------------------------

    async playShot(shot, {onImpact} = {}) {
        const T = this.t;
        const attacker = shot.player, defender = other(attacker);
        const color = T.colors[attacker];
        const enemy = T.fleets[defender];
        const victim = shot.result !== 'miss' ? enemy?.ships.get(shot.ship) : null;
        T.scene.updateMatrixWorld();
        let impact, anchor = null, local = null;
        if (victim) {
            local = victim.localForCell(shot.target);
            anchor = new THREE.Object3D();
            anchor.position.set(local.x, victim.surfaceAt(local.x, local.z) + .008, local.z);
            victim.attach(anchor);
            victim.root.updateMatrixWorld(true);
            impact = anchor.getWorldPosition(new THREE.Vector3());
        } else {
            impact = T.grid.cellCenter(defender, shot.target).add(new THREE.Vector3((Math.random() - .5) * .28, 0, (Math.random() - .5) * .28));
        }
        const shooter = T.fleets[attacker]?.pickShooter();
        const close = shot.result !== 'miss' || Math.random() < .3;
        T.grid.lockOn(defender, shot.target, color);
        T.audio.play('lock');
        const origin = shooter ? shooter.root.position.clone() : T.grid.center(attacker);
        T.director.beginShot({shooter: origin, target: impact, close});
        await T.wait(close ? .55 : .3);
        const context = {shot, victim, impact};
        if (shooter) {
            const weapon = shooter.weapons[Math.floor(Math.random() * shooter.weapons.length)];
            context.weapon = weapon;
            // A shell can strike low on the hull, at the waterline, instead of the deck.
            context.waterline = Boolean(victim) && victim.type !== 'Submarine' && (weapon === 'salvo' || weapon === 'gun') && Math.random() < .35;
            // A turn always lands, even if an animation were to stall.
            await Promise.race([this[weapon](shooter, impact, context), T.wait(14)]);
        } else {
            await this.fly({kind: 'shell', path: this.ballistic(origin.clone().setY(.3), impact, 3), duration: 1.4, primary: true});
        }
        T.grid.release();
        if (!victim) {
            if (context.torpedo) T.effects.splash(impact, 1.55);
            else T.effects.splash(impact, context.heavy ? 1.2 : 1, {explosive: true});
            T.grid.markMiss(defender, shot.target);
            T.director.impact(impact, 'miss');
        } else {
            const kind = context.torpedo ? 'torpedo' : context.weapon || 'missile';
            const burst = context.waterline ? impact.clone().setY(Math.min(impact.y, .045)) : impact;
            T.effects.explosion(burst, shot.result === 'sunk' ? 1.25 : 1, {water: !!context.torpedo, kind, ship: victim.type, waterline: context.waterline});
            if (context.torpedo) T.effects.splash(impact.clone().setY(0), 1.1, {sound: false});
            victim.addBurn(local.x, local.z, .16 + victim.beam * .3);
            victim.burningCells.add(shot.target);
            T.effects.addFire(anchor, (FIRE_BY_WEAPON[kind] ?? 1) * (FIRE_BY_SHIP[victim.type] ?? 1));
            T.grid.markHit(defender, shot.target);
            T.director.impact(impact, shot.result);
            T.post.flash(.12);
        }
        T.grid.markLast(defender, shot.target);
        onImpact?.();
        if (shot.result === 'sunk') await this.sinkSequence(victim, defender);
        else await T.wait(victim ? 1.8 : 1.05);
        T.director.endShot(.15);
    }

    // Turn a turret onto the target and raise the guns.
    async train(ship, turret, target, elevation) {
        const T = this.t;
        const aim = ship.aim(turret, target);
        const yaw = aim.yaw, pitch = elevation ?? aim.pitch;
        const startYaw = turret.yaw.rotation.y, startPitch = turret.pitch.rotation.z;
        let delta = ((yaw - startYaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
        const duration = .35 + Math.abs(delta) * .22;
        T.audio.play('turret', turret.yaw.getWorldPosition(new THREE.Vector3()));
        await T.tween(duration, (k) => {
            const e = k * k * (3 - 2 * k);
            turret.yaw.rotation.y = startYaw + delta * e;
            turret.pitch.rotation.z = startPitch + (pitch - startPitch) * e;
        });
    }

    recoil(barrel) {
        const T = this.t;
        T.tween(.55, (k) => {
            barrel.position.x = -.035 * (k < .08 ? k / .08 : 1 - (k - .08) / .92);
        });
    }

    shellFlight(from, to, scale) {
        const distance = from.distanceTo(to);
        const height = this.arcHeight(from, to, .7 + distance * .2 * (.8 + scale * .2));
        return {duration: .85 + distance * .065 + height * .08, height, pitch: this.launchPitch(from, to, height)};
    }

    async salvo(ship, impact, context) {
        const T = this.t;
        context.heavy = true;
        const turret = this.chooseTurret(ship, impact);
        T.scene.updateMatrixWorld();
        const plan = this.shellFlight(turret.yaw.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, .05, 0)), impact, 1.3);
        await this.train(ship, turret, impact, plan.pitch);
        T.scene.updateMatrixWorld();
        const arrivals = [];
        const offsets = this.straddle(context, 3);
        for (let i = 0; i < turret.muzzles.length; i++) {
            const muzzle = turret.muzzles[i];
            const start = muzzle.getWorldPosition(new THREE.Vector3());
            const dir = new THREE.Vector3(1, 0, 0).transformDirection(muzzle.matrixWorld);
            T.effects.muzzle(start, dir, 1.85);
            this.recoil(turret.barrels[i]);
            if (i === 0) {
                T.audio.play('cannon', start, 1.5);
                T.director.addShake(start, .7);
                T.post.flash(.07);
                ship.kick(dir);
            }
            const target = i === 1 ? impact : impact.clone().add(offsets[i]);
            if (i !== 1) target.y = 0;
            const {duration, height} = this.shellFlight(start, target, 1.3);
            const flight = this.fly({kind: 'shell', path: this.ballistic(start, target, height), duration: duration + i * .05, primary: i === 1});
            if (i === 1) T.audio.play('whistle', target, duration * .9);
            else flight.then((at) => T.effects.splash(at, .75, {sound: i === 0, explosive: true}));
            arrivals.push(flight);
            await T.wait(.07);
        }
        await arrivals[1];
    }

    // Extra rounds land in the water around the target: beside the hull on a hit, around the cell on a miss.
    straddle(context, count) {
        const offsets = [];
        const victim = context.victim;
        for (let i = 0; i < count; i++) {
            const side = i % 2 ? 1 : -1;
            if (victim) {
                const across = new THREE.Vector3(0, 0, 1).applyAxisAngle(UP, victim.root.rotation.y);
                offsets.push(across.multiplyScalar(side * (victim.beam / 2 + .25 + Math.random() * .25)).add(new THREE.Vector3((Math.random() - .5) * .3, 0, (Math.random() - .5) * .3)));
            } else {
                const a = Math.random() * Math.PI * 2;
                offsets.push(new THREE.Vector3(Math.cos(a), 0, Math.sin(a)).multiplyScalar(.3 + Math.random() * .3));
            }
        }
        return offsets;
    }

    chooseTurret(ship, target) {
        // The turret that needs the least traverse.
        let best = ship.turrets[0], bestTurn = Infinity;
        for (const turret of ship.turrets) {
            const {yaw} = ship.aim(turret, target);
            const turn = Math.abs(((yaw - turret.yaw.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
            if (turn < bestTurn) {
                bestTurn = turn;
                best = turret;
            }
        }
        return best;
    }

    async gun(ship, impact) {
        const T = this.t;
        const turret = this.chooseTurret(ship, impact);
        T.scene.updateMatrixWorld();
        const plan = this.shellFlight(turret.yaw.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, .03, 0)), impact, .8);
        await this.train(ship, turret, impact, plan.pitch);
        T.scene.updateMatrixWorld();
        const muzzle = turret.muzzles[0];
        const start = muzzle.getWorldPosition(new THREE.Vector3());
        const dir = new THREE.Vector3(1, 0, 0).transformDirection(muzzle.matrixWorld);
        T.effects.muzzle(start, dir, .75);
        this.recoil(turret.barrels[0]);
        T.audio.play('cannon', start, .7);
        T.director.addShake(start, .2);
        const {duration, height} = this.shellFlight(start, impact, .8);
        T.audio.play('whistle', impact, duration * .9);
        await this.fly({kind: 'shell', path: this.ballistic(start, impact, height), duration, primary: true});
    }

    async missile(ship, impact, context) {
        const T = this.t;
        T.scene.updateMatrixWorld();
        // Cruisers ripple two missiles at the target ("shoot, shoot"); destroyers fire one.
        const rounds = ship.type === 'Cruiser' ? 2 : 1;
        const flights = [];
        for (let i = 0; i < rounds; i++) {
            const launcher = ship.launchers[(i + Math.floor(Math.random() * 2)) % ship.launchers.length];
            const start = ship.body.localToWorld(launcher.clone().add(new THREE.Vector3((Math.random() - .5) * .08, 0, (Math.random() - .5) * .08)));
            T.effects.vlsLaunch(start, ship.type === 'Cruiser' ? 1.1 : 1);
            T.audio.play(ship.type === 'Cruiser' ? 'missile' : 'missileLight', start, 1.3);
            T.post.flash(.04);
            const target = i === 0 ? impact : impact.clone().add(this.straddle(context, 1)[0].multiplyScalar(.5));
            if (i > 0 && !context.victim) target.y = 0;
            const flight = this.missileFlight(start, target, i === 0);
            if (i > 0) flight.then(at => (context.victim ? T.effects.explosion(at, .7, {debris: false, kind: 'missile', ship: context.victim.type}) : T.effects.splash(at, .8, {explosive: true})));
            flights.push(flight);
            if (i < rounds - 1) await T.wait(.55);
        }
        await flights[0];
    }

    missileFlight(start, impact, primary = true) {
        const toward = impact.clone().sub(start).setY(0);
        const p1 = start.clone().setY(WALL_CLEARANCE + 1.9);
        const p2 = impact.clone().setY(WALL_CLEARANCE + 1.5).addScaledVector(toward, -.18);
        const curve = new THREE.CubicBezierCurve3(start.clone(), p1, p2, impact.clone());
        const distance = start.distanceTo(impact);
        const mesh = new THREE.Mesh(this.missileGeometry, this.missileMaterial);
        mesh.castShadow = true;
        // Slow off the rail, then fast; the motor lights everything around it on the way up.
        const duration = 1.7 + distance * .055;
        mesh.position.copy(start);
        this.t.effects.follow(() => mesh.position, 1.3, duration * .85, new THREE.Color(1, .8, .58));
        const flight = this.fly({kind: 'missile', path: (k) => curve.getPoint(Math.pow(k, 1.35)), duration, mesh, primary});
        // A slow roll as it flies.
        this.projectiles[this.projectiles.length - 1].onStep = (k, position, p) => { p.bank = p.t * 4.5; };
        return flight;
    }

    // The submarine's missile leaves a canister under water and breaches the surface ahead of the sail.
    async subMissile(sub, impact) {
        const T = this.t;
        T.scene.updateMatrixWorld();
        const start = sub.body.localToWorld(new THREE.Vector3(1.05 * sub.scale.x, 0, 0));
        start.y = -.05;
        T.effects.bubbles(start, .25, 5);
        T.ocean.addImpact(start.x, start.z, .55);
        await T.wait(.35);
        T.effects.splash(start.clone().setY(0), .6, {sound: false});
        T.effects.steam(start, 1);
        T.effects.vlsLaunch(start.clone().setY(.02), .7);
        T.audio.play('subMissile', start, 1.1);
        await this.missileFlight(start, impact);
    }

    async torpedo(sub, impact, context) {
        const T = this.t;
        context.torpedo = true;
        T.scene.updateMatrixWorld();
        const start = sub.body.localToWorld(sub.torpedoTube.clone());
        start.y = -.03;
        T.effects.bubbles(start, .2, 4);
        T.ocean.addImpact(start.x, start.z, .35);
        const end = impact.clone();
        end.y = -.03;
        const duration = .6 + start.distanceTo(end) / 6.5;
        T.audio.play('torpedo', start, duration);
        T.director.addShake(start, .05);
        await this.fly({kind: 'torpedo', path: (k) => start.clone().lerp(end, k), duration, primary: true, orient: false});
        if (context.victim) impact.y = Math.max(.03, impact.y - .1);
    }

    async strike(carrier, impact, context) {
        const T = this.t;
        T.scene.updateMatrixWorld();
        const cat = carrier.catapult;
        const deckStart = carrier.body.localToWorld(cat.start.clone());
        const deckEnd = carrier.body.localToWorld(cat.end.clone());
        const jet = jetMesh(carrier.materials, 1.15 * carrier.scale.x);
        jet.traverse(o => { if (o.isMesh) o.castShadow = true; });
        T.effects.steam(deckStart, .7);
        const forward = deckEnd.clone().sub(deckStart).normalize();
        const toward = impact.clone().sub(deckEnd).setY(0).normalize();
        const side = new THREE.Vector3().crossVectors(toward, UP).multiplyScalar(Math.random() < .5 ? 1 : -1);
        const outward = Math.sign(impact.x) || 1;
        const over = new THREE.Vector3(0, WALL_CLEARANCE + 1.3, (deckEnd.z + impact.z) / 2).addScaledVector(side, .8);
        over.x = 0;
        // The dive starts on the far side of the wall, however close to it the target is.
        const release = impact.clone().addScaledVector(toward, -2.1).setY(1.7);
        if (release.x * outward < 1.2) release.x = outward * 1.2;
        const climb = deckEnd.clone().lerp(over, .5).setY(WALL_CLEARANCE * .8).addScaledVector(side, 1.2);
        const curve = new THREE.CatmullRomCurve3([
            deckStart,
            deckEnd,
            deckEnd.clone().addScaledVector(forward, 1.5).add(new THREE.Vector3(0, .6, 0)),
            climb,
            over,
            release,
            impact.clone().addScaledVector(toward, 1.4).setY(1.2),
            impact.clone().addScaledVector(toward, 5).setY(4.4).addScaledVector(side, -1.5),
            impact.clone().addScaledVector(toward, 16).setY(11),
        ], false, 'centripetal');
        let releaseU = .5, bestDistance = Infinity;
        for (let i = 0; i <= 200; i++) {
            const d = curve.getPointAt(i / 200).distanceToSquared(release);
            if (d < bestDistance) { bestDistance = d; releaseU = i / 200; }
        }
        const duration = 5.2;
        // Catapult stroke: a fast acceleration down the deck, then cruising speed.
        const ease = (k) => (k < .12 ? .045 * Math.pow(k / .12, 2) : .045 + (k - .12) / .88 * .955);
        T.audio.play('jet', deckEnd, duration * .9);
        let dropped = false;
        let bombDone;
        const bombArrived = new Promise(resolve => { bombDone = resolve; });
        const flight = {kind: 'jet', path: (k) => curve.getPointAt(Math.min(1, ease(k))), duration, mesh: jet, primary: !dropped, orient: true};
        const promise = this.fly(flight);
        const record = this.projectiles[this.projectiles.length - 1];
        record.onStep = (k, position, p) => {
            const u = ease(k);
            const ahead = curve.getPointAt(Math.min(1, u + .01));
            const behind = curve.getPointAt(Math.max(0, u - .01));
            const turn = ahead.clone().sub(position).normalize().cross(position.clone().sub(behind).normalize()).y;
            p.bank = THREE.MathUtils.clamp(-turn * 60, -1.1, 1.1);
            if (!dropped && u >= releaseU) {
                dropped = true;
                p.primary = false;
                const from = position.clone();
                const bomb = new THREE.Mesh(this.bombGeometry, this.bombMaterial);
                const fall = .75;
                T.audio.play('whistle', impact, fall);
                this.fly({kind: 'bomb', path: this.ballistic(from, impact, .15), duration: fall, mesh: bomb, primary: true}).then(bombDone);
            }
        };
        promise.then(() => jet.traverse(o => o.geometry?.dispose()));
        await bombArrived;
    }

    // ---------------------------------------------------------------------------------------------------
    // Sinking and celebration
    // ---------------------------------------------------------------------------------------------------

    async sinkSequence(ship, team) {
        const T = this.t;
        T.director.orbitLocked = true;
        T.director.sinkOrbit(ship.root.position, 3 + ship.length * .45);
        T.post.letterbox(1);
        T.slowMotion(.4, 1.1);
        const cells = [...ship.cellLocal.entries()];
        for (const [coord, local] of cells.sort(() => Math.random() - .5)) {
            const anchor = new THREE.Object3D();
            anchor.position.set(local.x, ship.surfaceAt(local.x, local.z * .5) + .01, local.z * .5);
            ship.attach(anchor);
            ship.root.updateMatrixWorld(true);
            const at = anchor.getWorldPosition(new THREE.Vector3());
            T.effects.explosion(at, .75 + Math.random() * .4, {sound: Math.random() < .5, kind: 'secondary', ship: ship.type});
            if (!ship.burningCells.has(coord)) {
                ship.burningCells.add(coord);
                ship.addBurn(local.x, local.z, .2 + ship.beam * .3);
                T.effects.addFire(anchor, .9 * (FIRE_BY_SHIP[ship.type] ?? 1));
            }
            await T.wait(.26);
        }
        ship.sink();
        for (const [x, y, z] of ship.wreckFireSpots()) {
            const anchor = new THREE.Object3D();
            anchor.position.set(x, y, z);
            ship.attach(anchor);
            T.effects.addFire(anchor, 1.25);
        }
        T.audio.play('creak', ship.root.position);
        T.ocean.addSlick(ship.root.position.x, ship.root.position.z, ship.length * .62);
        T.effects.flotsam.scatter(ship.root.position, ship.length * .45, 18 + Math.round(ship.length * 9));
        T.grid.markSunk(team, ship.cells);
        await T.wait(3.4);
        T.post.letterbox(0);
        T.director.orbitLocked = false;
    }

    async celebrate(team) {
        const T = this.t;
        const fleet = T.fleets[team];
        if (!fleet) return;
        T.director.victory(T.grid.center(team));
        const ships = [...fleet.ships.values()].filter(s => s.state === 'afloat');
        const ramps = team === 'gpt' ? [RAMP.FW_BLUE, RAMP.FW_WHITE, RAMP.FW_GOLD] : [RAMP.FW_ORANGE, RAMP.FW_GOLD, RAMP.FW_WHITE];
        ships.slice(0, 2).forEach((ship, i) => setTimeout(() => T.audio.play('horn', ship.root.position), i * 700));
        for (let i = 0; i < 9 && ships.length; i++) {
            const ship = ships[i % ships.length];
            const from = ship.root.position.clone().add(new THREE.Vector3((Math.random() - .5) * ship.length * .6, .3, (Math.random() - .5) * .2));
            const to = from.clone().add(new THREE.Vector3((Math.random() - .5) * 2.5, 3 + Math.random() * 2.2, (Math.random() - .5) * 2));
            this.fly({kind: 'rocket', path: this.ballistic(from, to, .4), duration: .95}).then(at => T.effects.firework(at, ramps[i % ramps.length], .9 + Math.random() * .4));
            await T.wait(.42 + Math.random() * .3);
        }
        await T.wait(1.5);
    }

    // Attract mode: the occasional ranging shot that falls short.
    async demoShot() {
        const T = this.t;
        const teams = ['gpt', 'claude'];
        const attacker = teams[Math.floor(Math.random() * 2)];
        const shooter = T.fleets[attacker]?.pickShooter();
        const enemy = T.fleets[other(attacker)];
        if (!shooter || !enemy) return;
        const occupied = new Set([...enemy.ships.values()].flatMap(s => s.cells));
        let coord;
        for (let i = 0; i < 30; i++) {
            coord = 'ABCDEFGHIJ'[Math.floor(Math.random() * 10)] + (1 + Math.floor(Math.random() * 10));
            if (!occupied.has(coord)) break;
        }
        const impact = T.grid.cellCenter(other(attacker), coord).add(new THREE.Vector3((Math.random() - .5) * .4, 0, (Math.random() - .5) * .4));
        const turret = shooter.turrets.length ? this.chooseTurret(shooter, impact) : null;
        if (!turret) return;
        T.scene.updateMatrixWorld();
        const plan = this.shellFlight(turret.yaw.getWorldPosition(new THREE.Vector3()), impact, 1);
        await this.train(shooter, turret, impact, plan.pitch);
        T.scene.updateMatrixWorld();
        const muzzle = turret.muzzles[Math.floor(turret.muzzles.length / 2)];
        const start = muzzle.getWorldPosition(new THREE.Vector3());
        T.effects.muzzle(start, new THREE.Vector3(1, 0, 0).transformDirection(muzzle.matrixWorld), turret.kind === 'main' ? 1.1 : .7);
        T.audio.play('cannon', start, .7);
        const {duration, height} = this.shellFlight(start, impact, 1);
        const at = await this.fly({kind: 'shell', path: this.ballistic(start, impact, height), duration});
        T.effects.splash(at, .85);
    }
}
