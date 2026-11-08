import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLSL_NOISE } from './textures.js';

// The barrier between the two fleets, so neither side can see the other's ships: a long, thin wall of
// precast concrete running from behind the camera to the horizon, with a boom of yellow floats along its
// waterline on both sides. At 214 m tall it is built like a dam face and shaded that way, in world space:
//  - vertical contraction joints every 15 m, and the formwork lifts every 2.6 m showing as faint horizontal bands,
//    each pour a slightly different shade;
//  - long, thin streaks where water has run down the face, darkest from the top; up close, bug holes, thin rust
//    runs and the aggregate in the surface;
//  - white efflorescence leaching from the joints, rain streaks under the coping, the lower wall darker from
//    spray, and a wet, weed-stained splash zone with a dried salt line above it.
// Lines too fine for the pixel fade out instead of shimmering. One unit is 75 m.
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
float wallHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
// A line every \`period\` along a coordinate, \`width\` wide, antialiased and fading out when sub-pixel.
float wallLines(float coord, float period, float width) {
    float d = (.5 - abs(fract(coord / period) - .5)) * period;
    float aa = max(fwidth(coord) * .75, 1e-6);
    return (1. - smoothstep(width - aa, width + aa, d)) * min(1., width / aa);
}
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
    // Weathered concrete: a warm light grey, matte, hardly mirroring the sky.
    const material = new THREE.MeshStandardMaterial({color: 0xa49c8f, roughness: .95, metalness: 0, envMapIntensity: .16});
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
                float along = vWallPos.z, up = vWallPos.y;
                // Contraction joints every 15 m, faint, fading with distance so the long wall never reads as
                // corrugated. (The formwork lifts show only as the shading of each pour below, not as lines.)
                float joint = wallLines(along, .2, .0022) * vertical * (1. - smoothstep(5., 16., distance(cameraPosition, vWallPos)) * .75);
                // Each lift a slightly different shade that drifts slowly along the wall (horizontal bands, not
                // tiles), and each bay between joints its own faint cast; faded out where they are too small to see.
                vec2 pour = vec2(floor(along / .2), floor(up / .035));
                float liftsVisible = 1. - smoothstep(.15, .5, fwidth(up) / .035);
                float baysVisible = 1. - smoothstep(.15, .5, fwidth(along) / .2);
                float pourTone = mix(1., mix(.955, 1.035, fbm(vec2(along * 1.3, pour.y * 3.7), vec2(1e4), 2) + .5), liftsVisible);
                float bayTone = mix(1., mix(.97, 1.03, wallHash(vec2(pour.x, 7.))), baysVisible);
                float bugHoles = smoothstep(.8, .86, fbm(vWallPos.zy * 31., vec2(1e4), 3) + .5) * near;
                // Rust weeping from the odd embedded steel, in long thin runs (up close only).
                float rust = smoothstep(.78, .95, fbm(vec2(along * 40., up * 1.6), vec2(1e4), 3) + .5) * near * vertical;
                wallHeight = (grain * .25 - bugHoles * .35) * near - joint * .3 + blotch * .06;
                vec3 concrete = diffuseColor.rgb * pourTone * bayTone * mix(.9, 1.04, blotch) * mix(.95, 1.03, grain);
                concrete *= 1. - joint * .13 - bugHoles * .16;
                // Long, thin streaks where water has run down the face for years, darkest from the top.
                float streak = smoothstep(.5, .85, fbm(vec2(along * 55., up * .9), vec2(1e4), 3) + .5);
                concrete *= 1. - streak * vertical * mix(.05, .16, smoothstep(.8, ${WALL.height.toFixed(2)}, up));
                concrete = mix(concrete, concrete * vec3(.8, .62, .48), rust * .22);
                // Efflorescence: white salts leached out of the joints and lift lines, running down the face.
                float leach = smoothstep(.55, .9, rain) * (1. - smoothstep(.0, .5, abs(fract(along / .2) - .5) * 2. - .8));
                concrete = mix(concrete, vec3(.86, .85, .8), leach * vertical * .16);
                // Rain streaks, strongest under the coping; the lower wall darker from spray and age.
                float underCap = smoothstep(${(WALL.height - 1.6).toFixed(2)}, ${WALL.height.toFixed(2)}, vWallPos.y);
                concrete *= 1. - smoothstep(.4, .85, rain) * vertical * (.16 + underCap * .2);
                concrete *= mix(.8, 1., smoothstep(.25, 1.7, up));
                // The splash zone: wet and dark, weed-stained, with a dried salt line above it.
                float splash = 1. - smoothstep(.1, .5, vWallPos.y + (grain - .5) * .16 + sin(vWallPos.z * 2.7) * .04);
                concrete = mix(concrete, concrete * vec3(.4, .43, .38), splash);
                concrete = mix(concrete, vec3(.13, .17, .1), splash * smoothstep(.45, .75, blotch) * .55);
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
                    vec2 dh = vec2(dFdx(wallHeight), dFdy(wallHeight)) * .09;
                    vec3 grad = sign(det) * (dh.x * r1 + dh.y * r2);
                    normal = normalize(abs(det) * normal - grad);
                }`);
    };
    material.customProgramCacheKey = () => 'sea-wall-concrete-6';
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
