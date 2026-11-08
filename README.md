# Overview

AI Battleship: two AI models deploy their fleets and trade fire on a full-screen, real-time 3D ocean. You watch it like a video game. The scoreboard shows the two models by name (for example *GPT-6.1 Terra* vs *Opus 5.5*), and each fleet's status and its model's latest reasoning float on the water under its board.

![Battleship](static/img/battle.jpg)

## What you see

- **An open ocean** with Gerstner swells, a physically based sky with clouds, mirror reflections and sun glitter. Four layers of wind chop each move at the true phase speed of their wavelength, so short wavelets lag behind long ones. The sky, sunlit paint and their reflections in the water are balanced to realistic contrast.
- **Live water over the battle area**, using the same deep-water ripple method (iWave) as the sea reference. Every shell splash, blast, droplet that falls back, piece of debris and moving hull pushes the water. The push spreads as rings with real dispersion: long ripples outrun short ones, rings interfere, they reflect off hulls and the barrier, and they soak away at the edges. Ships sailing in drag real wakes behind them. The rings spread about 3.5 times faster than true speed at this scale so they still read from far above.
- **Whitewater as lace**: strikes leave a torn white boil that collapses into a bubble-net lace and slowly fades. A little foam traces thin veins; thick foam fills the cells, with blue creases between lit clumps. The barrier carries the same lace along its waterline.
- **Water around the ships**:
  - **Colour:** the open sea is a dark slate-teal, as in reference photographs of a fleet at sea, not a saturated blue. Light comes through the wave crests teal-green. A rough sea scatters what it mirrors, so the sky's reflection is greyer and greener than the sky itself, and whitecaps break on more of the crests.
  - **At the hull:** the swell slaps the side, throwing white water that comes in sheets and gaps as crests run along it. Around that is a band of aerated water, turquoise with bubbles.
  - **At the bow:** white water piles against the stem and streams back along both sides of the forward hull. When the sea climbs the bow faster than the bow rises with it, the bow throws spray out to both sides, harder the faster the water climbs.
- **Spray with real drag**: each droplet has a terminal speed set by its size, so fine spray hangs as mist while heavy water falls almost straight. Droplets are drawn as motion-blurred streaks. Where they land they press rings into the water, fleck it white, and a hard landing throws a smaller droplet back up out of its crown.
- **A concrete barrier** between the two fleets, so neither side can see the other's ships. It is a long precast wall running to the horizon, with a boom of yellow floats along its waterline. Every round arcs over it.
- **Two 10 × 10 grids projected onto the water like neon light**: a thin bright border with a halo that catches the waves, drawn smoothly at any distance.
- **Real scale**: every grid square is 75 m of sea, and each ship is built at the real length and beam of its class. The swell has real wavelengths, heights and speeds for that scale.
- **The classic fleet, at the classic sizes** (5, 4, 3, 3 and 2 squares), each modeled in detail after a real class:
  - **Carrier (5)**: a Gerald R. Ford-class carrier (337 m), the size of USS Gerald R. Ford or Abraham Lincoln. It has an angled flight deck with a deck park of the fleet's fighters, Hawkeyes, Seahawks and tractors, and the fleet's mascot painted on the bow in thin white deck lines (the Codex cloud bot, or the Claude block creature) where the hull number used to be. Both fleets fly stealth fighters of the same shape: a faceted chined nose, a bubble canopy, trapezoid wings, big raked intakes with a lit leading edge, lit wingtips, twin tails canted outward, twin nozzles, a badge on each intake and the fleet's logo on both tails.
  - **Codex fighters:** deep indigo, with cyan glow (also on the tail tips and along the top of each intake) and a glowing `>_` badge.
  - **Claude fighters:** clay orange, with a white nose cone, white tail tips and white bands along the wing leading edges and the chines. The glow is orange, the badge is the pixel mascot, and the tails carry the starburst. The island carries flat radar faces, deck-edge antennas, sponson CIWS and missile launchers, and hangar openings under the overhang.
  - **Battleship (4)**: an Iowa-class battleship (270 m) with three triple 16-inch turrets on a teak deck, a stepped tower bridge with wings, twin 5-inch mounts, Tomahawk box launchers, Harpoons, CIWS, boats and cranes.
  - **Cruiser (3)**: a Ticonderoga-class cruiser (173 m). The four SPY-1 faces sit on the cut-off corners of its deckhouses. It also has lattice masts, two Mk 41 launchers, two 5-inch guns, Harpoons and torpedo tubes.
  - **Submarine (3)**: an Ohio-class submarine (171 m) with its raised missile deck and 24 hatches, a sail with planes and masts, and limber holes.
  - **Destroyer (2)**: the little boat, a Freedom-class littoral combat ship (118 m). It has a faceted deckhouse, an enclosed mast, a 57 mm gun, Naval Strike Missiles, RAM, a big flight deck and four waterjets.
- **Detail on every ship**: windows, portholes, railings, bollards, anchor chains, vents, life-raft racks, searchlights, antennas, rotating radars, waving flags bearing the full-color Codex robot or Claude Code mascot and crew on deck (the carrier's in their flight-deck jerseys). Hulls show their steel plating, each plate a slightly different shade, with rust weeping from seams and fittings and paint worn back at the edges.
- **Ships under way**: each ship steams slowly ahead and astern on her own squares, rides the swell, and pushes real waves and a wake into the live water.
- **Weapons that fit the ship**: who fires and with what is chosen at random for the show. It never changes the result, which comes only from the cell the model picked. The ship is a weighted pick among those still afloat, never the same one twice in a row, and the weapon is a random pick from that ship's list. The one fixed beat is the battle's second shot, the reply to the opening one, which is always the carrier's jet strike.
  - The battleship trains a turret and fires a three-gun broadside that heels the ship. It throws a fireball, a cloud of cordite smoke and a blast ring on the water, and the shells leave tracer streaks.
  - Cruisers ripple two missiles and the littoral combat ship fires one. Fire blows out of the launcher, and a dense smoke column climbs after the missile. The motor shows shock diamonds and lays a continuous, drifting smoke trail.
  - The submarine's missile breaches the surface.
  - The carrier strike: one of the fleet's fighters spools up to full afterburner on the bow catapult behind its raised blast deflector, steam leaking from the track. The catapult throws it off the bow. It climbs over the barrier with twin afterburner plumes and shock diamonds, vapor flashing over its wings in hard pulls. Having seen the enemy fleet, it doesn't come back: the pilot pushes over, accelerating in the dive, and flies the jet into the target cell with its Mk 84 still on the centreline, into the ship there or into the sea.
- **Impacts**:
  - **Miss**: the splash is worked out from the round that made it. Each weapon fires a real round with its own mass, explosive charge and fuze: a 1,225 kg 16-inch armour-piercing shell, a 5-inch or 57 mm high-explosive shell, an anti-ship missile, or the strike jet itself (about 19 t, with its Mk 84 and about 3 t of fuel aboard). Its speed and angle at impact come from its actual flight, capped at what the real round can reach. The crater grows with the energy put into the water (motion plus the share of the blast the water takes) to the ¼ power. That sets how tall the column stands (about 7 crater radii for a burst under the surface, 4.5 on it), how wide it is and how big the crown is. A round that comes in at a slant throws its crown and a fan of spray downrange, and its column leans the way it was travelling. Delay-fuzed armour-piercing shells punch in, a white dome lifts, then the plume bursts through. A missile's warhead bursts on the surface with a fireball and black smoke. A small shell flashes over a sharp spout and leaves a dark puff. A crashing jet's fuel rolls up in a second fireball, burns on the water downrange of the splash and throws wreckage. The water falls back as heavy rain, mist rolls out, rings spread and a marker buoy stays behind. The sea surface no longer rises and falls with the rings, which made it flex like a stretched sheet; they show in its shading and foam instead.
  - **Hit**: the incoming round's charge, mass, capped speed and direction control the burst. The radius grows with the cube root of coupled energy; a 57 mm round stays much smaller than a missile warhead. Sparks fly off the plating on contact, then a white-hot flash lasting hundredths of a second. The fireball is not one ball but a cluster of unequal lobes, thrown up and downrange by the round's momentum. Their edges fold into cauliflower billows, and each draws out taller as it rises. Brown-black soot lit from inside by the burning core takes over as they cool, then thins out into the smoke column instead of hanging as a solid ball. Jets of burning gas burst out of the hull and are stopped by the air within metres. Delayed armour-piercing shells burst after contact and vent upward. The carrier jet strikes with its bomb and remaining fuel aboard, producing a larger burst and a second rolling fuel fireball. Wreckage is torn plates of hull, some still in grey paint and some charred black, mostly small with a few larger pieces. Fragments carry some of the incoming momentum, tumble, slow under drag and fall under gravity; heavier pieces travel differently from small shards. Torn steel is left standing at every hit: plates ripped up and bent outward around the hole, charred black, a few still glowing at the edge. It rides, lists and sinks with the ship. A missile or the strike jet amidships (and half of 16-inch hits) also tears the side open on the side it came in from. The gash runs from the deck edge down toward the waterline, about 10–15 m across, and the strike jet's runs longer along the hull. A second blast vents out of it, fire burns inside it with plates peeled outward around it, and soot streaks down the side. Burning fuel spreads on the sea below, and the flames reflect in the water. Burning fragments leave short trails and splash into the moving sea. Deck hits use a refractive pressure wave; waterline hits also displace water and throw spray. Fuel-rich hits burn longer, and secondary fires and cook-offs remain ship-dependent. This is a bounded visual approximation with accelerated battle time, not a fluid or structural-damage solver.
- **Fires after a hit**, modelled on real ship fires:
  - **More than one spot:** a hit sets more than one thing burning, so each fire has two or three burning spots spread along the deck. They all ride, list and sink with the ship.
  - **Growth:** fires start small, take hold over a few seconds and pulse like pool fires (about 1.5/√D times a second for a fire D metres across).
  - **Flames:** each spot has a low bed of flame and upright tongues that lick up to Heskestad's flame height (10–20 m for a fire this size), more of them on each pulse. The tongues lean with the wind and break off at the tips.
  - **Flare-ups:** every so often something new catches, flames leap up and a gout of black smoke follows. A fire that has burned a while spreads along the deck.
  - **Smoke:** it forms in the upper flames, so fire and plume are one column. It is oily and near-black where it leaves the flames, then billows up brown-grey, sunlit on top and dark underneath. It widens, curls in turbulent eddies and bends over in a wind that strengthens with height.
  - **Scorching:** steel is soot-black at the heart, with browned paint around it and soot streaked down the sides. It still glows in fine veins and cracks.
  - **Going out:** fires hiss out in steam when the water reaches them.
  - **Long battles:** when the particle pool runs full, every fire emits less rather than new effects failing to appear.
- **Missile smoke**: solid-rocket exhaust is dense white smoke. The launch column is thrown up out of the cell, stopped by the air within tens of metres, then rises on its own heat, billows and drifts downwind. Exhaust deflected off the deck rolls across it and over the sides. The trail is laid down continuously along the flight path, so it stays one unbroken rope that widens, curls and shears in the wind long after the missile has gone.
- **Damage**: every hit tears a real hole, ringed by bent, stripped plating. A shell at the waterline opens the side so you see into the hull; a deck hit leaves a crater. A hit near a radar blows the antenna off; a hit near a turret jams it with its barrels drooping. Water comes in through the holes, so the ship lists toward the damage and settles a little lower with every hit.
- **Sinking**: the ship is wracked by explosions, then settles halfway (by the bow, by the stern, or broken in two) and stays there burning for the rest of the battle. The wreck marks the sunk ship, so its squares on the grid lose their red.
- **Life in the air**: a UH-60 Black Hawk at true size flies a lazy circuit round each fleet with its rotors turning. It has the glazed nose, twin engines on the roof with their exhausts turned out, stub wings with fuel tanks, cabin door windows, a long tail boom to the swept pylon, a tail rotor canted 20° on its right side, the big stabilator and wheeled gear, painted the dark olive-black of an Army Black Hawk. Now and then a pair of the fleet's fighters on patrol crosses high over the battle.
- **Light**: ambient occlusion darkens every corner and contact point (deckhouse to deck, turret to barbette, hull at the waterline). The sun's shadow map follows the camera, so shadows stay crisp close up. Smoke casts shadows. Hot air shimmers above fires, the shock front of a big blast bends the view as it races out, and fast camera moves blur slightly, like a real camera. Fireballs are true volumes, swelling and cooling from white-yellow to dull red as they roll up into smoke, and smoke fades softly where it meets the sea or a ship.
- **Time of day**: each battle is fought at its own hour (morning, midday, afternoon or golden hour), with the sun's colour, the sky's haze and the light on the water to match, and the sun moves on slowly as the battle goes.
- **A cinematic camera** that cuts between shots like an edited battle sequence:
  - a low establishing view of the ship as it trains on the target;
  - close beside the gun, launcher or catapult as it fires;
  - a camera above the barrier panning with the round as it climbs across (on longer flights);
  - a drone flying right beside the round as it comes down, slowing to slow motion just before it lands;
  - for the carrier strike: a low shot on deck behind the yellow-shirted director, lighted wands circling overhead, while the jet spools up and the catapult officer drops to one knee and points down the track to launch; then a deck camera at the bow whipping round as the jet charges past, a chase camera behind the jet over the barrier, then the view from the pilot's seat down the dive: the nose and canopy ahead, a head-up display (pitch ladder, flight path marker, heading, airspeed, altitude, range to target) drawn from the jet's real attitude, and the horizon rolling with the jet, then, in slow motion, a camera beside the target as the jet comes in, holding on the blast;
  - a low angle over the water on the far side as it strikes.
  
  There is also a tactical wide view and a free camera. Scroll or pinch to zoom whichever camera is running, and drag at any time to take the camera yourself.
- **ElevenLabs v3 sound**: local stereo recordings for three distinct missile launches (cruiser, light ship and submarine), heavy and light naval guns, five hull-impact families (small shell, armour-piercing shell, missile, jet crash and underwater torpedo), ocean misses, sinking steel, jets, torpedoes and a looping open sea. Weapon events retain camera-relative distance, pan and arrival delay, with subtle per-shot pitch variation and bounded overlap. Hit audio follows the projectile and target hull: heavy hulls resonate lower, light shells crack higher, and waterline/submarine hits are muffled. Synthesized audio covers loading failures and the remaining whistles, horns and UI cues. No ElevenLabs account or API call is needed during play. [Audio provenance](static/audio/elevenlabs-v3/PROVENANCE.md).

Everything is generated in code with [three.js](https://threejs.org) (vendored in `static/vendor/three`), so there are no model or texture downloads.

## The heads-up display

- **Scoreboard (top)**: each model's name, its mascot, ships afloat, the enemy ships it has sunk, and whether it is thinking.
- **Under each board**: one line of minimal ship icons (dimmed once a ship is sunk, a red dot when damaged) and the model's latest explanation, fixed on the water like the A–J and 1–10 labels. They fade out in close-ups and stay hidden behind the barrier.
- **Bottom**: the current attack or event, with Pause, New match and History.

Shots, hits, accuracy and thinking time are not shown during the match. They are saved with every live game (CLIs or API keys) and appear in the *History* table.

## Connections

**Same words for both sides.** Both models get exactly the same prompts. Nothing in them names a side, a seat or a model family, so neither seat is favoured and neither model is cued to play "as itself".

**Memory: per match, fresh each match.** Every move is a fresh request, so a model's memory is what the app writes into its prompt each turn. That memory is kept for the length of a match and starts empty with every new match. It begins at placement:
- **Placement:** before the battle, each model gets one placement prompt (the side that will fire first deploys first). It answers with every ship's start cell and direction (H runs right, V runs down) and a one-sentence plan. The server checks the fleet is on the grid with no overlaps; an illegal fleet stops the match until the move is retried. Neither model ever sees the other's fleet.

Each shot prompt carries:
- its own fleet as it placed it at the start, with what the enemy has hit or sunk since, and the plan it gave when placing it;
- the radar of what it knows about the enemy grid;
- every shot it has fired this match, each with its result and the one-line reason it gave at the time (for example `Turn 7: D1 → HIT (you thought: "...")`);
- the notes it wrote to itself on its last turn;
- a score line: how many of the enemy's 5 ships it has sunk, and how many of its own it has lost.

Each answer must include updated notes (what it has learned about the enemy fleet and its plan), and these replace the old ones. The model is told the limits: at most 150 characters for its reason, 600 for its notes, and 200 for its placement plan. Anything longer is cut at a whole word with an ellipsis, never mid-word. The opponent never sees the notes, but you do: each model's notes appear on the water under its board, as an italic *Plan:* line below its latest reason. Scripted Test players don't use notes.

Pick one under *Connection* on the setup screen, then pick a model for each fleet:

- **Test** (default): the chosen models are shown, but their moves are simulated: no LLM calls and no keys. The simulation uses a probability map of where ships can still fit.
- **CLIs**: real models through the tools already signed in on this machine, with no API keys. The orange fleet plays through the **Claude Code CLI** (`claude -p`) and the blue fleet through the **Codex SDK** (`@openai/codex-sdk`, driving your Codex CLI). Each fleet also gets a *Reasoning effort* menu.
- **API keys**: calls the OpenAI and Anthropic APIs with the keys in `.env`. Each fleet gets *Reasoning effort* and, on models that have it, *Speed* (Fast) menus.

### The CLIs connection

**Where the menus come from.** The menus are read from the tools themselves when the setup screen loads, and refreshed every ten minutes:
- **Codex:** the Codex model list comes from Codex's own catalog (`codex debug models`). It includes each model's supported reasoning efforts and its default.
- **Claude, models:** Claude Code has no command that lists models, so the Claude list is the current models (Opus 5.5, Sonnet 5.5, Haiku 5.5, Fable 5.1), plus any extra model Claude Code has offered your account.
- **Claude, efforts:** the levels come from `claude --help`. *Model default* sends no `--effort` flag. If a model doesn't support the level you pick, Claude Code uses the nearest level it does.

**How each move runs.** Every move is one self-contained turn:
- **Claude:** runs with its tools off, no MCP servers, no slash commands and no saved session.
- **Codex:** runs in a read-only sandbox, in an empty temporary folder, with network and web search off.
- **Both:** must answer in a JSON schema (the cell, or each ship's start and direction) with one sentence of reasoning, which appears under the board, and with a shot, its updated notes (see *Memory* above). Codex keeps a record of each turn in `~/.codex/sessions`, as it does for every run.

**If something is missing.** If a tool is missing or not signed in, its fleet shows *Not available* and the setup screen says what to install.

**If a model makes an illegal move** (with the CLIs or the API keys): an illegal fleet, or a shot at a cell it already fired at or that isn't on the grid, stops the match with an error naming the model and what it answered. Nothing is played for it, and *Retry move* asks the model again. The app never places a fleet or fires a shot on a model's behalf, so saved results only ever reflect the models' own moves.

**Slow moves.** A move that takes longer than 15 minutes stops with an error. Set `CLI_TIMEOUT` (in seconds) to change that. Deep efforts such as *Max* or *Ultra* can take minutes per move.

### The API keys connection

**Where the keys go.** Copy `.env.example` to `.env` in the project folder (next to `app.py`) and fill in:
```bash
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
```
Then reload the page; no restart is needed. A side whose key is missing or rejected shows *Not available*, and the setup screen says which key to add. `.env` is in `.gitignore`: never commit it.

**Where the menus come from.** Like the CLIs connection, the menus are read live from the APIs and refreshed every ten minutes.

Anthropic (orange fleet):
- **Models and efforts:** the Models API (`client.models.list()`) returns each model the key can use with its capabilities. That gives the model list (models without structured output are left out), each model's effort levels and whether it takes adaptive thinking.
- **Speed:** *Fast* is fast mode, a research preview that runs the same model at up to 2.5× the output speed at twice the price. It's offered on the models that have it: Opus 5.5, Opus 5 and Opus 4.8, or whatever the Models API reports.

OpenAI (blue fleet):
- **Models:** the Models API lists the model IDs the key can use.
- **Efforts and speed:** these come from Codex's model catalog when Codex is installed. *Fast* is OpenAI's Priority processing (`service_tier: "priority"`), with the speed-up the catalog gives for each model (1.5× or 2×).
- **Models Codex doesn't cover:** other current GPT models are listed with Low, Medium and High effort and no Fast tier.

Neither API offers a faster tier than Fast. *Default* effort sends no effort, so the model uses its own default; for GPT models the menu shows what that is.

**How each move runs.** Every move is one request: the chosen effort and speed, and strict JSON-schema output (the cell, or each ship's start and direction) with one sentence of reasoning and, with a shot, its updated notes.
- **Claude:** Claude requests use adaptive thinking.
- **Refusal fallback:** at standard speed, Opus 5.5, Opus 5, Sonnet 5.5 and Fable 5.1 also send Anthropic's server-side fallback (`fallbacks: "default"`). If the model declines a move on safety grounds, another model finishes the turn instead of the game stopping. Fast mode turns it off, because the fallback models don't all have fast mode.
- **Errors:** rate limits, rejected keys and declined moves show as readable errors with a *Retry move* button.

The Test mode model lists are in `MODELS` in `players.py`.

### Carrier cinematic audio

The carrier's jet now has a continuous ElevenLabs v3 engine loop from spool-up to impact, with rising throttle on deck, a steam-catapult stroke and launch whistle, then moving engine audio through climb and flight. Cockpit shots add airflow and a warning tone while muffling the exterior engine. The engine and wind follow the animation and camera, so slow motion or a speed change cannot leave the jet flying silently. Impact and reset stop the loops; mute still applies. `tests/carrier-audio-browser.html` provides a local launch and reset check.

### Open sound cues

The battle already plays these sound cues; they stay silent until a recording is added. Each is listed and described in `OPEN_CUES` in `static/js/theater/sound-bank.js`. To give one a sound, add a file to `static/audio/` and an entry with the same key to `SOUND_BANK`; nothing else changes.

- **Cinematic-camera radio:** `radioStrikeTasking`, `radioPilotReady`, `radioAirborne`, `radioCommit` and `radioFinal`, the calls between the carrier and the pilot. These play only with the cinematic camera.

## Quickstart

Install the Python dependencies:
```bash
python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt
```

For the CLIs connection, you also need:
- the [Claude Code CLI](https://code.claude.com), signed in (run `claude` once);
- the Codex CLI, signed in (`codex login`);
- Node.js 18 or later.

Then install the Codex SDK. The project's `.npmrc` skips the SDK's bundled Codex binary (about 350 MB) because the bridge uses your installed `codex`:
```bash
npm install
```

Run the app:
```bash
python app.py
```

Then open http://127.0.0.1:5001. For API mode, put your keys in `.env` (see *The API keys connection* above). Never commit a populated `.env` (it is in `.gitignore`). Finished live games (CLIs or API keys) are saved to `data/battle-history.json` and shown under *Universal stats* and *History*.

The CLIs and API connections have tests with stand-ins for `claude`, `codex`, `node` and the OpenAI and Anthropic clients, so they call no model and send nothing:
```bash
.venv/bin/python -m unittest tests/test_cli_connection.py tests/test_api_connection.py
```

## Controls

| Input | Action |
| --- | --- |
| Drag | Orbit the camera (switches to the free camera from the current view) |
| Right-drag | Pan (free camera) |
| Scroll / pinch | Zoom in or out, in any camera mode |
| `1` `2` `3` | Cinematic, tactical or free camera |
| `H` | Hide or show the overlay |
| `M` | Sound on or off |
| `F` | Full screen |

The speed button in the top left plays the battle at 1×, 2×, 4× or 8×.
- **1×** is a relaxed pace, so the shots, flights and cinematics can be followed. A carrier strike takes about 17 s from launch to impact.
- **2×** is the original pace, and 8× matches the old 4×.
- **What stays at its own speed:** the sea's waves always run at their natural speed, slowed only by the cinematic slow motion. Ships, buoys, the barrier's floats and debris ride the same water.
- **Sounds:** those that last as long as something in the battle (a shell's whistle, a torpedo's run, the strike jet) stretch to match the pace.
