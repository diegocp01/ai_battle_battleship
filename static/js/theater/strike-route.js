// The carrier strike's route from the catapult to the barrier, planned the way a pilot would fly it, so it makes
// sense wherever the carrier lies and whichever way she points:
//  - off the bow along the catapult track, with a short straight run to clean up and gain speed;
//  - a turn at a steady radius, the shorter way round, until the nose points at the crossing gate on the wall
//    (a carrier lying parallel to the wall turns about 90 degrees, one pointing away from it about 180, one
//    already pointing at it hardly at all);
//  - straight on to the gate, crossing the wall at no less than 30 degrees to it (never grazing along it);
//  - climbing all the way, never steeper than the jet can, to pass over the wall's top with room to spare. Short
//    of room to climb, it orbits once (or more) as it climbs, on its own side of the wall; with no room even for
//    that (launched straight at the wall from close by), it zoom-climbs over on afterburner.
//  - A turn that would swing over the wall before the jet has climbed goes the other way round instead.
// Plain numbers, no three.js, so the planning can be tested on its own. One unit is a 75 m grid square.

export const TURN_RADIUS = 1.9;   // squares: a hard but flyable turn at the battle's quickened speeds
export const MAX_CLIMB = 1.25;    // steepest climb (rise over run), about 51 degrees, reached mid-climb
const MIN_CROSSING = Math.tan(Math.PI / 3);   // |dz| <= |dx| * tan(60°): at least 30° to the wall

const rotate = ([x, z], angle) => [x * Math.cos(angle) + z * Math.sin(angle), -x * Math.sin(angle) + z * Math.cos(angle)];
const cross = (a, b) => a[1] * b[0] - a[0] * b[1];   // the y of (a × b) for plan vectors [x, z]
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const length = (a) => Math.hypot(a[0], a[1]);
const smoothstep = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));

// The turn from position p heading h (plan vectors) toward the point g, on the given side (+1 left, -1 right; the
// shorter way when not given): how far round (radians), the circle and where it rolls out.
function turnToward(p, h, g, radius, forced = 0) {
    const to = [g[0] - p[0], g[1] - p[1]];
    let side = forced || Math.sign(cross(h, to)) || 1;
    const left = [h[1], -h[0]];
    const center = [p[0] + side * left[0] * radius, p[1] + side * left[1] * radius];
    const arm = [p[0] - center[0], p[1] - center[1]];
    const step = Math.PI / 180;
    for (let k = 0; k <= 360; k++) {
        const angle = side * k * step;
        const r = rotate(arm, angle), heading = rotate(h, angle);
        const at = [center[0] + r[0], center[1] + r[1]];
        const toGate = [g[0] - at[0], g[1] - at[1]];
        if (side * cross(heading, toGate) <= 0 && dot(heading, toGate) > 0) return {side, angle: k * step, center, arm, at};
    }
    return null;
}

// deckEnd: [x, y, z] where the catapult releases the jet; forward: the catapult's direction; impact: [x, y, z] of
// the target on the far side of the wall at x = 0; wallTop: the height to clear. Returns the route's points from
// deckEnd to the gate on the wall ([x, y, z], about every quarter square), the gate itself, the turn taken and the
// number of climbing orbits.
export function planStrikeRoute({deckEnd, forward, impact, wallTop, gateLift = .6, radius = TURN_RADIUS, runout = 1.1, margin = .45}) {
    const f0 = [forward[0], forward[2]], fl = length(f0) || 1;
    const f = [f0[0] / fl, f0[1] / fl];
    const p0 = [deckEnd[0], deckEnd[2]];
    const p1 = [p0[0] + f[0] * runout, p0[1] + f[1] * runout];
    const own = Math.sign(p0[0]) || -1;
    const gateY = wallTop + gateLift;
    const rise = gateY - deckEnd[1];
    // Distance from the wall on the jet's own side (negative: past it).
    const clear = (x) => own * x;
    // The turn and the straight line after it, aimed at a point: the target itself (so it rolls out on the line
    // to the target and crosses the wall where that line does), or a gate on the wall.
    const plan = (aim, side) => {
        const turn = turnToward(p1, f, aim, radius, side);
        if (!turn) return null;
        const t = turn.at, a = [aim[0] - t[0], aim[1] - t[1]];
        if (own * a[0] >= 0) return null;   // rolled out heading away from the wall
        const gz = t[1] + a[1] * (0 - t[0]) / a[0];
        const line = length([0 - t[0], gz - t[1]]);
        // The turn must keep clear of the wall. Short of room to climb, it orbits as it climbs, if the whole
        // circle stays on its own side; if not (launched straight at the wall from close by), it zoom-climbs.
        let loops = 0, arc = turn.angle * radius;
        const orbitFits = clear(turn.center[0]) - radius >= margin;
        while (orbitFits && runout + arc + line < 1.5 * rise / MAX_CLIMB && loops < 3) { loops += 1; arc += 2 * Math.PI * radius; }
        return {turn, gate: [0, gz], line, loops, arc, ok: Math.min(...sweepXs(turn).map(clear)) >= margin};
    };
    const target = [impact[0], impact[2]];
    const options = [];
    for (const side of [0, 1, -1]) {
        let route = plan(target, side || undefined);
        // Cross the wall at no less than 30 degrees to it: move the gate along the wall toward the roll-out.
        for (let i = 0; route && i < 4; i++) {
            const t = route.turn.at, dz = route.gate[1] - t[1], allowed = Math.abs(t[0]) * MIN_CROSSING;
            if (Math.abs(dz) <= allowed + 1e-6) break;
            route = plan([0, t[1] + Math.sign(dz) * allowed], route.turn.side);
        }
        if (route) options.push(route);
    }
    // The shorter way round when it keeps clear of the wall; otherwise away from the wall and back round.
    const route = options.find(o => o.ok) || options[0];
    const {turn, gate, line, loops, arc} = route;
    const total = runout + arc + line;
    const height = (s) => deckEnd[1] + rise * smoothstep(s / total);
    const points = [];
    const push = (x, z, s) => points.push([x, height(s), z]);
    // The run off the bow.
    for (let s = 0; s < runout; s += .25) push(p0[0] + f[0] * s, p0[1] + f[1] * s, s);
    // The turn (with any climbing orbits).
    const sweep = turn.angle + loops * 2 * Math.PI;
    const steps = Math.max(1, Math.ceil(sweep / (Math.PI / 45)));
    for (let k = 0; k < steps; k++) {
        const angle = turn.side * sweep * k / steps;
        const r = rotate(turn.arm, angle);
        push(turn.center[0] + r[0], turn.center[1] + r[1], runout + radius * sweep * k / steps);
    }
    // Straight on to the gate.
    const lineSteps = Math.max(1, Math.ceil(line / .3));
    for (let k = 0; k <= lineSteps; k++) {
        const u = k / lineSteps;
        push(turn.at[0] + (gate[0] - turn.at[0]) * u, turn.at[1] + (gate[1] - turn.at[1]) * u, runout + arc + line * u);
    }
    return {points, gate: [0, gateY, gate[1]], turn: {side: turn.side, angle: turn.angle}, loops};
}

// The x of points along a turn's arc.
function sweepXs(turn) {
    const xs = [];
    for (let a = 0; a <= turn.angle + 1e-9; a += Math.PI / 90) xs.push(turn.center[0] + rotate(turn.arm, turn.side * a)[0]);
    return xs;
}
