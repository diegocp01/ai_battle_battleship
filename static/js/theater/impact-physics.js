// World-space visual approximation: one unit is 75 m; battle time is accelerated.
// Energy controls volume (radius ∝ cube root); momentum biases ejecta downrange.
// These coefficients are presentation choices, not an engineering blast solver.
const DEFAULTS = {
    gun: {mass: 31.8, charge: 3.6, top: 800},
    salvo: {mass: 1225, charge: 18.6, top: 762, fuze: 'delay'},
    missile: {mass: 520, charge: 220, top: 300},
    subMissile: {mass: 520, charge: 220, top: 300},
    strike: {mass: 19000, charge: 430, top: 400, fuze: 'impact', fuel: 3000},
    torpedo: {mass: 1500, charge: 290, top: 30},
    secondary: {mass: 0, charge: 90, top: 0},
};
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const DEBRIS_GRAVITY = 4.6;

export function shipImpactProfile(kind = 'missile', round = {}, velocity = {x: 0, y: -4, z: 0}) {
    const spec = {...(DEFAULTS[kind] || DEFAULTS.missile), ...round};
    const length = Math.hypot(velocity.x, velocity.y, velocity.z);
    const speed = Math.min(length * 75, spec.top);
    const kinetic = .5 * spec.mass * speed * speed;
    const energy = spec.charge * 4.2e6 + kinetic * .08;
    const size = clamp(Math.cbrt(energy / (220 * 4.2e6)), .16, 1.65);
    const carry = clamp(Math.sqrt(kinetic / 2e8), 0, 1.4);
    return {
        size, energy, speed,
        drift: {x: length ? velocity.x / length * carry : 0, y: 0, z: length ? velocity.z / length * carry : 0},
        delay: spec.fuze === 'delay' ? .055 : 0,
        radius: .24 * size,
        flashLife: .055 + .045 * size,
    };
}

// Exact integration of dv/dt = acceleration - drag*v. Stable under slow motion,
// frame drops and different refresh rates; acceleration may include buoyancy.
export function integrateDrag(position, velocity, dt, drag, acceleration = 0) {
    const decay = Math.exp(-drag * dt);
    const travel = drag > 1e-6 ? -Math.expm1(-drag * dt) / drag : dt;
    const gravityTravel = drag > 1e-6 ? (dt - travel) / drag : dt * dt * .5;
    position.x += velocity.x * travel;
    position.y += velocity.y * travel + acceleration * gravityTravel;
    position.z += velocity.z * travel;
    velocity.x *= decay;
    velocity.y = velocity.y * decay + acceleration * travel;
    velocity.z *= decay;
}
