import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {SOUND_BANK, loadSoundBank, soundKey, impactVoice} from '../static/js/theater/sound-bank.js';
import {BattleAudio} from '../static/js/theater/audio.js';

test('heavy guns and all three missile families have independent recordings', () => {
    assert.equal(soundKey('cannon', 1.5), 'cannonHeavy');
    assert.equal(soundKey('cannon', .7), 'cannon');
    const keys = ['missile', 'missileLight', 'subMissile', 'cannon', 'cannonHeavy'];
    assert.equal(new Set(keys.map(k => SOUND_BANK[k].file)).size, keys.length);
});

test('a failed download or decoder does not prevent remaining sounds loading', async () => {
    const loaded = new Map();
    let active = 0, peak = 0;
    await loadSoundBank({decodeAudioData: async data => {
        if (data.includes('ship-hit')) throw new Error('unsupported');
        return data;
    }}, (k, b) => loaded.set(k, b), async url => {
        peak = Math.max(peak, ++active);
        await new Promise(resolve => setTimeout(resolve, 2));
        active--;
        return {ok: !url.includes('missile-light'), status: 404, arrayBuffer: async () => url};
    });
    assert.ok(peak <= 3);
    assert.equal(loaded.size, Object.keys(SOUND_BANK).length - 2);
    assert.ok(loaded.has('ocean'));
});

function mockAudio() {
    const events = [], filters = [], sources = [], gains = [];
    const param = () => ({value: 0, setValueAtTime(...v) {events.push(['set', ...v]);},
        linearRampToValueAtTime(...v) {events.push(['ramp', ...v]);}, setTargetAtTime(v) {this.value = v;}, cancelScheduledValues() {}});
    const node = () => ({gain: param(), playbackRate: param(), pan: param(), frequency: param(), Q: param(),
        connect(other) {return other;}, disconnect() {this.disconnected = true;},
        start(t) {this.started = t;}, stop(t) {this.stopped = t ?? 0;}});
    const audio = new BattleAudio();
    audio.ctx = {state: 'running', currentTime: 10, createBufferSource() {const source=node(); sources.push(source); return source;},
        createGain() {const gain=node(); gains.push(gain); return gain;}, createStereoPanner: node,
        createBiquadFilter() {const filter = node(); filters.push(filter); return filter;}};
    audio.master = node(); audio.reverb = node();
    return {audio, events, filters, sources, gains};
}

test('recorded playback preserves spatial delay, scale, cleanup and voice cap', () => {
    const {audio} = mockAudio();
    audio.place = () => ({gain: .5, pan: -.4, delay: .2});
    audio.samples.set('missile', {duration: 4});
    audio.play('missile', {x: 1}, 1.3);
    const first = [...audio.sampleVoices][0];
    assert.equal(first.started, 10.2);
    assert.ok(first.stopped > 14 && first.stopped < 14.4);
    assert.ok(first.playbackRate.value >= .97 && first.playbackRate.value <= 1.03);
    first.onended();
    assert.equal(audio.sampleVoices.size, 0);
    assert.ok(first.disconnected);
    for (let i = 0; i < 30; i++) audio.play('missile');
    assert.equal(audio.sampleVoices.size, 24);
});

test('mute and suspended context suppress new events; unavailable variants fall back', () => {
    const {audio} = mockAudio();
    audio.samples.set('missile', {duration: 4});
    audio.muted = true; audio.play('missile');
    audio.muted = false; audio.ctx.state = 'suspended'; audio.play('missile');
    assert.equal(audio.sampleVoices.size, 0);
    assert.equal(audio.playSample('subMissile', null, 1), false);
});

test('timed recordings stop with their flight instead of playing a long tail', () => {
    const {audio} = mockAudio();
    audio.samples.set('jet', {duration: 5});
    audio.play('jet', null, 1.25);
    assert.equal([...audio.sampleVoices][0].stopped, 11.25);
});

test('every configured sound is a real nonempty WAV with its own content', async () => {
    const fingerprints = new Set();
    for (const {file} of Object.values(SOUND_BANK)) {
        const data = await readFile(new URL(`../static/audio/elevenlabs-v3/${file}`, import.meta.url));
        assert.equal(data.toString('ascii', 0, 4), 'RIFF');
        assert.equal(data.toString('ascii', 8, 12), 'WAVE');
        assert.ok(data.length > 10000, file);
        fingerprints.add(data.toString('base64'));
    }
    assert.equal(fingerprints.size, Object.keys(SOUND_BANK).length);
});


test('impact recordings follow the projectile, with hull and water coloration', () => {
    const cases = {gun: 'impactShell', salvo: 'impactAP', missile: 'explosion',
        subMissile: 'explosion', strike: 'impactJet', torpedo: 'impactUnderwater'};
    for (const [weapon, expected] of Object.entries(cases)) {
        assert.equal(soundKey('explosion', 1, {weapon}), expected);
        assert.equal(soundKey('splash', 1, {weapon}), 'splash');
    }
    assert.equal(soundKey('explosion', 1), 'explosion');
    assert.ok(impactVoice({weapon:'gun', mass:2.4}).rate > impactVoice({weapon:'gun', mass:31.75}).rate);
    assert.ok(impactVoice({weapon:'missile', ship:'Battleship'}).rate < impactVoice({weapon:'missile', ship:'Destroyer'}).rate);
    assert.equal(impactVoice({weapon:'missile', waterline:true}).cutoff, 6500);
    assert.equal(impactVoice({weapon:'torpedo'}).cutoff, 1800);
    assert.equal(impactVoice({weapon:'missile', ship:'Submarine'}).cutoff, 0);
    assert.deepEqual(impactVoice(), {rate:1, cutoff:0});
});

test('impact playback selects its sample, filters wet hits, cleans up, and falls back', () => {
    const {audio, filters} = mockAudio();
    const fallback = {duration:4}, underwater = {duration:4};
    audio.samples.set('explosion', fallback);
    audio.samples.set('impactUnderwater', underwater);
    audio.play('explosion', null, 1, {weapon:'torpedo', ship:'Battleship'});
    const voice = [...audio.sampleVoices][0];
    assert.equal(voice.buffer, underwater);
    assert.ok(voice.playbackRate.value >= .99 * .985 && voice.playbackRate.value <= 1.01 * .985);
    assert.equal(filters[0].type, 'lowpass');
    assert.equal(filters[0].frequency.value, 1800);
    voice.onended();
    assert.ok(filters[0].disconnected);
    assert.equal(audio.sampleVoices.size, 0);
    audio.play('explosion', null, 1, {weapon:'strike'});
    assert.equal([...audio.sampleVoices][0].buffer, fallback);
    audio.samples.clear();
    assert.equal(audio.playSample('explosion', null, 1, {weapon:'torpedo'}), false);
});


test('carrier engine stays alive beyond its sample and follows the moving jet until stopped', () => {
    const {audio, sources, filters, gains} = mockAudio();
    audio.samples.set('jetEngine', {duration:8});
    audio.place = at => ({gain:at.x === 1 ? .8 : .2, pan:at.x === 1 ? -.5 : .5});
    const loop = audio.startLoop('jetEngine', {x:1}, {level:1, rate:.8, cutoff:1200});
    assert.equal(sources[0].loop, true);
    assert.equal(sources[0].stopped, undefined);
    assert.equal(sources[0].playbackRate.value, .8);
    const nearGain = gains[0].gain.value;
    audio.ctx.currentTime = 40; // A slow cinematic lasts much longer than the recording.
    audio.pace = .25;
    loop.update({x:2}, {level:1, rate:1.1, cutoff:6000});
    assert.ok(gains[0].gain.value < nearGain);
    assert.equal(filters[0].frequency.value, 6000);
    assert.equal(sources[0].playbackRate.value, 1.1);
    assert.equal(sources[0].stopped, undefined);
    loop.stop(); loop.stop();
    assert.equal(audio.loopVoices.size, 0);
    assert.equal(sources[0].stopped, 40.12);
    sources[0].onended();
    assert.ok(sources[0].disconnected && filters[0].disconnected);
});

test('continuous flight audio survives mute, has a bounded fallback, and stops on reset', () => {
    const {audio, sources} = mockAudio();
    audio.brown = {duration:3}; audio.noise = {duration:3};
    audio.muted = true;
    const engine = audio.startLoop('jetEngine', null);
    assert.equal(sources[0].buffer, audio.brown);
    audio.startLoop('cockpitWind', null);
    assert.equal(sources[1].buffer, audio.noise);
    for (let i=0;i<5;i++) audio.startLoop('jetEngine', null);
    assert.equal(audio.loopVoices.size, 4);
    assert.ok(sources[0].stopped > 10);
    audio.stopLoops();
    assert.equal(audio.loopVoices.size, 0);
    assert.ok(sources.every(source => source.stopped > 10));
    engine.update(null); // A stale animation callback cannot revive a stopped voice.
    assert.equal(audio.loopVoices.size, 0);
    assert.doesNotThrow(() => new BattleAudio().startLoop('jetEngine', null).stop());
});


test('missile hit precedes dry rubble, while secondary pops never replay the primary blast', () => {
    const {audio, sources, events} = mockAudio();
    audio.samples.set('explosion', {duration:3});
    audio.samples.set('impactRubble', {duration:2.5});
    audio.samples.set('impactSecondary', {duration:1.5});
    const sends=[], out=audio.out.bind(audio);
    audio.out=(at, send)=>{sends.push(send);return out(at, send);};
    audio.play('explosion', null, 4, {weapon:'missile', ship:'Battleship'});
    assert.equal(sources.length, 2);
    assert.equal(sources[0].buffer, audio.samples.get('explosion'));
    assert.equal(sources[1].buffer, audio.samples.get('impactRubble'));
    assert.ok(Math.abs(sources[1].started - sources[0].started - .18)<1e-8);
    assert.deepEqual(sends, [0, 0]);
    assert.ok(events.some(([kind, level, time])=>kind==='ramp' && level>0 && level<=1.05 && Math.abs(time-10.0008)<1e-8));
    audio.play('explosion', null, .2, {secondary:true});
    assert.equal(sources[2].buffer, audio.samples.get('impactSecondary'));
    assert.equal(sources.length, 3);
    audio.samples.delete('impactSecondary');
    audio.play('explosion', null, .2, {secondary:true});
    assert.equal(sources.length, 3); // Missing optional cook-off stays quiet.
    for (const source of sources) source.onended();
    assert.equal(audio.sampleVoices.size, 0);
});
