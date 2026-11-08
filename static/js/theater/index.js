import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { createEnvironment } from './environment.js';
import { Ocean, NO_REFLECTION_LAYER } from './ocean.js';
import { oceanNormalMap, foamTexture, grimeTexture, particleAtlas, vlsTexture, railTexture, flagTexture, hashString } from './textures.js';
import { Ship } from './ships.js';
import { sharedShipResources, flagMaterial } from './shipkit.js';
import { Effects, RAMP, FRAME } from './effects.js';
import { Battlefield, COLUMNS } from './grid.js';
import { Director } from './director.js';
import { Combat } from './combat.js';
import { BattleAudio } from './audio.js';
import { createSeaWall } from './wall.js';

// The naval theater: a golden-hour ocean where two AI fleets deploy and trade fire. game.js drives it
// through a small promise-based API (deploy, playShot, celebrate), and the DOM boards stay the accessible
// source of truth. Sky, sea, ships and fire are generated in code; battle audio uses local recordings.

export const TEAMS = {
    gpt: {id: 'gpt', name: 'GPT', color: '#3d8bff', paint: 0x838b92, superstructure: 0x939aa0, logo: '/static/img/logo-chatgpt.png'},
    claude: {id: 'claude', name: 'Claude', color: '#ff8552', paint: 0x88898a, superstructure: 0x979897, logo: '/static/img/logo-claude.png'},
};
const ORIGINS = {gpt: [-11.5, -5], claude: [1.5, -5]};
const SIZES = {Carrier: 5, Battleship: 4, Cruiser: 3, Submarine: 3, Destroyer: 2};
const other = (team) => (team === 'gpt' ? 'claude' : 'gpt');

const GradeShader = {
    uniforms: {tDiffuse: {value: null}, uTime: {value: 0}, uFlash: {value: 0}, uLetterbox: {value: 0}, uResolution: {value: new THREE.Vector2(1, 1)}},
    vertexShader: /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
    fragmentShader: /* glsl */`
        uniform sampler2D tDiffuse; uniform float uTime; uniform float uFlash; uniform float uLetterbox; uniform vec2 uResolution;
        varying vec2 vUv;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        void main() {
            vec2 c = vUv - .5;
            float r2 = dot(c, c);
            float ca = .0006 * r2 * 4.;
            vec3 color = vec3(texture2D(tDiffuse, vUv + c * ca).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - c * ca).b);
            // Gentle grade: warm highlights, cool shadows, a soft vignette and fine film grain.
            float luma = dot(color, vec3(.2126, .7152, .0722));
            color = mix(color * vec3(.96, .99, 1.04), color * vec3(1.04, 1., .95), smoothstep(.25, .8, luma));
            color = mix(vec3(luma), color, 1.06);
            color *= mix(1., smoothstep(1.05, .2, r2 * 2.1), .24);
            color += (hash(vUv * uResolution + fract(uTime * 7.13) * 91.7) - .5) * .016;
            color += vec3(1., .86, .72) * uFlash;
            float bars = uLetterbox * .085;
            color *= smoothstep(bars - .002, bars + .002, vUv.y) * smoothstep(bars - .002, bars + .002, 1. - vUv.y);
            gl_FragColor = vec4(color, 1.);
        }`,
};

class Fleet {
    constructor(team) {
        this.team = team;
        this.ships = new Map();
        this.last = null;
    }

    alive() {
        return [...this.ships.values()].filter(s => s.state === 'afloat' && !s.sail);
    }

    // A ship still afloat takes the shot, never the same one twice in a row when there is a choice.
    pickShooter() {
        const alive = this.alive();
        if (!alive.length) return null;
        const weights = {Battleship: 3, Cruiser: 2.2, Destroyer: 2.2, Submarine: 1.7, Carrier: 1.8};
        const pool = alive.length > 1 ? alive.filter(s => s !== this.last) : alive;
        let roll = Math.random() * pool.reduce((sum, s) => sum + weights[s.type], 0);
        let pick = pool[0];
        for (const ship of pool) {
            roll -= weights[ship.type];
            if (roll <= 0) { pick = ship; break; }
        }
        this.last = pick;
        return pick;
    }
}

export class Theater {
    constructor(container) {
        this.container = container;
        this.speed = 1;
        this.time = 0;
        this.realTime = 0;
        this.timers = [];
        this.tweens = [];
        this.slow = {factor: 1, until: 0};
        this.fleets = {gpt: null, claude: null};
        this.applied = {gpt: 0, claude: 0};
        this.colors = {gpt: TEAMS.gpt.color, claude: TEAMS.claude.color};
        this.attract = false;
        this.nextDemo = 4;
        this.busy = false;
        this.visible = true;
        this.quality = {ratio: Math.min(devicePixelRatio || 1, 1.5), max: Math.min(devicePixelRatio || 1, 2), slow: 0, fast: 0};

        const renderer = new THREE.WebGLRenderer({antialias: false, powerPreference: 'high-performance', stencil: false, failIfMajorPerformanceCaveat: true});
        const gl = renderer.getContext();
        const debug = gl.getExtension('WEBGL_debug_renderer_info');
        if (/swiftshader|llvmpipe|software/i.test(gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER))) {
            renderer.dispose();
            throw new Error('Software WebGL is too slow for the 3D theater.');
        }
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = .56;
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFShadowMap;
        renderer.setPixelRatio(this.quality.ratio);
        this.renderer = renderer;
        renderer.domElement.className = 'theater-canvas';
        renderer.domElement.setAttribute('aria-hidden', 'true');
        container.prepend(renderer.domElement);

        const scene = new THREE.Scene();
        this.scene = scene;
        const camera = new THREE.PerspectiveCamera(40, 16 / 9, .1, 9000);
        camera.layers.enable(NO_REFLECTION_LAYER);
        camera.position.set(0, 14, 18);
        this.camera = camera;

        this.env = createEnvironment(renderer, scene);
        this.textures = {
            normal: oceanNormalMap(renderer),
            foam: foamTexture(renderer),
            grime: grimeTexture(renderer),
            atlas: particleAtlas(renderer),
        };
        this.ocean = new Ocean(renderer, this.env, {normalMap: this.textures.normal, foamMap: this.textures.foam, grids: [ORIGINS.gpt, ORIGINS.claude], gridColors: [TEAMS.gpt.color, TEAMS.claude.color]});
        scene.add(this.ocean.mesh);
        const sunDisc = this.env.sky.material.uniforms.showSunDisc;
        this.ocean.beforeReflect = () => { sunDisc.value = 0; };
        this.ocean.afterReflect = () => { sunDisc.value = 1; };
        // The concrete sea wall between the fleets: neither side can see the other's ships.
        this.wall = createSeaWall(scene);
        this.shared = sharedShipResources(this.textures.grime);
        this.shipTextures = {
            vls: vlsTexture(),
            rail: railTexture(),
            flags: {
                gpt: flagMaterial(flagTexture(TEAMS.gpt.color, TEAMS.gpt.logo), this.shared),
                claude: flagMaterial(flagTexture(TEAMS.claude.color, TEAMS.claude.logo), this.shared),
            },
        };
        this.audio = new BattleAudio();
        this.audio.setCamera(camera);
        this.grid = new Battlefield(scene, this.ocean, {origins: ORIGINS, colors: this.colors, names: {gpt: TEAMS.gpt.name, claude: TEAMS.claude.name}});
        this.director = new Director(camera, renderer.domElement, {bounds: {center: new THREE.Vector3(0, 0, 0), width: 23.5, depth: 10.5}});
        this.effects = new Effects(scene, {
            atlas: this.textures.atlas, ocean: this.ocean, env: this.env,
            onShake: (at, strength) => this.director.addShake(at, strength),
            onSound: (kind, at, scale) => this.audio.play(kind, at, scale),
        });
        this.combat = new Combat(this);
        this.director.onModeChange = (mode) => this.onCameraModeChange?.(mode);

        // HDR pipeline: multisampled render, bloom on fire and sun glints, ACES, then the film grade.
        const size = renderer.getDrawingBufferSize(new THREE.Vector2());
        // Retina screens need less multisampling.
        const target = new THREE.WebGLRenderTarget(Math.max(1, size.x), Math.max(1, size.y), {type: THREE.HalfFloatType, samples: (devicePixelRatio || 1) >= 1.75 ? 2 : 4});
        this.composer = new EffectComposer(renderer, target);
        this.composer.addPass(new RenderPass(scene, camera));
        // Only fire, flashes and sun glints are bright enough to bloom; sunlit paint is not.
        this.bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), .32, .24, 3.2);
        this.composer.addPass(this.bloom);
        this.composer.addPass(new OutputPass());
        this.grade = new ShaderPass(GradeShader);
        this.composer.addPass(this.grade);
        this.post = {
            flashTarget: 0,
            letterboxTarget: 0,
            flash: (amount) => { this.grade.uniforms.uFlash.value = Math.max(this.grade.uniforms.uFlash.value, amount); },
            letterbox: (on) => { this.post.letterboxTarget = on ? 1 : 0; },
        };

        this.resizeObserver = new ResizeObserver(() => this.resize());
        this.resizeObserver.observe(container);
        this.intersection = new IntersectionObserver(([entry]) => { this.visible = entry.isIntersecting; });
        this.intersection.observe(container);
        this.resize();
        this.last = performance.now();
        this.frame = requestAnimationFrame(this.tick);
        document.addEventListener('visibilitychange', this.onVisibility);
    }

    // ---------------------------------------------------------------------------------------------------
    // Clock
    // ---------------------------------------------------------------------------------------------------

    wait(seconds) {
        return new Promise(resolve => this.timers.push({at: this.time + seconds, resolve}));
    }

    tween(duration, fn) {
        return new Promise(resolve => this.tweens.push({start: this.time, duration, fn, resolve}));
    }

    slowMotion(factor, seconds) {
        if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        this.slow = {factor, until: this.realTime + seconds};
    }

    onVisibility = () => {
        clearInterval(this.background);
        if (document.hidden) {
            // Keep the battle moving in a background tab, without drawing.
            this.background = setInterval(() => this.step(.25), 250);
        } else {
            this.last = performance.now();
        }
    };

    tick = (now) => {
        this.frame = requestAnimationFrame(this.tick);
        const realDt = Math.min(.1, Math.max(0, (now - this.last) / 1000));
        this.last = now;
        this.step(realDt);
        if (this.visible && this.container.clientWidth > 0) {
            this.render();
            this.adapt(realDt);
            this.onFrame?.();
        }
    };

    // Where a board's floating tag goes on screen: off whichever edge of the board sits lowest in the view, on the
    // water. unit is the size of one grid square there, in CSS pixels. Null when that edge is behind the camera.
    boardAnchor(team) {
        const center = this.grid.center(team);
        const width = this.container.clientWidth, height = this.container.clientHeight;
        let best = null;
        for (const [dx, dz] of [[0, 5.6], [0, -5.6], [5.6, 0], [-5.6, 0]]) {
            const point = this.projectPoint(center.x + dx, .05, center.z + dz, width, height);
            if (point && (!best || point.y > best.y)) best = {...point, dx, dz};
        }
        if (!best) return null;
        const along = this.projectPoint(center.x + best.dx + (best.dz ? 1 : 0), .05, center.z + best.dz + (best.dx ? 1 : 0), width, height);
        if (!along) return null;
        best.unit = Math.hypot(along.x - best.x, along.y - best.y);
        return best;
    }

    projectPoint(x, y, z, width, height) {
        const v = this.projected || (this.projected = new THREE.Vector3());
        v.set(x, y, z).applyMatrix4(this.camera.matrixWorldInverse);
        if (v.z > -.2) return null;
        v.applyMatrix4(this.camera.projectionMatrix);
        return {x: (v.x + 1) / 2 * width, y: (1 - v.y) / 2 * height};
    }

    step(realDt) {
        this.realTime += realDt;
        if (this.slow.factor < 1 && this.realTime > this.slow.until) this.slow.factor = Math.min(1, this.slow.factor + realDt * 1.5);
        const dt = Math.min(.25, realDt * this.speed * this.slow.factor);
        this.time += dt;
        const time = this.time;
        this.timers = this.timers.filter(timer => {
            if (time >= timer.at) { timer.resolve(); return false; }
            return true;
        });
        this.tweens = this.tweens.filter(tween => {
            const k = Math.min(1, (time - tween.start) / tween.duration);
            tween.fn(k);
            if (k >= 1) { tween.resolve(); return false; }
            return true;
        });
        this.env.update(time);
        this.ocean.update(time);
        this.wall.update(time, this.ocean);
        this.shared.time.value = time;
        const shipData = [];
        for (const fleet of Object.values(this.fleets)) {
            if (!fleet) continue;
            for (const ship of fleet.ships.values()) {
                ship.update(dt, time, this.ocean);
                // Sinking ships boil with escaping air; wrecks keep breathing out the odd bubble.
                const sinking = ship.state === 'sinking' ? Math.min(1, (ship.sinking?.t || 0) / 2) : ship.state === 'sunk' ? .6 : 0;
                if (sinking && Math.random() < dt * (ship.state === 'sunk' ? 1.5 : 20)) this.effects.bubbles(ship.root.position, ship.length * .35, 1);
                if (ship.sail && Math.random() < dt * 30) this.wake(ship);
                shipData.push({x: ship.root.position.x, z: ship.root.position.z, heading: ship.root.rotation.y, halfLength: ship.length / 2, halfBeam: ship.beam / 2, speed: Math.max(Math.min(1, ship.speed), ship.state === 'afloat' ? .34 : 0), foam: ship.type === 'Submarine' ? 1 : .4, sinking});
            }
        }
        this.ocean.setShips(shipData);
        this.scene.updateMatrixWorld();
        for (const fleet of Object.values(this.fleets)) {
            if (!fleet) continue;
            for (const ship of fleet.ships.values()) ship.uniforms.inverse.value.copy(ship.body.matrixWorld).invert();
        }
        this.combat.update(dt);
        // The camera moves first: particles face it and are sorted against it, so they must see where it is this
        // frame (a stale camera after a cut would show them edge-on as streaks).
        this.director.update(dt);
        this.camera.updateMatrixWorld();
        this.effects.update(dt, this.camera);
        this.grid.update(dt, time);
        const flash = this.grade.uniforms.uFlash;
        flash.value *= Math.exp(-realDt * 9);
        const box = this.grade.uniforms.uLetterbox;
        box.value += (this.post.letterboxTarget - box.value) * Math.min(1, realDt * 3);
        this.grade.uniforms.uTime.value = this.realTime;
        if (this.attract && !this.busy) {
            this.nextDemo -= dt;
            if (this.nextDemo <= 0) {
                this.nextDemo = 5 + Math.random() * 4;
                this.combat.demoShot();
            }
        }
    }

    wake(ship) {
        const heading = ship.root.rotation.y;
        const bow = new THREE.Vector3(Math.cos(heading), 0, -Math.sin(heading));
        const at = ship.root.position.clone().addScaledVector(bow, ship.length * .48);
        const side = new THREE.Vector3(-bow.z, 0, bow.x);
        for (const s of [-1, 1]) {
            this.effects.spawn({x: at.x + side.x * s * .05, y: .02, z: at.z + side.z * s * .05, vx: side.x * s * .5, vy: .35 + Math.random() * .3, vz: side.z * s * .5, ramp: RAMP.SPRAY, frame: FRAME.SPRAY, size: .06 + Math.random() * .05, life: .6, drag: 1, lift: -3, collide: true});
        }
    }

    render() {
        // Ships move slowly: refreshing the sun's shadow map every other frame is plenty.
        this.frameCount = (this.frameCount || 0) + 1;
        this.renderer.shadowMap.autoUpdate = false;
        this.renderer.shadowMap.needsUpdate = this.frameCount % 2 === 0;
        this.composer.render();
    }

    // Lower the resolution if frames run long, raise it again when there is headroom.
    adapt(realDt) {
        const q = this.quality;
        if (realDt > 1 / 42) q.slow += realDt; else q.slow = Math.max(0, q.slow - realDt * .5);
        if (realDt < 1 / 75) q.fast += realDt; else q.fast = 0;
        if (q.slow > 1.2 && q.ratio > 1) {
            q.ratio = Math.max(1, q.ratio - .25);
            q.slow = 0;
            this.resize();
        } else if (q.fast > 6 && q.ratio < q.max) {
            q.ratio = Math.min(q.max, q.ratio + .25);
            q.fast = 0;
            this.resize();
        }
    }

    // The part of the screen not covered by the HUD, in CSS pixels from each edge.
    setSafeArea(insets) {
        this.safe = {top: 0, right: 0, bottom: 0, left: 0, ...insets};
        this.resize();
    }

    resize() {
        const width = Math.max(1, this.container.clientWidth), height = Math.max(1, this.container.clientHeight);
        const ratio = this.quality.ratio;
        const {top, right, bottom, left} = this.safe || {top: 0, right: 0, bottom: 0, left: 0};
        const safeWidth = Math.max(120, width - left - right), safeHeight = Math.max(120, height - top - bottom);
        // Shift the frustum so the middle of the free area is the middle of the view.
        this.camera.setViewOffset(width, height, -(left - right) / 2, -(top - bottom) / 2, width, height);
        this.director.setFrame({aspect: safeWidth / safeHeight, heightRatio: safeHeight / height});
        this.renderer.setPixelRatio(ratio);
        this.renderer.setSize(width, height, false);
        this.composer.setPixelRatio(ratio);
        this.composer.setSize(width, height);
        this.bloom.resolution.set(width * ratio / 2, height * ratio / 2);
        this.ocean.setSize(width * ratio, height * ratio);
        this.grade.uniforms.uResolution.value.set(width * ratio, height * ratio);
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.director.setAspect(width / height);
    }

    // ---------------------------------------------------------------------------------------------------
    // Fleets
    // ---------------------------------------------------------------------------------------------------

    removeFleet(team) {
        const fleet = this.fleets[team];
        if (!fleet) return;
        for (const ship of fleet.ships.values()) {
            this.scene.remove(ship.root);
            ship.dispose();
        }
        this.fleets[team] = null;
    }

    // Put a fleet on its grid. With animate, every ship sails in from beyond the grid edge.
    async deploy(team, fleetData, {animate = true} = {}) {
        this.removeFleet(team);
        const fleet = new Fleet(team);
        this.fleets[team] = fleet;
        const occupied = new Set(fleetData.flatMap(s => s.cells));
        let longest = 0;
        fleetData.forEach((data, index) => {
            const ship = new Ship(data.name, TEAMS[team], this.shared, this.shipTextures);
            ship.cells = [...data.cells];
            const centers = data.cells.map(c => this.grid.cellCenter(team, c));
            const center = centers.reduce((sum, c) => sum.add(c), new THREE.Vector3()).divideScalar(centers.length);
            const heading = this.chooseHeading(team, data, occupied);
            ship.setPlacement(center, heading);
            const cos = Math.cos(heading), sin = Math.sin(heading);
            data.cells.forEach((coord, i) => {
                const d = centers[i].clone().sub(center);
                ship.cellLocal.set(coord, {x: d.x * cos - d.z * sin, z: d.x * sin + d.z * cos});
            });
            this.scene.add(ship.root);
            fleet.ships.set(data.name, ship);
            if (animate) {
                const bow = new THREE.Vector3(cos, 0, -sin);
                const distance = 6.5 + Math.random() * 2;
                const from = center.clone().addScaledVector(bow, -distance);
                // Never start inside the other fleet's waters.
                if (team === 'gpt') from.x = Math.min(from.x, .4); else from.x = Math.max(from.x, -.4);
                const duration = 2.6 + from.distanceTo(center) * .16;
                const delay = index * .3;
                ship.sailIn(from, duration, delay);
                longest = Math.max(longest, duration + delay);
            }
        });
        if (animate) {
            if (this.director.mode === 'cinematic') this.director.beginShot({shooter: this.grid.center(team).add(new THREE.Vector3(team === 'gpt' ? -6 : 6, 0, 6)), target: this.grid.center(team), close: false});
            await this.wait(longest + .2);
            this.director.endShot(.4);
        }
    }

    chooseHeading(team, data, occupied) {
        const [cols, rows] = [data.cells.map(c => COLUMNS.indexOf(c[0])), data.cells.map(c => Number(c.slice(1)) - 1)];
        const horizontal = data.direction === 'H';
        const own = new Set(data.cells);
        const lane = (from, to, fixed) => {
            let conflicts = 0;
            for (let i = Math.min(from, to); i <= Math.max(from, to); i++) {
                const coord = horizontal ? COLUMNS[i] + (fixed + 1) : COLUMNS[fixed] + (i + 1);
                if (occupied.has(coord) && !own.has(coord)) conflicts++;
            }
            return conflicts;
        };
        const seed = hashString(team + data.name + data.start) % 2;
        if (horizontal) {
            const row = rows[0], min = Math.min(...cols), max = Math.max(...cols);
            const options = [
                {heading: 0, conflicts: min > 0 ? lane(0, min - 1, row) : 0, preferred: team === 'gpt'},
                {heading: Math.PI, conflicts: max < 9 ? lane(max + 1, 9, row) : 0, preferred: team === 'claude'},
            ];
            options.sort((a, b) => a.conflicts - b.conflicts || (b.preferred - a.preferred));
            return options[0].heading;
        }
        const col = cols[0], min = Math.min(...rows), max = Math.max(...rows);
        const options = [
            {heading: -Math.PI / 2, conflicts: min > 0 ? lane(0, min - 1, col) : 0, preferred: seed === 0},
            {heading: Math.PI / 2, conflicts: max < 9 ? lane(max + 1, 9, col) : 0, preferred: seed === 1},
        ];
        options.sort((a, b) => a.conflicts - b.conflicts || (b.preferred - a.preferred));
        return options[0].heading;
    }

    // Catch the scene up with a saved game: fleets, splashes, fires and wrecks, without animation.
    async syncState(state) {
        for (const team of ['gpt', 'claude']) {
            const fleet = state.players?.[team]?.fleet || [];
            if (fleet.length && !this.fleets[team]) await this.deploy(team, fleet, {animate: false});
        }
        for (const attacker of ['gpt', 'claude']) {
            const defender = other(attacker);
            const shots = state.players?.[attacker]?.shots || [];
            const sunk = new Set(state.players?.[defender]?.sunk || []);
            for (const shot of shots.slice(this.applied[attacker])) {
                if (shot.result === 'miss') {
                    this.grid.markMiss(defender, shot.target, {instant: true});
                    continue;
                }
                this.grid.markHit(defender, shot.target);
                const ship = this.fleets[defender]?.ships.get(shot.ship);
                if (!ship) continue;
                const local = ship.localForCell(shot.target);
                const anchor = new THREE.Object3D();
                anchor.position.set(local.x, ship.surfaceAt(local.x, local.z) + .008, local.z);
                ship.attach(anchor);
                ship.addBurn(local.x, local.z, .16 + ship.beam * .3);
                ship.burningCells.add(shot.target);
                this.effects.addFire(anchor, 1);
            }
            this.applied[attacker] = shots.length;
            for (const name of sunk) {
                const ship = this.fleets[defender]?.ships.get(name);
                if (!ship || ship.state === 'sunk') continue;
                ship.settle();
                for (const [x, y, z] of ship.wreckFireSpots()) {
                    const anchor = new THREE.Object3D();
                    anchor.position.set(x, y, z);
                    ship.attach(anchor);
                    this.effects.addFire(anchor, 1.25);
                }
                this.grid.markSunk(defender, ship.cells);
                this.ocean.addSlick(ship.root.position.x, ship.root.position.z, ship.length * .6);
                this.effects.flotsam.scatter(ship.root.position, ship.length * .45, 14 + Math.round(ship.length * 6));
            }
        }
        const last = state.last_shot;
        if (last) this.grid.markLast(other(last.player), last.target);
    }

    async playShot(shot, options) {
        this.busy = true;
        try {
            await this.combat.playShot(shot, options);
        } finally {
            this.applied[shot.player] += 1;
            this.busy = false;
        }
    }

    async celebrate(team) {
        await this.combat.celebrate(team);
    }

    // The setup page: both fleets at anchor, the camera circling, the odd ranging shot.
    async setAttract(on) {
        this.attract = on;
        this.director.setAttract(on);
        if (on && !this.fleets.gpt && !this.fleets.claude) {
            for (const team of ['gpt', 'claude']) await this.deploy(team, randomFleet(), {animate: false});
        }
        this.nextDemo = 3.5;
    }

    // The banners on the water name the models in play.
    setNames(names) {
        this.grid?.setNames(names);
    }

    reset() {
        this.attract = false;
        this.director.setAttract(false);
        this.combat.clear();
        this.effects.clear();
        this.grid.clear();
        for (const team of ['gpt', 'claude']) this.removeFleet(team);
        this.applied = {gpt: 0, claude: 0};
        this.timers.forEach(t => t.resolve());
        this.timers = [];
        this.tweens.forEach(t => t.resolve());
        this.tweens = [];
        this.post.letterbox(false);
        this.director.orbitLocked = false;
        this.director.orbit = null;
        this.director.shot = null;
        this.director.frameOverview(false);
    }

    setCameraMode(mode) {
        this.director.setMode(mode);
    }

    setSpeed(speed) {
        this.speed = speed;
    }

    setMuted(muted) {
        this.audio.setMuted(muted);
    }

    unlockAudio() {
        this.audio.unlock();
    }
}

// A legal random layout, used for the setup page's demo fleets.
function randomFleet() {
    const taken = new Set();
    const fleet = [];
    for (const [name, size] of Object.entries(SIZES)) {
        for (let attempt = 0; attempt < 500; attempt++) {
            const direction = Math.random() < .5 ? 'H' : 'V';
            const col = Math.floor(Math.random() * (direction === 'H' ? 11 - size : 10));
            const row = Math.floor(Math.random() * (direction === 'V' ? 11 - size : 10));
            const cells = Array.from({length: size}, (_, i) => COLUMNS[direction === 'H' ? col + i : col] + ((direction === 'V' ? row + i : row) + 1));
            const halo = cells.flatMap(c => {
                const ci = COLUMNS.indexOf(c[0]), ri = Number(c.slice(1)) - 1;
                const near = [];
                for (let dc = -1; dc <= 1; dc++) for (let dr = -1; dr <= 1; dr++) if (COLUMNS[ci + dc] && ri + dr >= 0 && ri + dr < 10) near.push(COLUMNS[ci + dc] + (ri + dr + 1));
                return near;
            });
            if (halo.some(c => taken.has(c))) continue;
            cells.forEach(c => taken.add(c));
            fleet.push({name, size, start: cells[0], direction, cells});
            break;
        }
    }
    return fleet;
}

export async function createTheater(container) {
    return new Theater(container);
}
