import * as THREE from 'three';

// The people and the instruments of a carrier launch, for the strike's cinematic shots.
//  - Deck crew in jerseys and cranials, holding lighted wands in both hands: a director ahead of the jet running
//    the spool-up (wands circling overhead) and the catapult officer (the "shooter") beside the nose, who drops
//    to one knee, touches the deck and points down the track to launch.
//  - The pilot's head-up display: green symbology on the combiner glass in front of the pilot's eyes (pitch
//    ladder, flight path marker, heading tape, airspeed and altitude), redrawn from the jet's real attitude.
// Sizes are in the carrier's own units (a person about 1.8 m tall) and the jet's.

const SKIN = new THREE.MeshStandardMaterial({color: 0xb07a58, roughness: .7});
const BOOTS = new THREE.MeshStandardMaterial({color: 0x1b1b1c, roughness: .8});
const REFLECTIVE = new THREE.MeshStandardMaterial({color: 0xd5d8cc, roughness: .65});
const TROUSERS = new THREE.MeshStandardMaterial({color: 0x3c4148, roughness: .85});
// The lit wands: brighter than white, so they bloom like the real thing.
const WAND = new THREE.MeshBasicMaterial({color: new THREE.Color(5, 2.1, .35), toneMapped: false});

function capsule(radius, length, material) {
    return new THREE.Mesh(new THREE.CapsuleGeometry(radius, length, 3, 8), material);
}

// One crew member, facing +x, feet at the origin. jersey: their job's color.
export function deckCrew(jersey, helmet, {wands = true} = {}) {
    const group = new THREE.Group();
    const mesh = (name, geometry, material, position, scale = [1, 1, 1]) => {
        const part = new THREE.Mesh(geometry, material);
        part.name = name;
        part.position.set(...position);
        part.scale.set(...scale);
        group.add(part);
        return part;
    };
    // Separate legs and a narrower waist give a human silhouette rather than a single pill.
    for (const side of [-1, 1]) {
        mesh('trouser-leg', new THREE.CapsuleGeometry(.00125, .0066, 3, 8), TROUSERS,
            [0, .0056, side * .00165]);
        mesh('boot', new THREE.BoxGeometry(.0035, .0015, .0022), BOOTS,
            [.00065, .00075, side * .00165]);
    }
    mesh('hips', new THREE.SphereGeometry(.0026, 10, 8), TROUSERS, [0, .010, 0], [.72, .65, 1.12]);
    const torso = mesh('jersey', new THREE.SphereGeometry(.003, 12, 10), jersey,
        [0, .0143, 0], [.72, 1.32, 1.18]);
    for (const side of [-1, 1]) {
        mesh('shoulder-cap', new THREE.SphereGeometry(.00165, 10, 8), jersey,
            [0, .0175, side * .0029], [.85, 1, 1]);
    }
    mesh('belt', new THREE.BoxGeometry(.0039, .0007, .0056), BOOTS, [0, .0108, 0]);
    // Float-coat straps and reflective patches follow the front (+x) and back of the jersey.
    for (const side of [-1, 1]) {
        mesh('vest-strap', new THREE.BoxGeometry(.00035, .005, .00055), BOOTS,
            [.00205, .0147, side * .0017]);
        mesh('reflector', new THREE.BoxGeometry(.0003, .0006, .0011), REFLECTIVE,
            [.0023, .0162, side * .0017]);
    }
    mesh('back-reflector', new THREE.BoxGeometry(.0003, .0006, .004), REFLECTIVE, [-.0021, .0155, 0]);
    mesh('neck', new THREE.CylinderGeometry(.0008, .001, .0017, 8), SKIN, [0, .0188, 0]);
    mesh('head', new THREE.SphereGeometry(.0019, 12, 10), SKIN,
        [.0001, .021, 0], [.9, 1.22, .88]);
    mesh('nose', new THREE.SphereGeometry(.0005, 8, 6), SKIN, [.0018, .021, 0], [1, .8, .7]);
    mesh('goggles', new THREE.SphereGeometry(.001, 10, 6), BOOTS,
        [.00155, .02165, 0], [.45, .5, 1.55]);
    mesh('cranial', new THREE.SphereGeometry(.00205, 12, 8, 0, Math.PI * 2, 0, Math.PI * .52), helmet,
        [0, .02145, 0], [1, 1, .95]);
    for (const side of [-1, 1]) {
        mesh('ear-defender', new THREE.SphereGeometry(.0009, 8, 6), BOOTS,
            [0, .0213, side * .00185], [1, 1.25, .5]);
        mesh('chin-strap', new THREE.BoxGeometry(.0004, .0019, .0003), BOOTS,
            [.00035, .0199, side * .00135]);
    }
    const arms = [-1, 1].map(side => {
        const shoulder = new THREE.Group();
        // Keep the animation's shoulder pivots, hand position and wand tips unchanged.
        shoulder.position.set(0, .0182, side * .0042);
        const sleeve = capsule(.0012, .0025, jersey);
        sleeve.position.y = -.002;
        shoulder.add(sleeve);
        const forearm = capsule(.00085, .0028, SKIN);
        forearm.position.set(.00015, -.006, 0);
        shoulder.add(forearm);
        const hand = new THREE.Mesh(new THREE.SphereGeometry(.00095, 8, 6), SKIN);
        hand.position.y = -.0092;
        shoulder.add(hand);
        if (wands) {
            const wand = new THREE.Mesh(new THREE.CylinderGeometry(.0007, .0007, .0068, 6), WAND);
            wand.position.y = -.0128;
            shoulder.add(wand);
        }
        const tip = new THREE.Object3D();
        tip.position.y = -.016;
        shoulder.add(tip);
        group.add(shoulder);
        return {shoulder, tip};
    });
    group.traverse(o => { if (o.isMesh && o.material !== WAND) o.castShadow = true; });
    return {group, arms, torso};
}

// Reuse the close-up model for the carrier's static crew. Geometry is still merged into the hull's
// material buckets, so a detailed person does not add a draw call for every body part.
export function carrierSailor(b, x, y, z, material) {
    const crew = deckCrew(b.materials[material], b.materials[material], {wands: false});
    // Coordinate-derived variation never consumes the procedural ship generator's random stream.
    const variation = Math.abs(Math.sin(x * 127.1 + z * 311.7));
    crew.group.rotation.y = variation * Math.PI * 2;
    setArm(crew.arms[0], .12 + variation * .4, .08, -1);
    setArm(crew.arms[1], .2 + (1 - variation) * .6, .1, 1);
    crew.group.updateMatrixWorld(true);
    const keys = new Map([[b.materials[material], material], [SKIN, 'crewSkin'],
        [BOOTS, 'black'], [TROUSERS, 'dark'], [REFLECTIVE, 'white']]);
    crew.group.traverse(part => {
        if (!part.isMesh) return;
        b.add(keys.get(part.material), part.geometry.clone().applyMatrix4(part.matrixWorld), [x, y, z]);
        part.geometry.dispose();
    });
}

// Arm angles: lift is how far the arm swings forward and up (0 down by the side, PI straight overhead), spread
// how far out to the side.
function setArm(arm, lift, spread, side) {
    arm.shoulder.rotation.set(-side * spread, 0, lift, 'XYZ');
}

// The director during spool-up: both wands raised and circling overhead (the "run up the engines" signal).
export function directorPose(crew, time) {
    const a = time * 7;
    setArm(crew.arms[0], 2.6 + Math.sin(a) * .35, .35 + Math.cos(a) * .25, -1);
    setArm(crew.arms[1], 2.6 + Math.sin(a + Math.PI) * .35, .35 + Math.cos(a + Math.PI) * .25, 1);
    crew.group.position.y = crew.base;
}

// The shooter: one wand circling overhead while the engines come up (k < .7), then the launch signal: down on
// one knee, the wand swept down to touch the deck and then thrown forward along the track.
export function shooterPose(crew, k, time) {
    if (k < .7) {
        const a = time * 8;
        setArm(crew.arms[1], 2.8 + Math.sin(a) * .3, .2 + Math.cos(a) * .25, 1);
        setArm(crew.arms[0], .3, .15, -1);
        crew.group.position.y = crew.base;
        crew.group.rotation.z = 0;
        return;
    }
    const q = Math.min(1, (k - .7) / .3);
    crew.group.position.y = crew.base - .0045 * Math.min(1, q * 2);
    crew.group.rotation.z = -.35 * Math.min(1, q * 2);
    // Touch the deck, then point forward.
    const lift = q < .5 ? THREE.MathUtils.lerp(2.8, .2, q * 2) : THREE.MathUtils.lerp(.2, 1.55, (q - .5) * 2);
    setArm(crew.arms[1], lift, .1, 1);
    setArm(crew.arms[0], .5, .25, -1);
}

// The pilot's head-up display on a small transparent plane, drawn into a canvas and refreshed each frame.
export class CockpitHud {
    constructor(size) {
        this.canvas = document.createElement('canvas');
        this.canvas.width = this.canvas.height = 512;
        this.ctx = this.canvas.getContext('2d');
        this.texture = new THREE.CanvasTexture(this.canvas);
        this.texture.colorSpace = THREE.SRGBColorSpace;
        const material = new THREE.MeshBasicMaterial({map: this.texture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending, color: new THREE.Color(1.6, 1.6, 1.6)});
        this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), material);
        this.mesh.renderOrder = 50;
        this.mesh.visible = false;
        this.mesh.frustumCulled = false;
    }

    // pitch and bank in radians, heading in degrees, speed in knots, altitude in feet, range in nautical miles.
    draw({pitch, bank, heading, speed, altitude, range}) {
        const c = this.ctx, w = 512, mid = w / 2;
        c.clearRect(0, 0, w, w);
        c.strokeStyle = c.fillStyle = 'rgba(90, 255, 140, .95)';
        c.lineWidth = 3;
        c.font = 'bold 22px monospace';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        // Pitch ladder, turned with the bank, a rung every 5 degrees (dashed below the horizon).
        const perDegree = 9;
        c.save();
        c.beginPath();
        c.rect(70, 70, w - 140, w - 140);
        c.clip();
        c.translate(mid, mid);
        c.rotate(-bank);
        for (let d = -60; d <= 60; d += 5) {
            const y = (pitch * 180 / Math.PI - d) * perDegree;
            if (Math.abs(y) > 230) continue;
            c.setLineDash(d < 0 ? [12, 9] : []);
            const half = d === 0 ? 170 : 70, gap = 26;
            c.beginPath();
            c.moveTo(-half, y); c.lineTo(-gap, y);
            c.moveTo(gap, y); c.lineTo(half, y);
            if (d !== 0) { c.moveTo(-half, y); c.lineTo(-half, y + (d > 0 ? 10 : -10)); c.moveTo(half, y); c.lineTo(half, y + (d > 0 ? 10 : -10)); }
            c.stroke();
            if (d !== 0) { c.fillText(String(Math.abs(d)), -half - 22, y); c.fillText(String(Math.abs(d)), half + 22, y); }
        }
        c.restore();
        c.setLineDash([]);
        // Waterline symbol (the jet's nose) and the flight path marker.
        c.beginPath();
        c.moveTo(mid - 34, mid); c.lineTo(mid - 14, mid); c.lineTo(mid - 7, mid + 10); c.lineTo(mid, mid); c.lineTo(mid + 7, mid + 10); c.lineTo(mid + 14, mid); c.lineTo(mid + 34, mid);
        c.stroke();
        c.beginPath(); c.arc(mid, mid + 24, 9, 0, Math.PI * 2);
        c.moveTo(mid - 9, mid + 24); c.lineTo(mid - 26, mid + 24); c.moveTo(mid + 9, mid + 24); c.lineTo(mid + 26, mid + 24); c.moveTo(mid, mid + 15); c.lineTo(mid, mid + 5);
        c.stroke();
        // Heading tape along the top.
        for (let h = Math.floor(heading / 5) * 5 - 20; h <= heading + 20; h += 5) {
            const x = mid + (h - heading) * 6;
            c.beginPath(); c.moveTo(x, 40); c.lineTo(x, h % 10 === 0 ? 24 : 32); c.stroke();
            if (h % 10 === 0) c.fillText(String(((h % 360) + 360) % 360 / 10 | 0).padStart(2, '0'), x, 12);
        }
        c.beginPath(); c.moveTo(mid, 44); c.lineTo(mid - 7, 56); c.lineTo(mid + 7, 56); c.closePath(); c.stroke();
        // Airspeed (knots) and altitude (feet) boxes.
        c.strokeRect(14, mid - 18, 84, 36); c.fillText(String(Math.round(speed)), 56, mid);
        c.strokeRect(w - 108, mid - 18, 94, 36); c.fillText(String(Math.round(altitude / 10) * 10), w - 61, mid);
        c.textAlign = 'left';
        c.fillText(`G ${(1 + Math.abs(bank) * .8).toFixed(1)}`, 20, mid + 60);
        c.fillText(`RNG ${range.toFixed(1)}`, w - 140, w - 40);
        c.fillText('MASTER ARM', 20, w - 40);
        this.texture.needsUpdate = true;
    }
}
