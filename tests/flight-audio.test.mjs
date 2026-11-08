import test from 'node:test';
import assert from 'node:assert/strict';
import {flightDoppler, flightEngine} from '../static/js/theater/flight-audio.js';

test('opening-speed approach stays above neutral pitch and transitions continuously', () => {
    assert.ok(flightDoppler(6) > 1);
    assert.ok(flightDoppler(-6) < 1);
    assert.equal(flightDoppler(0), 1);
    let previous=0;
    for(let closing=-8; closing<=8; closing+=.01) {
        const value=flightDoppler(closing);
        assert.ok(Number.isFinite(value) && value>=.625 && value<=1/.55);
        assert.ok(value >= previous);
        if(previous)assert.ok(value-previous<.01);
        previous=value;
    }
});

test('a formation started before unlock recovers and upgrades its fallback once', () => {
    const audio={ctx:null, samples:new Map(), starts:0, startLoop(kind, at, options) {
        this.starts++; assert.equal(kind,'jetEngine'); assert.equal(at.x,3);
        assert.equal(options.pool,'formation');
        return {active:true, recorded:this.samples.has(kind), stop(){this.active=false;}};
    }};
    let voice=flightEngine(audio,null,{x:3});
    assert.equal(voice,null); assert.equal(audio.starts,0);
    audio.ctx={};
    voice=flightEngine(audio,voice,{x:3});
    const fallback=voice;
    assert.equal(voice.recorded,false);
    assert.equal(flightEngine(audio,voice,{x:3}),voice);
    audio.samples.set('jetEngine',{});
    voice=flightEngine(audio,voice,{x:3});
    assert.equal(fallback.active,false); assert.equal(voice.recorded,true);
    assert.equal(audio.starts,2);
    assert.equal(flightEngine(audio,voice,{x:3}),voice);
    voice.stop();
    assert.equal(flightEngine(audio,voice,{x:3}),voice); // No voice-cap restart loop.
    assert.equal(audio.starts,2);
});
