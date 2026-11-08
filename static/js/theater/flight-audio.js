// Flight paths use accelerated battle-time speeds. Bound the audio shift before
// dividing, so an approaching jet can never cross a zero/negative denominator.
export function flightDoppler(closing, soundSpeed = 4.6) {
    const radialMach = Math.max(-.6, Math.min(.45, closing / soundSpeed));
    return 1 / (1 - radialMach);
}

// A formation may already be in the air when the first user gesture unlocks audio.
// Start then, and replace a temporary noise fallback once the v3 recording arrives.
export function flightEngine(audio, current, at) {
    if (!audio?.ctx) return current;
    const recorded = audio.samples.has('jetEngine');
    if (!current || (current.active && !current.recorded && recorded)) {
        current?.stop();
        return audio.startLoop('jetEngine', at, {level: 0});
    }
    return current;
}
