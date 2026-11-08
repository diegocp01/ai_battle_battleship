import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';

// Match the browser import map, using the exact vendored Three.js version (no npm dependency).
registerHooks({resolve(specifier, context, next) {
    if (specifier === 'three') return next(new URL('../static/vendor/three/three.module.js', import.meta.url).href, context);
    if (specifier.startsWith('three/addons/')) return next(new URL('../static/vendor/three/addons/' + specifier.slice(13), import.meta.url).href, context);
    return next(specifier, context);
}});
const THREE = await import('../static/vendor/three/three.module.js');
const {deckCrew, carrierSailor, directorPose, shooterPose} = await import('../static/js/theater/flightdeck.js');
const {ShipBuilder} = await import('../static/js/theater/shipkit.js');
const yellow = new THREE.MeshStandardMaterial({color: 0xd8a21c});

function finiteBounds(group) {
    const bounds = new THREE.Box3().setFromObject(group);
    for (const value of [...bounds.min.toArray(), ...bounds.max.toArray()]) assert.ok(Number.isFinite(value));
    return bounds;
}

test('crew have separated legs, face and cranial protection at the original scale', () => {
    const crew = deckCrew(yellow, yellow, {wands: false});
    assert.equal(crew.group.children.filter(p => p.name === 'trouser-leg').length, 2);
    for (const name of ['nose', 'goggles', 'cranial', 'ear-defender', 'vest-strap']) assert.ok(crew.group.getObjectByName(name), name);
    const bounds = finiteBounds(crew.group);
    assert.ok(Math.abs(bounds.min.y) < 1e-8, 'boots sit on deck');
    assert.ok(bounds.max.y > .023 && bounds.max.y < .025, 'height remains in the original envelope');
});

test('launch crew retain shoulder pivots, tips and finite poses throughout the launch', () => {
    const crew = deckCrew(yellow, yellow);
    crew.base = .2;
    assert.equal(crew.arms.length, 2);
    for (const arm of crew.arms) {
        assert.equal(arm.shoulder.position.y, .0182);
        assert.equal(arm.tip.position.y, -.016);
    }
    for (const time of [0, .5, 1, 3]) {
        directorPose(crew, time);
        assert.equal(crew.group.position.y, crew.base);
        finiteBounds(crew.group);
        for (const k of [0, .69, .7, .85, 1]) {
            shooterPose(crew, k, time);
            finiteBounds(crew.group);
            assert.ok(crew.group.position.y <= crew.base);
        }
    }
});

test('static carrier crew merge into existing material buckets with no wands', () => {
    const b = new ShipBuilder();
    b.materials = Object.fromEntries(['yellow', 'crewSkin', 'black', 'dark', 'white'].map(k => [k, new THREE.MeshStandardMaterial()]));
    carrierSailor(b, .5, .2, .1, 'yellow');
    const halves = b.build(b.materials);
    assert.equal(halves.fore.children.length, 5, 'merged by material, not one draw call per limb');
    const bounds = finiteBounds(halves.fore);
    assert.ok(Math.abs(bounds.min.y - .2) < 1e-7);
    assert.ok(bounds.max.y < .225);
    halves.fore.traverse(part => {
        if (!part.isMesh) return;
        for (const value of part.geometry.attributes.position.array) assert.ok(Number.isFinite(value));
    });
});

test('carrier callback preserves scatter positions, jersey choices and random stream', async () => {
    const plain = await import('../static/js/theater/detail.js?plain');
    const carrier = await import('../static/js/theater/detail.js?carrier');
    const expected = [], actual = [];
    plain.crewGroup({}, 1, .2, .3, ['yellow', 'white'], 4, .04, (...args) => expected.push(args.slice(1)));
    const b = new ShipBuilder();
    b.materials = Object.fromEntries(['yellow', 'crewSkin', 'black', 'dark', 'white'].map(k => [k, new THREE.MeshStandardMaterial()]));
    carrier.crewGroup(b, 1, .2, .3, ['yellow', 'white'], 4, .04, (...args) => {
        actual.push(args.slice(1));
        carrierSailor(...args);
    });
    assert.deepEqual(actual, expected);
    assert.equal(carrier.rand(), plain.rand());
    const calls = [];
    plain.sailor({add: (...args) => calls.push(args)}, 0, 0, 0, 'white');
    assert.equal(calls.length, 2, 'other ships still use their original two-piece sailor');
});
