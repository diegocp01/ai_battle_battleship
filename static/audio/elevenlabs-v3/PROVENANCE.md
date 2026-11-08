# Naval sound recordings

Generated for this project on November 7, 2026 through the user's ElevenLabs Sound Effects web app, with **v3** selected. These are generated sound designs, not documentary recordings of actual weapons.

Each prompt produced four alternatives. The first alternative was exported as stereo 48 kHz WAV. Prompt influence was 30%; prompt auto-improvement was off. Loop was enabled only for the ocean ambience. Exact prompts and alternative takes remain in the linked generation histories (account access required).

One-shot WAVs were peak-normalized to 85% full scale (about -1.4 dBFS) with uniform gain only, preserving timing and stereo image. Ocean loop samples are unmodified. Playback envelopes provide click-free starts and tails. Total generation cost shown by the app: 2,720 credits for 68 seconds of requested audio, with four alternatives per prompt.

| File | Direction | Requested duration | Generation |
| --- | --- | ---: | --- |
| missile-cruise.wav | VLS pressure thump, ripping solid booster, granular crackle and receding air | 4 s | [History](https://elevenlabs.io/app/sound-effects/history?id=3rofZU9N5vxKS5tb1Z6j) |
| missile-light.wav | Lighter canister kick, high pressure hiss, bright raspy motor and fast whoosh | 4 s | [History](https://elevenlabs.io/app/sound-effects/history?id=KgVYJPJxIfNvF73iMBqW) |
| missile-sub.wav | Muffled gas ejection, surface breach, cascading spray and throaty rocket ignition | 4 s | [History](https://elevenlabs.io/app/sound-effects/history?id=87QzCuAX2wNaKlOoEnF8) |
| cannon-heavy.wav | Single 16-inch concussive report, turret recoil and rolling low thunder | 4 s | [History](https://elevenlabs.io/app/sound-effects/history?id=Ctnl9GJbsJ7QfwMjU1WQ) |
| cannon-light.wav | Tight 5-inch crack, short propellant punch and metallic breech recoil | 4 s | [History](https://elevenlabs.io/app/sound-effects/history?id=LwjsMNRNFOL9y0Dr46Od) |
| ship-hit.wav | Steel penetration, explosive pressure, tearing hull and falling fragments | 4 s | [History](https://elevenlabs.io/app/sound-effects/history?id=P6Dhamr6YCsPCXI1DxQy) |
| ocean-miss.wav | Deep water impact, tall splash, falling droplets, foam and bubbles | 4 s | [History](https://elevenlabs.io/app/sound-effects/history?id=8yAQAcAG2DuCUstZcFFI) |
| ship-sinking.wav | Stressed steel groans, rivet snaps, flooding compartments and settling water | 8 s | [History](https://elevenlabs.io/app/sound-effects/history?id=5KgkqR5W9xAHUK0tiCGE) |
| ocean.wav | Continuous open sea swells, close lapping water, foam and light wind; loop enabled | 20 s | [History](https://elevenlabs.io/app/sound-effects/history?id=6KYH9T1KDOPJGyLUz6Cp) |
| jet.wav | Twin-turbofan growl, turbine whine, air rush and Doppler drop | 6 s | [History](https://elevenlabs.io/app/sound-effects/history?id=UO0yqLYeeYYTJFIQ7Hqh) |
| torpedo.wav | Muffled tube ejection, bubbles, rhythmic propeller churn and underwater cavitation | 6 s | [History](https://elevenlabs.io/app/sound-effects/history?id=FvcbXwBHgFhotJvlyyaV) |

Prompts request natural isolated sound, no music or voices, and no unrelated explosions. Runtime uses restrained reverb, a dynamics compressor and small pitch variations; timed jet/torpedo sounds fade at the end of their flight. The original synthesis remains the per-event fallback if download or decoding fails. The ocean recording fades in as the synthesized ambience fades out.

## Verification and audition

Run `node --test tests/audio.test.mjs`. For actual browser decoding, playback, mute and voice-cleanup checks, serve the repository with `python3 -m http.server 8768` and open `http://127.0.0.1:8768/tests/audio-browser.html`. Press **Load and verify sounds**; the checks take about nine seconds, then the individual sound buttons become available.

The bundled recordings load from `/static/audio/elevenlabs-v3/`; there are no credentials, remote audio URLs or generation API calls in the application.
