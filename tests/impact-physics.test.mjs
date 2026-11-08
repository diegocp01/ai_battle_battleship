import test from 'node:test';
import assert from 'node:assert/strict';
import {shipImpactProfile, integrateDrag, DEBRIS_GRAVITY} from '../static/js/theater/impact-physics.js';

test('a light shell, heavy shell, missile and bomb produce distinct energy-scaled bursts', () => {
    const v = {x: 1, y: -4, z: 0};
    const light = shipImpactProfile('gun', {mass: 2.4, charge: .4, top: 1000}, v);
    const gun = shipImpactProfile('gun', undefined, v);
    const salvo = shipImpactProfile('salvo', undefined, v);
    const missile = shipImpactProfile('missile', undefined, v);
    const bomb = shipImpactProfile('strike', undefined, v);
    assert.ok(light.radius < gun.radius && gun.radius < salvo.radius);
    assert.ok(salvo.radius < missile.radius && missile.radius < bomb.radius);
    assert.equal(salvo.delay, .055);
    assert.equal(missile.delay, 0);
    assert.ok(light.flashLife < .1 && bomb.flashLife < .15);
});

test('eight times the coupled energy doubles the radius; speed is capped', () => {
    const v = {x: 1000, y: -1000, z: 0};
    const a = shipImpactProfile('missile', {mass: 0, charge: 20}, v);
    const b = shipImpactProfile('missile', {mass: 0, charge: 160}, v);
    assert.ok(Math.abs(b.radius / a.radius - 2) < 1e-12);
    assert.equal(a.speed, 300);
});

test('ejecta follow the incoming bearing without assigning downward velocity to deck fragments', () => {
    const east = shipImpactProfile('missile', undefined, {x: 3, y: -1, z: 0});
    const west = shipImpactProfile('missile', undefined, {x: -3, y: -1, z: 0});
    assert.ok(east.drift.x > 0);
    assert.equal(west.drift.x, -east.drift.x);
    assert.equal(east.drift.y, 0);
    assert.equal(shipImpactProfile('gun', undefined, {x: 0, y: 0, z: 0}).drift.x, 0);
});

test('ballistic fragments agree at 30, 60, 144 Hz and across a long frame', () => {
    const simulate = steps => {
        const p = {x: 0, y: .2, z: 0}, v = {x: 2, y: 3, z: -1};
        for (let i = 0; i < steps; i++) integrateDrag(p, v, 1 / steps, .25, -DEBRIS_GRAVITY);
        return {p, v};
    };
    const reference = simulate(1);
    for (const fps of [30, 60, 144]) {
        const actual = simulate(fps);
        for (const key of ['p', 'v']) for (const axis of ['x', 'y', 'z']) assert.ok(Math.abs(actual[key][axis] - reference[key][axis]) < 1e-10);
    }
    assert.ok(reference.v.y < 0, 'debris falls after reaching its apex');
});

test('zero drag reduces to the ordinary constant-acceleration trajectory', () => {
    const p = {x: 0, y: 1, z: 0}, v = {x: 2, y: 3, z: -1};
    integrateDrag(p, v, .5, 0, -4);
    assert.deepEqual(p, {x: 1, y: 2, z: -.5});
    assert.deepEqual(v, {x: 2, y: 1, z: -1});
});
