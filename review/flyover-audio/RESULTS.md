# Opening flyover audio verification

Verified November 8, 2026. Uses the existing `jet-engine-loop.wav` recording generated with ElevenLabs Sound Effects v3; no new generation or credit spend was needed.

The opening already requested an engine loop, but an audio context that was not yet unlocked produced a permanently inert handle, and a pending recording left the flight on its noise fallback. The opening's speed could also make the old Doppler denominator negative, incorrectly lowering pitch during approach.

Changes: recover audio when unlocked, replace fallback with the recording when available, bound radial speed before the Doppler division, fade the ends of each flight, give the ceremony modest additional presence, and retire patrols before launching the two opening formations. Each of the ten aircraft now has its own positional sound voice until departure. Independent sample phases and slight pitch differences avoid synchronized copies; per-aircraft gain preserves headroom and makes larger formations fuller. Wingmen follow their visible positions, including their later pass times. Aft-facing exhaust adds a modest lower, stronger departure roar. Formation audio has a ten-voice pool separate from the four carrier/cockpit voices; reset stops all voices.

- `node --test tests/*.test.mjs`: 26 passed. New regression checks cover continuous/finite approach pitch, late unlock, fallback upgrade exactly once, no restart churn after a voice is stopped, ten independent sample offsets, separate formation/cinematic voice budgets and cleanup.
- Chrome, `tests/flyover-audio-browser.html`: all ten jets in the two five-jet formations had independent active recorded voices after starting before audio unlock; recordings loaded successfully. All ten engines remained active when the opening ceremony promise resolved and stopped once the jets left. No browser errors.
- Replayed, toggled mute, then reset: all ten loop handles stopped and the active loop set was empty.

Serve with `python3 -m http.server 5020 --bind 127.0.0.1`, then open the test page and press **Play opening flyover**. The preview uses no server-side match or model calls.

![Opening playback and departure checks](playback.png)
![Muted reset check](reset.png)

Reference: user-provided `Jet Fighter Flyby sound FX.mp3` from https://www.youtube.com/watch?v=PYDskj2yGiA. Browser decoding measured 133.538 seconds, stereo; the amplitude envelope contains multiple swells (for example, half-second RMS peaks near 24.5, 64.5 and 87 seconds). Used as a dynamics reference, not as a bundled asset. The game continues to use the existing ElevenLabs FX v3 recording. Verification covers decoding, routing, voice counts and lifecycle; no subjective listening assessment was possible in this environment.
