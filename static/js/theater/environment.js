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

    // Reflections come from a capture of the sky without its sun disc (the sun is a separate light).
    const capture = new THREE.Scene();
    const skyCopy = new Sky();
    skyCopy.scale.setScalar(9000);
    skyCopy.material.uniforms = THREE.UniformsUtils.clone(sky.material.uniforms);
    skyCopy.material.uniforms.showSunDisc.value = 0;
    scaleSky(skyCopy.material, SKY_INTENSITY);
    capture.add(skyCopy);
    const pmrem = new THREE.PMREMGenerator(renderer);
    const environment = pmrem.fromScene(capture, 0, .1, 12000).texture;
    pmrem.dispose();
    skyCopy.geometry.dispose();
    skyCopy.material.dispose();
    scene.environment = environment;
    scene.environmentIntensity = 1.05;

    // The sun: warm and low, with soft shadows over both fleets.
    const key = new THREE.DirectionalLight(new THREE.Color(1, .96, .9), 3.1);
    key.position.copy(sun).multiplyScalar(60);
    key.target.position.set(0, 0, 0);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, {left: -15, right: 15, top: 14, bottom: -14, near: 20, far: 110});
    key.shadow.bias = -.00025;
    key.shadow.normalBias = .012;
    key.shadow.radius = 3;
    scene.add(key, key.target);
    // Cool skylight from the other side keeps shadowed hulls from going black.
    const hemi = new THREE.HemisphereLight(new THREE.Color(.62, .73, .95), new THREE.Color(.1, .15, .22), .24);
    scene.add(hemi);

    // Distance haze in the color of the horizon behind the fleets.
    const horizon = new THREE.Color(.62, .7, .8);
    scene.fog = new THREE.FogExp2(horizon, .003);

    return {
        sky, sun, key, hemi, environment, horizon,
        sunColor: new THREE.Color(1, .95, .88).multiplyScalar(3),
        update(time) {
            u.time.value = time;
        },
    };
}
