// Authored with ElevenLabs Sound Effects v3. Files are served locally; no runtime API calls.
const root = '/static/audio/elevenlabs-v3/';
export const SOUND_BANK = Object.freeze({
    missile: {file: 'missile-cruise.wav', gain: .9},
    missileLight: {file: 'missile-light.wav', gain: .8},
    subMissile: {file: 'missile-sub.wav', gain: .9},
    cannonHeavy: {file: 'cannon-heavy.wav', gain: .95},
    cannon: {file: 'cannon-light.wav', gain: .8},
    explosion: {file: 'ship-hit.wav', gain: 1}, // missile warhead / secondary blast
    impactShell: {file: 'impact-shell.wav', gain: .8},
    impactAP: {file: 'impact-ap.wav', gain: 1},
    impactJet: {file: 'impact-jet.wav', gain: 1},
    impactUnderwater: {file: 'impact-underwater.wav', gain: .9},
    splash: {file: 'ocean-miss.wav', gain: .8},
    creak: {file: 'ship-sinking.wav', gain: .8},
    jet: {file: 'jet.wav', gain: .65, timed: true},
    jetEngine: {file: 'jet-engine-loop.wav', gain: .65},
    catapult: {file: 'carrier-catapult.wav', gain: .85},
    deckWhistle: {file: 'deck-whistle.wav', gain: .38},
    cockpitWind: {file: 'cockpit-wind-loop.wav', gain: .3},
    cockpitWarning: {file: 'cockpit-warning.wav', gain: .25},
    torpedo: {file: 'torpedo.wav', gain: .6, timed: true},
    ocean: {file: 'ocean.wav', gain: .16},
});

// Cues the battle already plays that have no recording yet. Each is silent until a file is added to SOUND_BANK
// under the same key (for example `radioStrikeTasking: {file: 'radio-strike-tasking.wav', gain: .8}`); nothing
// else needs to change. The radio calls play only in the cinematic camera.
export const OPEN_CUES = Object.freeze({
    radioStrikeTasking: 'Radio, carrier to pilot: strike tasking and clearance to launch (first seconds of the spool-up).',
    radioPilotReady: 'Radio, pilot: ready, engines at full power, salute to the catapult officer.',
    radioAirborne: 'Radio, pilot: airborne, climbing, heading for the target.',
    radioCommit: 'Radio, pilot: target in sight, committing to the dive (as the jet crosses the barrier).',
    radioFinal: 'Radio, last words between the carrier and the pilot just before impact.',
});

export function soundKey(kind, scale, impact = {}) {
    if (kind === 'explosion') {
        if (impact.weapon === 'torpedo') return 'impactUnderwater';
        if (impact.weapon === 'gun') return 'impactShell';
        if (impact.weapon === 'salvo') return 'impactAP';
        if (impact.weapon === 'strike') return 'impactJet';
    }
    return kind === 'cannon' && scale > 1 ? 'cannonHeavy' : kind;
}

// Subtle hull coloration, not another full-volume explosion layered on every hit.
// Underwater detonation is a distinct event; a waterline shell retains its own attack.
export function impactVoice({weapon, ship, waterline, mass} = {}) {
    if (!weapon) return {rate: 1, cutoff: 0};
    const hullRate = {Carrier: .96, Battleship: .92, Cruiser: 1, Destroyer: 1.05, Submarine: .94}[ship] ?? 1;
    const shellRate = weapon === 'gun' ? (mass != null && mass < 5 ? 1.12 : .9) : 1;
    return {rate: hullRate * shellRate, cutoff: ship === 'Submarine' || weapon === 'torpedo' ? 1800 : waterline ? 4200 : 0};
}

export async function loadSoundBank(ctx, onLoaded, fetcher = fetch) {
    const entries = Object.entries(SOUND_BANK);
    // Bound simultaneous downloads/decode work so the renderer stays responsive.
    await Promise.all(Array.from({length: 3}, async () => {
        while (entries.length) {
            const [key, spec] = entries.shift();
            try {
                const response = await fetcher(root + spec.file);
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const buffer = await ctx.decodeAudioData(await response.arrayBuffer());
                onLoaded(key, buffer);
            } catch {
                // A failed asset leaves that event on its synthesized fallback.
            }
        }
    }));
}
