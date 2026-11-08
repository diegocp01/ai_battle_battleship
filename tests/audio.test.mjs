import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {SOUND_BANK, loadSoundBank, soundKey} from '../static/js/theater/sound-bank.js';
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
    const events = [];
    const param = () => ({value: 0, setValueAtTime(...v) {events.push(['set', ...v]);},
        linearRampToValueAtTime(...v) {events.push(['ramp', ...v]);}, setTargetAtTime() {}});
    const node = () => ({gain: param(), playbackRate: param(), pan: param(),
        connect(other) {return other;}, disconnect() {this.disconnected = true;},
        start(t) {this.started = t;}, stop(t) {this.stopped = t ?? 0;}});
    const audio = new BattleAudio();
    audio.ctx = {state: 'running', currentTime: 10, createBufferSource: node,
        createGain: node, createStereoPanner: node};
    audio.master = node(); audio.reverb = node();
    return {audio, events};
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
