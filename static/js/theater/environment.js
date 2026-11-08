import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

// Golden-hour sky, sun and image-based lighting. The physically based Preetham sky (with its cloud layer)
// is both the backdrop and, through a PMREM capture, the reflections on every ship.
export const SUN = {
    elevation: 42,       // high afternoon sun: bright, natural light and a deep blue sea
    azimuth: -40,        // front left: ships and the barrier's near face are lit in every camera move
};

export function sunDirection(elevation = SUN.elevation, azimuth = SUN.azimuth) {
    const phi = THREE.MathUtils.degToRad(90 - elevation);
    const theta = THREE.MathUtils.degToRad(azimuth);
    return new THREE.Vector3().setFromSphericalCoords(1, phi, theta);
}

// The Preetham model's units run several times brighter than the sunlight on the ships. Scaling the sky keeps
// sunlit paint, the sky and its reflection on the water in their real-world ratios, so a white cloud mirrored
// in the sea no longer outshines a sunlit hull (and no longer floods the frame through the bloom).
const SKY_INTENSITY = .3;

function scaleSky(material, intensity) {
    material.uniforms.skyIntensity = {value: intensity};
    material.fragmentShader = 'uniform float skyIntensity;\n' + material.fragmentShader.replace('gl_FragColor = vec4( texColor, 1.0 );', 'gl_FragColor = vec4( texColor * skyIntensity, 1.0 );');
}

export function createEnvironment(renderer, scene) {
    const sun = sunDirection();
    const sky = new Sky();
    sky.scale.setScalar(9000);
    sky.frustumCulled = false;
    const u = sky.material.uniforms;
    u.turbidity.value = 3.4;
    u.rayleigh.value = 1.25;
    u.mieCoefficient.value = .004;
    u.mieDirectionalG.value = .84;
    u.sunPosition.value.copy(sun).multiplyScalar(450000);
    u.cloudCoverage.value = .32;
    u.cloudDensity.value = .48;
    u.cloudElevation.value = .62;
    u.cloudScale.value = .00022;
    u.cloudSpeed.value = .00004;
    scaleSky(sky.material, SKY_INTENSITY);
    scene.add(sky);

    // Reflections come from a capture of the sky without its sun disc (the sun is a separate light). It is
    // captured again whenever the sun has moved far enough to change the sky.
    const capture = new THREE.Scene();
    const skyCopy = new Sky();
    skyCopy.scale.setScalar(9000);
    skyCopy.material.uniforms = THREE.UniformsUtils.clone(sky.material.uniforms);
    skyCopy.material.uniforms.showSunDisc.value = 0;
    scaleSky(skyCopy.material, SKY_INTENSITY);
    capture.add(skyCopy);
    const pmrem = new THREE.PMREMGenerator(renderer);
    let envTarget = null;
    const captureSky = () => {
        const cu = skyCopy.material.uniforms;
        for (const key of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG']) cu[key].value = u[key].value;
        cu.sunPosition.value.copy(u.sunPosition.value);
        const next = pmrem.fromScene(capture, 0, .1, 12000);
        scene.environment = next.texture;
        envTarget?.dispose();
        envTarget = next;
    };
    scene.environmentIntensity = 1.05;

    // The sun, with soft shadows over both fleets.
    const key = new THREE.DirectionalLight(new THREE.Color(1, .96, .9), 3.1);
    key.position.copy(sun).multiplyScalar(60);
    key.target.position.set(0, 0, 0);
    key.castShadow = true;
    key.shadow.mapSize.set(4096, 4096);
    Object.assign(key.shadow.camera, {left: -15, right: 15, top: 14, bottom: -14, near: 20, far: 110});
    key.shadow.bias = -.0002;
    key.shadow.normalBias = .006;
    key.shadow.radius = 2;
    scene.add(key, key.target);
    // Cool skylight from the other side keeps shadowed hulls from going black.
    const hemi = new THREE.HemisphereLight(new THREE.Color(.62, .73, .95), new THREE.Color(.1, .15, .22), .24);
    scene.add(hemi);

    // Distance haze in the color of the horizon behind the fleets.
    const horizon = new THREE.Color(.62, .7, .8);
    scene.fog = new THREE.FogExp2(horizon, .003);

    const env = {
        sky, sun, key, hemi, horizon,
        // Sunlight on the water (ocean shader) and on smoke and fireballs: shared, so a new time of day reaches all.
        sunColor: new THREE.Color(1, .95, .88).multiplyScalar(3),
        particleSun: new THREE.Color(1, .97, .92).multiplyScalar(1.45),
        exposure: .56,
        time: null,
        drift: 0,
        captured: 0,
        // Set the time of day: where the sun stands and the colour of its light, the sky's haze, the horizon.
        setTime(name, {drift = 0} = {}) {
            const t = TIMES[name] || TIMES.afternoon;
            env.time = name;
            env.drift = drift;
            const elevation = t.elevation + drift;
            sun.copy(sunDirection(elevation, t.azimuth));
            u.sunPosition.value.copy(sun).multiplyScalar(450000);
            u.turbidity.value = t.turbidity;
            u.rayleigh.value = t.rayleigh;
            u.mieCoefficient.value = t.mie;
            const warm = THREE.MathUtils.smoothstep(25, 4, elevation);
            key.color.setRGB(...t.light).lerp(new THREE.Color(1, .62, .38), warm * .5);
            key.intensity = t.intensity * (.55 + .45 * THREE.MathUtils.smoothstep(2, 30, elevation));
            hemi.color.setRGB(...t.skylight);
            horizon.setRGB(...t.horizon);
            scene.fog.color.copy(horizon);
            env.sunColor.copy(key.color).multiplyScalar(3 * key.intensity / 3.1);
            env.particleSun.copy(key.color).multiplyScalar(1.45 * key.intensity / 3.1);
            env.exposure = t.exposure;
            if (Math.abs(elevation - env.captured) > 2.5 || !envTarget) {
                captureSky();
                env.captured = elevation;
            }
        },
        update(time) {
            u.time.value = time;
        },
    };
    env.setTime('afternoon');
    Object.defineProperty(env, 'environment', {get: () => scene.environment});
    return env;
}

// Times of day: sun elevation and azimuth (degrees), its light (colour, intensity), the sky's haze, the skylight
// colour, the horizon haze, and the exposure that keeps the image balanced.
export const TIMES = {
    morning: {elevation: 21, azimuth: -72, light: [1, .9, .78], intensity: 2.7, turbidity: 4.6, rayleigh: 1.7, mie: .005, skylight: [.6, .7, .92], horizon: [.7, .7, .76], exposure: .6},
    midday: {elevation: 60, azimuth: -28, light: [1, .98, .95], intensity: 3.3, turbidity: 2.6, rayleigh: 1, mie: .0035, skylight: [.6, .72, .96], horizon: [.6, .7, .82], exposure: .53},
    afternoon: {elevation: 42, azimuth: -40, light: [1, .96, .9], intensity: 3.1, turbidity: 3.4, rayleigh: 1.25, mie: .004, skylight: [.62, .73, .95], horizon: [.62, .7, .8], exposure: .56},
    golden: {elevation: 12, azimuth: -55, light: [1, .76, .52], intensity: 2.5, turbidity: 6, rayleigh: 2.3, mie: .006, skylight: [.55, .6, .8], horizon: [.82, .68, .6], exposure: .66},
};
