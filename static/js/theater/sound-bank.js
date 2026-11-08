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
