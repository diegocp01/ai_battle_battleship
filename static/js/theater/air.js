import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { FIGHTERS, fighterDecals } from './ships.js';
import { place, box, cyl } from './shipkit.js';

// Life in the air: a Black Hawk helicopter flying a lazy circuit round each fleet, rotors turning, and now and then
// a flight of the fleet's fighters: a V of three or five low over a board (often straight down its length, parallel
// to the barrier) or across both boards above the barrier, or a pair on combat air patrol high over the battle.
// Sizes are real (75 m squares): the helicopter is 19.8 m long, at about 45 m up; the jets 18 m long.
//  - They fly real paths: smooth curves at a steady speed, each jet pointing along its path and banked so its lift
//    carries both its weight and the turn (a coordinated turn), climbing out at the end of a low pass.
//  - The engines: twin plumes at the nozzles, short and dim at cruise, long and white-hot with shock diamonds on
//    afterburner (a pass flown on the burners, or the pull-up out of a low one); a positional engine roar whose
//    pitch shifts as they pass (Doppler).
//  - On some passes (most of the high ones, where it is cold enough) each engine leaves a vapor trail along the
//    exact path flown, spreading and drifting downwind as it fades, so you can see where a flight went.
const GRAY = 0x8a9198;
// Battle-time gravity for the flight paths' bank (the theater runs faster than life).
const FLIGHT_GRAVITY = 1.4;
// Speed of sound in squares per battle second, for the Doppler shift of the engine roar.
const SOUND_SPEED = 4.6;

// Afterburner plume: hot near the nozzle, cooling to orange at the tip; on the burners, bright shock diamonds.
const plumeVertex = /* glsl */`
varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vView;
void main() {
    vUv = uv;
    vec4 world = modelMatrix * vec4(position, 1.);
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vView = normalize(cameraPosition - world.xyz);
    gl_Position = projectionMatrix * viewMatrix * world;
}`;
const plumeFragment = /* glsl */`
uniform float uThrottle, uTime, uSeed;
varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vView;
void main() {
    float t = vUv.y;
    float edge = pow(abs(dot(normalize(vNormalW), vView)), 1.3);
    float burner = smoothstep(.72, .95, uThrottle);
    float flicker = .82 + .18 * sin(uTime * 61. + uSeed) * sin(uTime * 37. + t * 9. + uSeed);
    float body = (1. - t) * (1. - t);
    float diamonds = burner * pow(.5 + .5 * cos(t * 6.2832 * 4.5), 10.) * (1. - t * .8);
    vec3 hot = mix(vec3(1., .86, .62), vec3(1., .42, .1), smoothstep(.04, .65, t));
    hot = mix(hot, vec3(.8, .85, 1.), burner * .3 * (1. - t));
    float glow = (.25 + 2.8 * burner) * uThrottle * flicker;
    float alpha = edge * (body + diamonds);
    gl_FragColor = vec4(hot * (body * glow + diamonds * 3.2) * alpha, 1.);
}`;

// Across a vapor trail: opaque in the middle, soft at both edges.
const TRAIL_ALPHA = (() => {
    const data = new Uint8Array(4 * 32);
    for (let i = 0; i < 32; i++) {
        const a = Math.round(255 * Math.pow(Math.sin(Math.PI * i / 31), 1.3));
        data.set([a, a, a, 255], i * 4);
    }
    const texture = new THREE.DataTexture(data, 1, 32);
    texture.magFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    return texture;
})();
const TRAIL_MATERIAL = new THREE.MeshBasicMaterial({color: 0xe8edf3, vertexColors: true, transparent: true, depthWrite: false, alphaMap: TRAIL_ALPHA, side: THREE.DoubleSide});

// One engine's vapor trail: a ribbon through the points it passed, facing the camera, thin at the engine and
// spreading as it ages, drifting downwind and fading out.
class Trail {
    constructor(scene, {width = .01, spread = .1, life = 11, opacity = .5, max = 280} = {}) {
        Object.assign(this, {scene, width, spread, life, opacity, max});
        this.points = [];
        this.position = new Float32Array(max * 6);
        this.color = new Float32Array(max * 8);
        const uv = new Float32Array(max * 4), index = [];
        for (let i = 0; i < max; i++) uv.set([i / max, 0, i / max, 1], i * 4);
        for (let i = 0; i < max - 1; i++) index.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
        const geometry = new THREE.BufferGeometry();
        geometry.setIndex(index);
        geometry.setAttribute('position', new THREE.BufferAttribute(this.position, 3).setUsage(THREE.DynamicDrawUsage));
        geometry.setAttribute('color', new THREE.BufferAttribute(this.color, 4).setUsage(THREE.DynamicDrawUsage));
        geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
        geometry.setDrawRange(0, 0);
        this.mesh = new THREE.Mesh(geometry, TRAIL_MATERIAL);
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = 4;
        scene.add(this.mesh);
        this.ended = false;
    }

    add(at, time) {
        const last = this.points.at(-1);
        if (last && last.p.distanceToSquared(at) < .012) return;
        this.points.push({p: at.clone(), t: time});
        if (this.points.length > this.max) this.points.shift();
    }

    update(time, dt, camera, wind) {
        while (this.points.length && time - this.points[0].t > this.life) this.points.shift();
        const n = this.points.length;
        const tangent = new THREE.Vector3(), toCamera = new THREE.Vector3(), side = new THREE.Vector3();
        for (let i = 0; i < n; i++) {
            const point = this.points[i];
            const age = time - point.t;
            // The trail drifts downwind and sinks a little as it spreads.
            point.p.addScaledVector(wind, dt);
            point.p.y -= .004 * dt;
            tangent.subVectors(this.points[Math.min(n - 1, i + 1)].p, this.points[Math.max(0, i - 1)].p);
            toCamera.subVectors(camera.position, point.p);
            side.crossVectors(tangent, toCamera).normalize().multiplyScalar((this.width + this.spread * Math.sqrt(age / this.life)) * .5);
            this.position.set([point.p.x + side.x, point.p.y + side.y, point.p.z + side.z, point.p.x - side.x, point.p.y - side.y, point.p.z - side.z], i * 6);
            // It condenses a little behind the engine, and thins out as it spreads.
            const alpha = this.opacity * THREE.MathUtils.smoothstep(age, .05, .5) * Math.pow(Math.max(0, 1 - age / this.life), 1.4) / (1 + age * .06);
            this.color.set([1, 1, 1, alpha, 1, 1, 1, alpha], i * 8);
        }
        const geometry = this.mesh.geometry;
        geometry.attributes.position.needsUpdate = true;
        geometry.attributes.color.needsUpdate = true;
        geometry.setDrawRange(0, Math.max(0, n - 1) * 6);
    }

    get done() {
        return this.ended && !this.points.length;
    }

    dispose() {
        this.scene.remove(this.mesh);
        this.mesh.geometry.dispose();
    }
}

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
        // The plumes at the nozzles of the fighter model (scale 1.15): two engines, 1.1 m across.
        this.nozzles = [-1, 1].map(side => new THREE.Vector3(-.124 * 1.15, .0012 * 1.15, side * .0082 * 1.15));
        this.plumeGeometry = new THREE.CylinderGeometry(.0006, .0056 * 1.15, 1, 14, 1, true).translate(0, .5, 0).rotateZ(Math.PI / 2);
        this.flights = [];
        this.trails = [];
        this.clock = 0;
        this.nextFlight = 10 + Math.random() * 12;
        this.wind = new THREE.Vector3(.03, 0, .015);
    }

    clear() {
        for (const flight of this.flights) this.endFlight(flight);
        for (const trail of this.trails) trail.dispose();
        this.flights = [];
        this.trails = [];
        this.nextFlight = 15;
    }

    endFlight(flight) {
        for (const jet of flight.jets) this.scene.remove(jet.group);
        for (const jet of flight.jets) for (const plume of jet.plumes) plume.material.dispose();
        for (const jet of flight.jets) for (const trail of jet.trails) trail.ended = true;
        flight.engine?.stop();
    }

    // A fighter of the team's, with its two plumes and (when the pass leaves them) two vapor trails.
    makeJet(team, trails, high) {
        const group = new THREE.Group();
        for (const part of this.jetParts[team]) group.add(new THREE.Mesh(part.geometry, part.material));
        group.traverse(o => { if (o.isMesh) o.castShadow = true; });
        const plumes = this.nozzles.map(nozzle => {
            const material = new THREE.ShaderMaterial({
                vertexShader: plumeVertex, fragmentShader: plumeFragment, transparent: true, depthWrite: false,
                blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
                uniforms: {uThrottle: {value: .5}, uTime: {value: 0}, uSeed: {value: Math.random() * 20}},
            });
            const plume = new THREE.Mesh(this.plumeGeometry, material);
            plume.position.copy(nozzle);
            plume.renderOrder = 6;
            group.add(plume);
            return plume;
        });
        this.scene.add(group);
        const made = trails ? this.nozzles.map(() => new Trail(this.scene, high ? {width: .012, spread: .16, life: 14, opacity: .55} : {width: .01, spread: .09, life: 9, opacity: .42})) : [];
        this.trails.push(...made);
        return {group, plumes, trails: made, jitter: Math.random() * 10};
    }

    // A flight of the fleet's fighters. Kinds: a V low down one board, parallel to the barrier; a V across both
    // boards above the barrier; a pair high over the battle. options can set {team, trails, burner, count}.
    launchFlight(kind, options = {}) {
        const r = Math.random;
        kind = kind || (r() < .45 ? 'along' : r() < .55 ? 'across' : 'patrol');
        const team = options.team || (r() < .5 ? 'gpt' : 'claude');
        const center = this.t.grid.center(team);
        const toward = r() < .5 ? 1 : -1;
        let points, speed, count, trails, burner;
        if (kind === 'along') {
            // Down the length of a board at 140–200 m, weaving gently, pulling up as it leaves.
            const x = center.x + (r() - .5) * 4, h = 1.9 + r() * .8;
            points = [[x + (r() - .5) * 6, h + .5, -70], [x + (r() - .5) * 3, h, -24], [x + (r() - .5) * 1.5, h, -4], [x + (r() - .5) * 2.5, h + .1, 12], [x + (r() - .5) * 6, h + 2.6, 40]]
                .map(([px, py, pz]) => new THREE.Vector3(px, py, pz * toward));
            speed = 3;
            count = r() < .5 ? 3 : 5;
            trails = r() < .45;
            burner = r() < .3;
        } else if (kind === 'across') {
            // Across both boards above the barrier (about 215 m), 270–330 m up, in a gentle arc.
            const z = (r() - .5) * 8, h = 3.6 + r() * .8, bend = (r() - .5) * 10;
            points = [[-48, h + .4, z + bend], [-16, h, z + bend * .3], [0, h, z], [16, h, z - bend * .3], [48, h + .8, z - bend]]
                .map(([px, py, pz]) => new THREE.Vector3(px * toward, py, pz));
            speed = 3.2;
            count = r() < .6 ? 3 : 5;
            trails = r() < .5;
            burner = r() < .2;
        } else {
            // Combat air patrol: a pair high over one fleet, 320–400 m, where the air is cold enough for contrails.
            const x = center.x + (r() - .5) * 6, h = 4.3 + r();
            points = [[x, h, -36], [x + (r() - .5) * 4, h + .2, 0], [x + (r() - .5) * 8, h + .4, 36]]
                .map(([px, py, pz]) => new THREE.Vector3(px, py, pz * toward));
            speed = 3.4;
            count = 2;
            trails = r() < .7;
            burner = false;
        }
        ({count = count, trails = trails, burner = burner} = options);
        const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
        const length = curve.getLength();
        const jets = Array.from({length: count}, () => this.makeJet(team, trails, kind !== 'along'));
        const flight = {kind, team, curve, length, speed, jets, burner, d: 0};
        flight.engine = this.t.audio?.startLoop('jetEngine', points[0], {level: 0}) || null;
        this.flights.push(flight);
        return flight;
    }

    // Where the lead is along its path and how it is flying: position, velocity and its axes (nose, up, right),
    // banked so that its lift carries its weight and the turn.
    pose(flight, d) {
        const u = THREE.MathUtils.clamp(d / flight.length, 0, 1), du = Math.min(.02, 4 / flight.length);
        const at = flight.curve.getPointAt(u);
        const nose = flight.curve.getTangentAt(u).normalize();
        const ahead = flight.curve.getTangentAt(Math.min(1, u + du)), behind = flight.curve.getTangentAt(Math.max(0, u - du));
        // Acceleration of the turn: speed² × the change of direction per unit length.
        const turn = ahead.sub(behind).divideScalar(Math.max(1e-4, (Math.min(1, u + du) - Math.max(0, u - du)) * flight.length)).multiplyScalar(flight.speed * flight.speed);
        const lift = turn.add(new THREE.Vector3(0, FLIGHT_GRAVITY, 0));
        const up = lift.addScaledVector(nose, -lift.dot(nose)).normalize();
        const right = new THREE.Vector3().crossVectors(nose, up);
        // Climb rate: the engines work hardest pulling up.
        const climb = nose.y;
        return {at, nose, up, right, climb};
    }

    flyFlight(flight, dt) {
        flight.d += flight.speed * dt;
        if (flight.d >= flight.length) return false;
        const lead = this.pose(flight, flight.d);
        const basis = new THREE.Matrix4().makeBasis(lead.nose, lead.up, lead.right);
        const quaternion = new THREE.Quaternion().setFromRotationMatrix(basis);
        // Throttle: cruise on a pass, more power climbing, the burners on a burner pass or a hard pull-up.
        const throttle = flight.burner ? 1 : THREE.MathUtils.clamp(.45 + lead.climb * 3.5, .4, 1);
        const camera = this.t.camera;
        flight.jets.forEach((jet, i) => {
            // The V: each pair of wingmen further back and out, stepped down a little; each holds station with a
            // small drift of its own.
            const row = Math.ceil(i / 2), side = i % 2 ? 1 : -1;
            const drift = Math.sin(this.clock * .9 + jet.jitter) * .012, bob = Math.sin(this.clock * 1.3 + jet.jitter * 2) * .008;
            const offset = new THREE.Vector3()
                .addScaledVector(lead.nose, -row * .3)
                .addScaledVector(lead.right, i ? side * (row * .27 + drift) : 0)
                .addScaledVector(lead.up, -row * .03 + (i ? bob : 0));
            jet.group.position.copy(lead.at).add(offset);
            jet.group.quaternion.copy(quaternion);
            jet.group.updateMatrixWorld();
            for (const plume of jet.plumes) {
                const u = plume.material.uniforms;
                u.uThrottle.value += (throttle - u.uThrottle.value) * Math.min(1, dt * 2);
                u.uTime.value = this.clock;
                plume.scale.x = (.025 + .1 * u.uThrottle.value * u.uThrottle.value) * 1.15;
            }
            jet.trails.forEach((trail, k) => trail.add(jet.group.localToWorld(this.nozzles[k].clone().add(new THREE.Vector3(-.03, 0, 0))), this.clock));
        });
        // The roar, Doppler-shifted by how fast the lead closes on the camera.
        if (flight.engine && camera) {
            const velocity = lead.nose.clone().multiplyScalar(flight.speed);
            const closing = velocity.dot(camera.position.clone().sub(lead.at).normalize());
            const doppler = THREE.MathUtils.clamp(1 / (1 - closing / SOUND_SPEED), .55, 1.9);
            flight.engine.update(lead.at, {level: (.55 + .45 * throttle) * Math.min(1, flight.jets.length / 3 + .4), rate: .82 * doppler, cutoff: 2600 + 3400 * throttle});
        }
        return true;
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
        this.clock += dt;
        this.nextFlight -= dt;
        if (this.nextFlight <= 0 && !this.t.attract) {
            this.launchFlight();
            this.nextFlight = 28 + Math.random() * 22;
        }
        this.flights = this.flights.filter(flight => {
            if (this.flyFlight(flight, dt)) return true;
            this.endFlight(flight);
            return false;
        });
        const camera = this.t.camera;
        this.trails = this.trails.filter(trail => {
            if (camera) trail.update(this.clock, dt, camera, this.wind);
            if (!trail.done) return true;
            trail.dispose();
            return false;
        });
    }
}
