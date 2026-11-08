import test from 'node:test';
import assert from 'node:assert/strict';
import {planStrikeRoute, TURN_RADIUS, MAX_CLIMB} from '../static/js/theater/strike-route.js';

const WALL_TOP = 3.41;
const deg = (r) => r * 180 / Math.PI;

// A carrier on the GPT side (x < 0) at a given place and heading, striking a target on Claude's side.
function plan(x, z, heading, impact = [6.5, .2, 0]) {
    const forward = [Math.cos(heading), 0, -Math.sin(heading)];
    return {forward, route: planStrikeRoute({deckEnd: [x, .25, z], forward, impact, wallTop: WALL_TOP})};
}

function checkFlyable(route, forward) {
    const p = route.points;
    // It leaves along the catapult.
    const first = [p[1][0] - p[0][0], p[1][2] - p[0][2]];
    const len = Math.hypot(...first);
    assert.ok((first[0] * forward[0] + first[1] * forward[2]) / len > .99, 'leaves along the catapult');
    // Never turns tighter than the turn radius (heading change per unit of ground covered).
    for (let i = 1; i < p.length - 1; i++) {
        const a = [p[i][0] - p[i - 1][0], p[i][2] - p[i - 1][2]], b = [p[i + 1][0] - p[i][0], p[i + 1][2] - p[i][2]];
        const la = Math.hypot(...a), lb = Math.hypot(...b);
        if (la < 1e-6 || lb < 1e-6) continue;
        const turn = Math.acos(Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1]) / (la * lb))));
        assert.ok(turn / ((la + lb) / 2) <= 1 / TURN_RADIUS * 1.15, `turn at point ${i} is too tight`);
    }
    // Climbs no steeper than the jet can, and gets over the wall with room to spare.
    for (let i = 1; i < p.length; i++) {
        const run = Math.hypot(p[i][0] - p[i - 1][0], p[i][2] - p[i - 1][2]);
        if (run > 1e-6) assert.ok((p[i][1] - p[i - 1][1]) / run <= MAX_CLIMB * 1.05, `climb at point ${i} is too steep`);
    }
    assert.ok(route.gate[1] > WALL_TOP + .3);
    assert.equal(route.gate[0], 0);
    // It reaches the gate on the wall from its own side, crossing at 30 degrees or more to the wall.
    const last = p.at(-1), before = p.at(-2);
    assert.ok(Math.abs(last[0]) < 1e-9 && Math.abs(last[1] - route.gate[1]) < 1e-9);
    const dx = last[0] - before[0], dz = last[2] - before[2];
    assert.ok(dx > 0, 'flies toward the wall at the gate');
    assert.ok(deg(Math.atan2(Math.abs(dx), Math.abs(dz))) >= 29.5, 'crosses the wall at a proper angle');
    // It stays on its own side until the gate.
    assert.ok(p.slice(0, -1).every(q => q[0] < 1e-9));
}

test('a carrier pointing at the wall from far off flies nearly straight at it', () => {
    const {forward, route} = plan(-9, 0, 0);
    checkFlyable(route, forward);
    assert.ok(deg(route.turn.angle) < 20);
    assert.equal(route.loops, 0);
});

test('a carrier pointing away from the wall turns about half a circle toward it', () => {
    const {forward, route} = plan(-6, 1, Math.PI);
    checkFlyable(route, forward);
    assert.ok(deg(route.turn.angle) > 140 && deg(route.turn.angle) < 220);
});

test('a carrier lying parallel to the wall turns about a quarter circle, the right way for its heading', () => {
    const north = plan(-4, 2, Math.PI / 2), south = plan(-4, -2, -Math.PI / 2);
    for (const {forward, route} of [north, south]) {
        checkFlyable(route, forward);
        assert.ok(deg(route.turn.angle) > 45 && deg(route.turn.angle) < 135);
    }
    // Heading -z (north) the wall is on the right; heading +z it is on the left.
    assert.equal(north.route.turn.side, -1);
    assert.equal(south.route.turn.side, 1);
});

test('a carrier close beside the wall turns away from it and comes round, rather than swinging over it low', () => {
    const {forward, route} = plan(-2, 0, Math.PI / 2);
    checkFlyable(route, forward);
    // Heading north, the wall is on the right: it turns left, the long way round.
    assert.equal(route.turn.side, 1);
    assert.ok(deg(route.turn.angle) > 200);
});

test('a carrier with no room to turn short of climbing orbits as she climbs, on her own side', () => {
    const {forward, route} = plan(-3.6, 0, 0, [2.2, .2, 0]);
    checkFlyable(route, forward);
    assert.ok(route.loops >= 1);
});

test('launched straight at the wall from close by, it zoom-climbs over without crossing early', () => {
    const {route} = plan(-1.6, 0, 0);
    assert.equal(route.loops, 0);
    assert.ok(route.points.slice(0, -1).every(q => q[0] < 0));
    for (const q of route.points) if (q[0] > -.4) assert.ok(q[1] > WALL_TOP + .2, 'over the wall top near it');
});

test('the routes differ with where the carrier lies and how she points', () => {
    const a = plan(-2.5, -3, Math.PI / 2).route, b = plan(-9, 2, Math.PI).route;
    assert.notDeepEqual(a.turn, b.turn);
    assert.ok(Math.abs(a.gate[2] - b.gate[2]) > .3, 'they cross the wall in different places');
});
