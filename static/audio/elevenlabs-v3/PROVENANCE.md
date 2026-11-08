# Naval sound recordings

Generated for this project on November 7, 2026 through the user's ElevenLabs Sound Effects web app, with **v3** selected. These are generated sound designs, not documentary recordings of actual weapons.

Each prompt produced four alternatives. The first alternative was exported as stereo 48 kHz WAV. Prompt influence was 30%; prompt auto-improvement was off. Loop was enabled only for the ocean ambience. Exact prompts and alternative takes remain in the linked generation histories (account access required).

One-shot WAVs were peak-normalized to 85% full scale (about -1.4 dBFS) with uniform gain only, preserving timing and stereo image. Ocean loop samples are unmodified. Playback envelopes provide click-free starts and tails. Initial generation cost shown by the app: 2,720 credits for 68 seconds of requested audio, with four alternatives per prompt.

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

## Projectile-specific impact expansion

Added four v3 recordings on November 7, 2026 (November 8 UTC), using the same export and normalization settings. The first take of each completed generation was selected. These cost 640 additional credits for 16 seconds (3,680 to 3,040 credits remaining); two unsuccessful attempts at the longer aircraft prompt produced no takes or credit charge. The existing `ship-hit.wav` remains the missile warhead / secondary blast. Launch, flight, splash, sinking and ocean recordings remain in use.

| File | Duration | Downloaded source / direction |
| --- | ---: | --- |
| impact-shell.wav | 3 s | `Isolated_realistic_n_#1-1794109112299.wav`; small HE shell crack and light steel fragments |
| impact-ap.wav | 4 s | `Isolated_realistic_h_#1-1794109296853.wav`; heavy penetration and internal detonation |
| impact-jet.wav | 5 s | `Aircraft_impact_soun_#1-1794109436465.wav`; crushing airframe, fuel whoosh and fire decay |
| impact-underwater.wav | 4 s | `Underwater_torpedo_i_#1-1794109472057.wav`; muffled pressure, bubble pulse and water surge |

Exact successful prompts (also retained in the user's [generation history](https://elevenlabs.io/app/sound-effects/history)):

- **Small shell:** Isolated realistic naval small-shell impact on a steel ship. One immediate sharp 57 mm high-explosive crack with a compact dry metal punch, brief thin steel ringing and scattered tiny fragments clattering down. Fast attack at the very start, short decay into silence. Close exterior perspective, natural dynamics, no large rolling fireball, no launch sound, no music, no voices.
- **Armour piercing:** Isolated realistic heavy naval armour-piercing shell striking a steel battleship. Immediate violent dense steel penetration crack, followed instantly by a muffled internal detonation venting through torn armour plate, heavy resonant hull ringing and falling jagged fragments. Close exterior perspective, powerful low-end body and brief natural outdoor decay into silence. No gun muzzle blast, no projectile whistle, no music, no voices.
- **Aircraft:** Aircraft impact sound effect for a naval game. Immediate crushing steel collision and deep explosive thump, followed by a broad fuel ignition whoosh, tearing metal fragments and a ragged fire crackle fading into silence. Single close exterior event starting at impact. No approach, no flyby, no music, no voices.
- **Underwater:** Underwater torpedo impact sound effect for a naval game. Immediate deep muffled pressure thump, a heavy cavitation bubble pulse, wet steel hull tearing, then a surge of displaced water and dense bubbling fading away. Powerful low-frequency body, subdued high frequencies, natural single event. No launch, motor, sonar, music or voices.

The runtime chooses one impact sample per primary burst, then applies restrained hull/caliber pitch changes and low-pass filtering for wet hits. A missing specialized recording falls back to the original hit, then to synthesis if neither has loaded. These are perceptual sound-design choices rather than an acoustic simulation. Silent carrier radio/cockpit placeholders listed in `OPEN_CUES` are separate from impact coverage.

## Verification and audition

Run `node --test tests/audio.test.mjs`. For actual browser decoding, playback, mute and voice-cleanup checks, serve the repository with `python3 -m http.server 8768` and open `http://127.0.0.1:8768/tests/audio-browser.html`. Press **Load and verify sounds**; the checks take about nine seconds, then the individual sound buttons become available.

The bundled recordings load from `/static/audio/elevenlabs-v3/`; there are no credentials, remote audio URLs or generation API calls in the application.

## Carrier launch and flight expansion

Generated November 8, 2026 through the same ElevenLabs v3 web interface, 30% prompt influence, prompt improvement off, first take exported as stereo 48 kHz WAV. Loop mode was on for engine and cockpit airflow only. All five recordings are peak-normalized to 85% full scale; loops have a 50 ms overlap crossfade at the join, shortening them to 7.95 and 5.95 seconds. The runtime varies gain, pitch and filtering with the scene without stretching playback to the battle speed.

| File | Requested duration | Original download |
| --- | ---: | --- |
| jet-engine-loop.wav | 8 s, loop | `Seamless_continuous__#1-1794113004323.wav` |
| carrier-catapult.wav | 2 s | `Single_realistic_air_#1-1794113072812.wav` |
| deck-whistle.wav | 2 s | `Isolated_realistic_f_#1-1794113137303.wav` |
| cockpit-wind-loop.wav | 6 s, loop | `Seamless_constant_co_#1-1794113245481.wav` |
| cockpit-warning.wav | 2 s | `Isolated_short_aircr_#1-1794113304999.wav` |

This pass used 880 credits: 800 for these five recordings plus 80 for an unused duplicate catapult generation caused by the prompt field retaining its previous value. No subscription or additional credit purchase was made.

Exact prompts, also retained in the user's [generation history](https://elevenlabs.io/app/sound-effects/history):

- **Engine:** Seamless continuous loop of a powerful naval fighter jet twin turbofan engine under steady thrust. Dense low turbine rumble, gritty broadband exhaust roar and a restrained high mechanical whine, close exterior perspective. Constant even energy throughout, no flyby or Doppler, no startup or shutdown, no silence, no explosions, no voices, no music. Realistic organic engine texture for a moving aircraft.
- **Catapult:** Single realistic aircraft carrier steam catapult launch. Immediate heavy mechanical shuttle clank, powerful short pressurized steam blast ripping down a metal track, accelerating steel rattle then a compact end-stop thud and brief hiss decay. Close flight deck perspective. Two seconds. No jet engine, no explosion, no music, no voices.
- **Deck whistle:** Isolated realistic flight deck launch signal: two short piercing blasts of a metal pea whistle blown by a carrier deck officer, with a tiny breath gap and a clean brief decay. Crisp close outdoor sound, dry natural recording. No speech, no crowd, no engines, no music. Begin immediately and finish within two seconds.
- **Cockpit airflow:** Seamless constant cockpit airflow loop inside a fast naval fighter jet. Dense rushing air over the canopy with a muted low mechanical vibration underneath, enclosed perspective, textured smooth broadband wind and a little high-speed buffeting. Steady sound throughout, no fade, no start or ending, no alarms, no speech, no music, no explosions.
- **Warning:** Isolated short aircraft cockpit caution alert for a naval flight simulation. Three crisp alternating electronic warning beeps, restrained narrowband avionics tone with a slight cockpit speaker texture. Starts immediately, clearly separated pulses, ends cleanly within two seconds. No spoken words, no siren sweep, no engines, no music, no explosion.

The five dialogue/radio placeholders remain optional and unrecorded. Engine and airflow loops have filtered-noise fallbacks during asset loading or decode failure. Their lifetime is controlled by launch/flight events rather than a fixed timer, and they are capped at four concurrent loops.
