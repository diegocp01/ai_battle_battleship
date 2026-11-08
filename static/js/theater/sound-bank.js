// Authored with ElevenLabs Sound Effects v3. Files are served locally; no runtime API calls.
const root = '/static/audio/elevenlabs-v3/';
export const SOUND_BANK = Object.freeze({
    missile: {file: 'missile-cruise.wav', gain: .9},
    missileLight: {file: 'missile-light.wav', gain: .8},
    subMissile: {file: 'missile-sub.wav', gain: .9},
    cannonHeavy: {file: 'cannon-heavy.wav', gain: .95},
    cannon: {file: 'cannon-light.wav', gain: .8},
    explosion: {file: 'ship-hit.wav', gain: 1},
    splash: {file: 'ocean-miss.wav', gain: .8},
    creak: {file: 'ship-sinking.wav', gain: .8},
    jet: {file: 'jet.wav', gain: .65, timed: true},
    torpedo: {file: 'torpedo.wav', gain: .6, timed: true},
    ocean: {file: 'ocean.wav', gain: .16},
});

// Cues the battle already plays that have no recording yet. Each is silent until a file is added to SOUND_BANK
// under the same key (for example `radioStrikeTasking: {file: 'radio-strike-tasking.wav', gain: .8}`); nothing
// else needs to change. The radio calls play only in the cinematic camera.
export const OPEN_CUES = Object.freeze({
    catapult: 'Steam catapult stroke: the shuttle slamming down the track, steam roar, the jet gone in two seconds.',
    deckWhistle: 'The catapult officer\'s whistle and the deck crew calling clear, as the jet spools up.',
    radioStrikeTasking: 'Radio, carrier to pilot: strike tasking and clearance to launch (first seconds of the spool-up).',
    radioPilotReady: 'Radio, pilot: ready, engines at full power, salute to the catapult officer.',
    radioAirborne: 'Radio, pilot: airborne, climbing, heading for the target.',
    radioCommit: 'Radio, pilot: target in sight, committing to the dive (as the jet crosses the barrier).',
    cockpitWind: 'In the cockpit during the dive: airflow over the canopy and the engines, rising with speed.',
    cockpitWarning: 'In the cockpit near the end of the dive: the altitude / pull-up warning tone.',
    radioFinal: 'Radio, last words between the carrier and the pilot just before impact.',
});

export function soundKey(kind, scale) {
    return kind === 'cannon' && scale > 1 ? 'cannonHeavy' : kind;
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
