import { SOUND_BANK, soundKey, loadSoundBank } from './sound-bank.js';

// Local ElevenLabs v3 recordings with Web Audio synthesis as a loading/offline fallback:
// missile and jet roars, torpedo runs, a hull groaning as it sinks, ship horns, fireworks and the sea.
// Every sound is placed by distance and direction from the camera; a convolution reverb gives the
// open-ocean echo, and distant events arrive a beat after their flash.
export class BattleAudio {
    constructor() {
        this.ctx = null;
        this.muted = false;
        try { this.muted = localStorage.getItem('battleship-muted') === '1'; } catch {}
        this.camera = null;
        this.tmp = {x: 0, y: 0, z: 0};
        this.samples = new Map();
        this.sampleVoices = new Set();
    }

    unlock() {
        if (!this.ctx) {
            const Context = window.AudioContext || window.webkitAudioContext;
            if (!Context) return;
            this.ctx = new Context();
            this.build();
        }
        if (this.ctx.state === 'suspended') this.ctx.resume();
    }

    build() {
        const ctx = this.ctx;
        this.master = ctx.createGain();
        this.master.gain.value = this.muted ? 0 : .8;
        const compressor = ctx.createDynamicsCompressor();
        compressor.threshold.value = -16;
        compressor.ratio.value = 5;
        compressor.attack.value = .004;
        compressor.release.value = .25;
        this.master.connect(compressor).connect(ctx.destination);
        this.reverb = ctx.createConvolver();
        this.reverb.buffer = this.impulse(3.2, 2.6);
        this.reverbGain = ctx.createGain();
        this.reverbGain.gain.value = .55;
        this.reverb.connect(this.reverbGain).connect(this.master);
        const length = ctx.sampleRate * 3;
        this.noise = ctx.createBuffer(1, length, ctx.sampleRate);
        const data = this.noise.getChannelData(0);
        for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
        this.brown = ctx.createBuffer(1, length, ctx.sampleRate);
        const brown = this.brown.getChannelData(0);
        let last = 0;
        for (let i = 0; i < length; i++) {
            last = (last + .02 * (Math.random() * 2 - 1)) / 1.02;
            brown[i] = last * 3.5;
        }
        this.ambience();
        this.ready = loadSoundBank(ctx, (key, buffer) => {
            this.samples.set(key, buffer);
            if (key === 'ocean') this.recordedAmbience(buffer);
        });
    }

    impulse(seconds, decay) {
        const ctx = this.ctx;
        const length = Math.floor(ctx.sampleRate * seconds);
        const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
        for (let c = 0; c < 2; c++) {
            const data = buffer.getChannelData(c);
            for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay) * (i < 400 ? i / 400 : 1);
        }
        return buffer;
    }

    setMuted(muted) {
        this.muted = muted;
        try { localStorage.setItem('battleship-muted', muted ? '1' : '0'); } catch {}
        if (this.master) this.master.gain.setTargetAtTime(muted ? 0 : .8, this.ctx.currentTime, .05);
    }

    setCamera(camera) {
        this.camera = camera;
    }

    // Gain, stereo pan and arrival delay for a sound at a world position.
    place(at) {
        if (!at || !this.camera) return {gain: 1, pan: 0, delay: 0};
        const c = this.camera.position;
        const dx = at.x - c.x, dy = (at.y || 0) - c.y, dz = at.z - c.z;
        const distance = Math.hypot(dx, dy, dz);
        const e = this.camera.matrixWorld.elements;
        const pan = Math.max(-1, Math.min(1, (dx * e[0] + dy * e[1] + dz * e[2]) / Math.max(distance, 1e-3))) * .75;
        return {gain: 1 / (1 + distance * .055), pan, delay: Math.min(.45, distance * .02)};
    }

    out(at, send = .4) {
        const ctx = this.ctx;
        const {gain, pan, delay} = this.place(at);
        const input = ctx.createGain();
        input.gain.value = gain;
        const panner = ctx.createStereoPanner();
        panner.pan.value = pan;
        input.connect(panner).connect(this.master);
        const wet = ctx.createGain();
        wet.gain.value = send;
        panner.connect(wet).connect(this.reverb);
        return {input, start: ctx.currentTime + delay,
            disconnect: () => { input.disconnect(); panner.disconnect(); wet.disconnect(); }};
    }

    playSample(kind, at, scale) {
        const key = soundKey(kind, scale);
        const buffer = this.samples.get(key);
        if (!buffer) return false;
        const spec = SOUND_BANK[key];
        const ctx = this.ctx;
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        // Preserve each weapon's character while avoiding identical repeated shots.
        const rate = .97 + Math.random() * .06;
        source.playbackRate.value = rate;
        const duration = spec.timed ? Math.max(.1, Math.min(scale, buffer.duration / rate)) : buffer.duration / rate;
        const output = this.out(at, key === 'creak' ? .16 : .08);
        const gain = ctx.createGain();
        const level = spec.gain * (spec.timed ? 1 : Math.min(1.5, Math.max(.15, scale)));
        gain.gain.setValueAtTime(0, output.start);
        gain.gain.linearRampToValueAtTime(level, output.start + .005);
        gain.gain.setValueAtTime(level, output.start + Math.max(.005, duration - .08));
        gain.gain.linearRampToValueAtTime(0, output.start + duration);
        source.connect(gain).connect(output.input);
        // Secondary explosions can overlap; bound their CPU and loudness cost.
        if (this.sampleVoices.size >= 24) {
            const oldest = this.sampleVoices.values().next().value;
            this.sampleVoices.delete(oldest);
            oldest.stop();
        }
        this.sampleVoices.add(source);
        source.onended = () => {
            this.sampleVoices.delete(source);
            source.disconnect(); gain.disconnect(); output.disconnect();
        };
        source.start(output.start);
        source.stop(output.start + duration);
        return true;
    }

    recordedAmbience(buffer) {
        const ctx = this.ctx;
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.loop = true;
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(SOUND_BANK.ocean.gain, ctx.currentTime + 1.5);
        source.connect(gain).connect(this.master);
        source.start();
        this.oceanSource = source;
        this.fallbackAmbienceGain.gain.setTargetAtTime(0, ctx.currentTime, .3);
        for (const node of this.fallbackAmbienceNodes) node.stop(ctx.currentTime + 2);
    }

    noiseSource(start, duration, offset = Math.random() * 2) {
        const source = this.ctx.createBufferSource();
        source.buffer = this.noise;
        source.start(start, offset, duration);
        return source;
    }

    envelope(param, start, attack, peak, decay, floor = .0001) {
        param.setValueAtTime(floor, start);
        param.linearRampToValueAtTime(peak, start + attack);
        param.exponentialRampToValueAtTime(floor, start + attack + decay);
    }

    filter(type, frequency, q = .7) {
        const node = this.ctx.createBiquadFilter();
        node.type = type;
        node.frequency.value = frequency;
        node.Q.value = q;
        return node;
    }

    boom(out, start, {from = 2600, to = 140, duration = 1.6, peak = 1, sub = 60, subTo = 28, subPeak = .9}) {
        const ctx = this.ctx;
        const lowpass = this.filter('lowpass', from);
        lowpass.frequency.setValueAtTime(from, start);
        lowpass.frequency.exponentialRampToValueAtTime(to, start + duration * .7);
        const gain = ctx.createGain();
        this.envelope(gain.gain, start, .004, peak, duration);
        this.noiseSource(start, duration + .1).connect(lowpass).connect(gain).connect(out);
        const osc = ctx.createOscillator();
        osc.frequency.setValueAtTime(sub, start);
        osc.frequency.exponentialRampToValueAtTime(subTo, start + duration * .6);
        const subGain = ctx.createGain();
        this.envelope(subGain.gain, start, .006, subPeak, duration * .7);
        osc.connect(subGain).connect(out);
        osc.start(start);
        osc.stop(start + duration + .1);
    }

    crackle(out, start, count, span, level = .25) {
        for (let i = 0; i < count; i++) {
            const t = start + Math.random() * span;
            const band = this.filter('bandpass', 1200 + Math.random() * 3200, 1.2);
            const gain = this.ctx.createGain();
            this.envelope(gain.gain, t, .002, level * (.4 + Math.random() * .6), .03 + Math.random() * .05);
            this.noiseSource(t, .1).connect(band).connect(gain).connect(out);
        }
    }

    play(kind, at, scale = 1) {
        if (!this.ctx || this.muted || this.ctx.state !== 'running') return;
        if (this.playSample(kind, at, scale)) return;
        // Distinct missile samples share the original rocket synthesis if unavailable.
        if (kind === 'missileLight' || kind === 'subMissile') kind = 'missile';
        const ctx = this.ctx;
        if (kind === 'cannon') {
            const {input, start} = this.out(at, .55);
            this.boom(input, start, {from: 3200, to: 160, duration: 1.1 + scale * .5, peak: .9 * scale, sub: 72, subTo: 30, subPeak: .8 * scale});
            this.crackle(input, start, 6, .25, .2);
        } else if (kind === 'explosion') {
            const {input, start} = this.out(at, .6);
            this.boom(input, start, {from: 2400, to: 110, duration: 2 + scale * .6, peak: 1.1 * scale, sub: 55, subTo: 24, subPeak: 1 * scale});
            this.crackle(input, start + .05, Math.round(16 * scale), 1.4, .28);
        } else if (kind === 'splash') {
            const {input, start} = this.out(at, .35);
            const band = this.filter('bandpass', 900, .6);
            const gain = ctx.createGain();
            this.envelope(gain.gain, start, .015, .7 * scale, 1.1);
            this.noiseSource(start, 1.4).connect(band).connect(gain).connect(input);
            const hiss = this.filter('highpass', 2800);
            const hissGain = ctx.createGain();
            this.envelope(hissGain.gain, start + .1, .2, .18 * scale, 1.6);
            this.noiseSource(start, 2).connect(hiss).connect(hissGain).connect(input);
            const thump = ctx.createOscillator();
            thump.frequency.setValueAtTime(95, start);
            thump.frequency.exponentialRampToValueAtTime(40, start + .25);
            const thumpGain = ctx.createGain();
            this.envelope(thumpGain.gain, start, .005, .5 * scale, .35);
            thump.connect(thumpGain).connect(input);
            thump.start(start);
            thump.stop(start + .5);
        } else if (kind === 'whistle') {
            const {input, start} = this.out(at, .25);
            const duration = scale;
            const osc = ctx.createOscillator();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(1700, start);
            osc.frequency.exponentialRampToValueAtTime(480, start + duration);
            const vibrato = ctx.createOscillator();
            vibrato.frequency.value = 9;
            const depth = ctx.createGain();
            depth.gain.value = 14;
            vibrato.connect(depth).connect(osc.frequency);
            const gain = ctx.createGain();
            gain.gain.setValueAtTime(.0001, start);
            gain.gain.exponentialRampToValueAtTime(.09, start + duration * .85);
            gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
            osc.connect(gain).connect(input);
            osc.start(start);
            vibrato.start(start);
            osc.stop(start + duration + .05);
            vibrato.stop(start + duration + .05);
        } else if (kind === 'missile') {
            const {input, start} = this.out(at, .45);
            const band = this.filter('bandpass', 650, .5);
            band.frequency.setValueAtTime(380, start);
            band.frequency.exponentialRampToValueAtTime(1100, start + 1.4);
            const gain = ctx.createGain();
            gain.gain.setValueAtTime(.0001, start);
            gain.gain.exponentialRampToValueAtTime(.8, start + .12);
            gain.gain.exponentialRampToValueAtTime(.0001, start + 2.4);
            this.noiseSource(start, 2.5).connect(band).connect(gain).connect(input);
            this.boom(input, start, {from: 1800, to: 160, duration: 1.1 * scale, peak: .7 * scale, sub: 58, subTo: 32, subPeak: .6 * scale});
            this.crackle(input, start + .05, Math.round(22 * scale), 1.6, .22);
        } else if (kind === 'jet') {
            const {input, start} = this.out(at, .4);
            const low = this.filter('lowpass', 500, .8);
            low.frequency.setValueAtTime(400, start);
            low.frequency.exponentialRampToValueAtTime(2400, start + scale * .55);
            low.frequency.exponentialRampToValueAtTime(500, start + scale);
            const gain = ctx.createGain();
            gain.gain.setValueAtTime(.0001, start);
            gain.gain.exponentialRampToValueAtTime(.7, start + scale * .5);
            gain.gain.exponentialRampToValueAtTime(.0001, start + scale);
            this.noiseSource(start, scale + .1).connect(low).connect(gain).connect(input);
        } else if (kind === 'torpedo') {
            const {input, start} = this.out(at, .3);
            const low = this.filter('lowpass', 420, 2);
            const gain = ctx.createGain();
            gain.gain.value = 0;
            const lfo = ctx.createOscillator();
            lfo.type = 'square';
            lfo.frequency.value = 17;
            const depth = ctx.createGain();
            depth.gain.value = .12;
            lfo.connect(depth).connect(gain.gain);
            const fade = ctx.createGain();
            fade.gain.setValueAtTime(.0001, start);
            fade.gain.exponentialRampToValueAtTime(1, start + .2);
            fade.gain.exponentialRampToValueAtTime(.0001, start + scale);
            this.noiseSource(start, scale + .1).connect(low).connect(gain).connect(fade).connect(input);
            lfo.start(start);
            lfo.stop(start + scale + .1);
            this.boom(input, start, {from: 900, to: 120, duration: .5, peak: .35, sub: 80, subTo: 45, subPeak: .5});
        } else if (kind === 'creak') {
            const {input, start} = this.out(at, .8);
            for (const [base, delay] of [[42, 0], [57, .9], [38, 2.1]]) {
                const osc = ctx.createOscillator();
                osc.type = 'sawtooth';
                osc.frequency.setValueAtTime(base, start + delay);
                osc.frequency.linearRampToValueAtTime(base * 1.25, start + delay + 1.4);
                const band = this.filter('bandpass', 260, 9);
                band.frequency.setValueAtTime(220, start + delay);
                band.frequency.exponentialRampToValueAtTime(620, start + delay + 1);
                band.frequency.exponentialRampToValueAtTime(240, start + delay + 2.2);
                const gain = ctx.createGain();
                this.envelope(gain.gain, start + delay, .5, .55, 2.2);
                osc.connect(band).connect(gain).connect(input);
                osc.start(start + delay);
                osc.stop(start + delay + 3);
            }
            const bubbles = this.filter('lowpass', 700, 4);
            const gain = ctx.createGain();
            this.envelope(gain.gain, start + .5, 1, .4, 4);
            this.noiseSource(start, 5.5).connect(bubbles).connect(gain).connect(input);
        } else if (kind === 'horn') {
            const {input, start} = this.out(at, .7);
            const low = this.filter('lowpass', 850, 1.5);
            const gain = ctx.createGain();
            gain.gain.setValueAtTime(.0001, start);
            gain.gain.exponentialRampToValueAtTime(.35, start + .18);
            gain.gain.setValueAtTime(.35, start + 1.5);
            gain.gain.exponentialRampToValueAtTime(.0001, start + 2.1);
            for (const f of [98, 147, 98.6]) {
                const osc = ctx.createOscillator();
                osc.type = 'sawtooth';
                osc.frequency.value = f;
                osc.connect(low);
                osc.start(start);
                osc.stop(start + 2.2);
            }
            low.connect(gain).connect(input);
        } else if (kind === 'firework') {
            const {input, start} = this.out(at, .6);
            const pop = this.filter('highpass', 600);
            const gain = ctx.createGain();
            this.envelope(gain.gain, start, .002, .6 * scale, .18);
            this.noiseSource(start, .3).connect(pop).connect(gain).connect(input);
            this.boom(input, start, {from: 1800, to: 200, duration: .8, peak: .35, sub: 70, subTo: 40, subPeak: .3});
            this.crackle(input, start + .5, 28, 1.6, .16);
        } else if (kind === 'lock') {
            const start = ctx.currentTime;
            [0, .09].forEach((offset, i) => {
                const osc = ctx.createOscillator();
                osc.frequency.value = i ? 1760 : 1320;
                const gain = ctx.createGain();
                this.envelope(gain.gain, start + offset, .004, .05, .07);
                osc.connect(gain).connect(this.master);
                osc.start(start + offset);
                osc.stop(start + offset + .1);
            });
        } else if (kind === 'turret') {
            const {input, start} = this.out(at, .2);
            const osc = ctx.createOscillator();
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(180, start);
            osc.frequency.linearRampToValueAtTime(240, start + .35);
            osc.frequency.linearRampToValueAtTime(170, start + .6);
            const band = this.filter('bandpass', 600, 3);
            const gain = ctx.createGain();
            this.envelope(gain.gain, start, .08, .05, .55);
            osc.connect(band).connect(gain).connect(input);
            osc.start(start);
            osc.stop(start + .7);
        }
    }

    // The sea and wind, always there under the battle.
    ambience() {
        const ctx = this.ctx;
        this.fallbackAmbienceGain = ctx.createGain();
        this.fallbackAmbienceGain.connect(this.master);
        const sea = ctx.createBufferSource();
        sea.buffer = this.brown;
        sea.loop = true;
        const low = this.filter('lowpass', 520, .5);
        const gain = ctx.createGain();
        gain.gain.value = .22;
        const swell = ctx.createOscillator();
        swell.frequency.value = .09;
        const swellDepth = ctx.createGain();
        swellDepth.gain.value = .09;
        swell.connect(swellDepth).connect(gain.gain);
        sea.connect(low).connect(gain).connect(this.fallbackAmbienceGain);
        const wind = ctx.createBufferSource();
        wind.buffer = this.noise;
        wind.loop = true;
        const band = this.filter('bandpass', 420, .4);
        const windGain = ctx.createGain();
        windGain.gain.value = .018;
        const gust = ctx.createOscillator();
        gust.frequency.value = .05;
        const gustDepth = ctx.createGain();
        gustDepth.gain.value = .012;
        gust.connect(gustDepth).connect(windGain.gain);
        wind.connect(band).connect(windGain).connect(this.fallbackAmbienceGain);
        for (const node of [sea, swell, wind, gust]) node.start();
        this.fallbackAmbienceNodes = [sea, swell, wind, gust];
    }
}
