import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLSL_NOISE } from './textures.js';

// The barrier between the two fleets, so neither side can see the other's ships: a long, thin wall of
// precast concrete running from behind the camera to the horizon, with a boom of yellow floats along its
// waterline on both sides. The concrete is shaded in world space: soft mottling, fine aggregate up close,
// faint vertical panel joints, rain streaks, and a dark wet band where the swell washes against it.
export const WALL = {
    zMin: -95,            // runs to the horizon…
    zMax: 48,             // …and past the camera
    baseHalf: .2,         // half thickness at the waterline
    topHalf: .13,         // half thickness under the coping
    height: 2.85,
    copingHalf: .165,
    copingTop: 2.96,
};
// Highest point a round must clear when it crosses the wall.
export const WALL_CLEARANCE = WALL.copingTop + .45;

const concreteChunk = /* glsl */`
${GLSL_NOISE}
varying vec3 vWallPos;
varying vec3 vWallNormal;
float wallHeight;
vec3 wallTriplanar(vec3 p, vec3 n) {
    vec3 a = abs(n); a /= (a.x + a.y + a.z + 1e-4);
    vec2 px = p.zy, py = p.xz, pz = p.xy;
    float hx = fbm(px * .55, vec2(1e4), 4), hy = fbm(py * .55, vec2(1e4), 4), hz = fbm(pz * .55, vec2(1e4), 4);
    float fx = fbm(px * 17., vec2(1e4), 3), fy = fbm(py * 17., vec2(1e4), 3), fz = fbm(pz * 17., vec2(1e4), 3);
    float sx = fbm(vec2(px.x * 9., px.y * .7), vec2(1e4), 3), sz = fbm(vec2(pz.x * 9., pz.y * .7), vec2(1e4), 3);
    return vec3(hx * a.x + hy * a.y + hz * a.z, fx * a.x + fy * a.y + fz * a.z, sx * a.x + sz * a.z);
}
`;

function concreteMaterial() {
    const material = new THREE.MeshStandardMaterial({color: 0x7b7975, roughness: .85, metalness: 0, envMapIntensity: .55});
    material.onBeforeCompile = (shader) => {
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', '#include <common>\nvarying vec3 vWallPos;\nvarying vec3 vWallNormal;')
            .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
                vWallPos = (modelMatrix * vec4(transformed, 1.)).xyz;
                vWallNormal = normalize(mat3(modelMatrix) * objectNormal);`);
        shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', '#include <common>\n' + concreteChunk)
            .replace('#include <map_fragment>', `#include <map_fragment>
                vec3 wn = normalize(vWallNormal);
                vec3 detail = wallTriplanar(vWallPos, wn);
                float near = 1. - smoothstep(2., 9., distance(cameraPosition, vWallPos));
                float blotch = detail.x + .5, grain = mix(.5, detail.y + .5, near), rain = detail.z + .5;
                float vertical = 1. - abs(wn.y);
                // Precast panels 1.6 long: a faint vertical joint between each.
                float joint = abs(fract(vWallPos.z / 1.6) - .5) * 1.6;
                float seam = smoothstep(.785, .8, joint) * vertical * mix(.6, 1., near);
                float bugHoles = smoothstep(.75, .8, fbm(vWallPos.zy * 29., vec2(1e4), 3) + .5) * near;
                wallHeight = (grain * .45 - bugHoles * .45) * near - seam * .6 + blotch * .1;
                vec3 concrete = diffuseColor.rgb * mix(.86, 1.05, blotch) * mix(.95, 1.03, grain);
                concrete *= 1. - seam * .28 - bugHoles * .18;
                // Rain streaks, strongest under the coping.
                float underCap = smoothstep(${(WALL.height - 1.6).toFixed(2)}, ${WALL.height.toFixed(2)}, vWallPos.y);
                concrete *= 1. - smoothstep(.45, .85, rain) * vertical * (.14 + underCap * .16);
                // The splash zone: wet and dark, weed-stained, with a dried salt line above it.
                float splash = 1. - smoothstep(.1, .5, vWallPos.y + (grain - .5) * .16 + sin(vWallPos.z * 2.7) * .04);
                concrete = mix(concrete, concrete * vec3(.4, .43, .38), splash);
                concrete = mix(concrete, vec3(.15, .19, .12), splash * smoothstep(.45, .75, blotch) * .5);
                float salt = exp(-pow((vWallPos.y - .58 - (blotch - .5) * .1) / .05, 2.)) * vertical;
                concrete = mix(concrete, concrete * 1.15 + .03, salt * .45);
                concrete *= mix(1., .86, smoothstep(.7, 1., wn.y));
                diffuseColor.rgb = concrete;`)
            .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
                roughnessFactor = mix(roughnessFactor, .3, splash * .85) - grain * .05;`)
            .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
                {
                    vec3 sigmaX = dFdx(-vViewPosition), sigmaY = dFdy(-vViewPosition);
                    vec3 r1 = cross(sigmaY, normal), r2 = cross(normal, sigmaX);
                    float det = dot(sigmaX, r1);
                    vec2 dh = vec2(dFdx(wallHeight), dFdy(wallHeight)) * .16;
                    vec3 grad = sign(det) * (dh.x * r1 + dh.y * r2);
                    normal = normalize(abs(det) * normal - grad);
                }`);
    };
    material.customProgramCacheKey = () => 'sea-wall-concrete-2';
    return material;
}

// A solid with a constant cross-section in the x–y plane, run along z between two depths.
function extrudeAlongZ(profile, z0, z1) {
    const shape = new THREE.Shape(profile.map(([x, y]) => new THREE.Vector2(x, y)));
    const geometry = new THREE.ExtrudeGeometry(shape, {depth: z1 - z0, bevelEnabled: false});
    geometry.translate(0, 0, z0);
    const g = geometry.toNonIndexed();
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal'].includes(name)) g.deleteAttribute(name);
    return g;
}

export function createSeaWall(scene) {
    const group = new THREE.Group();
    group.name = 'sea-wall';
    const W = WALL;
    // Built in sections so each is culled on its own when off screen.
    const material = concreteMaterial();
    const sections = 11;
    for (let i = 0; i < sections; i++) {
        const z0 = W.zMin + (W.zMax - W.zMin) * i / sections, z1 = W.zMin + (W.zMax - W.zMin) * (i + 1) / sections;
        const body = extrudeAlongZ([[-W.baseHalf - .06, -1.2], [W.baseHalf + .06, -1.2], [W.baseHalf, 0], [W.topHalf, W.height], [-W.topHalf, W.height], [-W.baseHalf, 0]], z0, z1);
        const coping = extrudeAlongZ([[-W.copingHalf + .025, W.height - .02], [W.copingHalf - .025, W.height - .02], [W.copingHalf, W.height + .025], [W.copingHalf, W.copingTop - .025], [W.copingHalf - .025, W.copingTop], [-W.copingHalf + .025, W.copingTop], [-W.copingHalf, W.copingTop - .025], [-W.copingHalf, W.height + .025]], z0, z1);
        const mesh = new THREE.Mesh(mergeGeometries([body, coping], false), material);
        mesh.castShadow = false;
        mesh.receiveShadow = true;
        group.add(mesh);
    }
    // The boom: yellow floats on both sides of the waterline, riding the swell.
    const spacing = .32, from = -70, to = 46;
    const perSide = Math.floor((to - from) / spacing);
    const floatGeometry = new THREE.SphereGeometry(1, 14, 10);
    floatGeometry.scale(.06, .05, .07);
    const floats = new THREE.InstancedMesh(floatGeometry, new THREE.MeshStandardMaterial({color: 0xe0a820, roughness: .6, metalness: 0, envMapIntensity: .5}), perSide * 2);
    floats.frustumCulled = false;
    floats.castShadow = false;
    floats.receiveShadow = true;
    group.add(floats);
    const items = [];
    for (const side of [-1, 1]) {
        for (let i = 0; i < perSide; i++) items.push({x: side * (W.baseHalf + .07), z: from + i * spacing + (side > 0 ? spacing / 2 : 0), seed: Math.random() * 6});
    }
    const matrix = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
    scene.add(group);
    return {
        group,
        update(time, ocean) {
            if (!ocean) return;
            items.forEach((item, i) => {
                const h = ocean.height(item.x, item.z, time);
                q.setFromEuler(e.set(Math.sin(time * 1.6 + item.seed) * .2, 0, Math.cos(time * 1.3 + item.seed) * .2));
                matrix.compose(v.set(item.x, h + .012, item.z), q, one);
                floats.setMatrixAt(i, matrix);
            });
            floats.instanceMatrix.needsUpdate = true;
        },
    };
}
