import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

// Rendering in two layers so ambient occlusion only ever darkens solid things: first the ships, sea, wall and
// sky (whose depth the multisampled target resolves into a texture), then the occlusion multiplied into that
// image in place, then fire, smoke, spray and labels on top. Those read the same depth to fade softly where
// they meet a surface, and the final grade reads it for camera motion blur.
export const FX_LAYER = 3;

const VERTEX = /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`;

// Shared GLSL: view-space depth from a perspective depth-buffer value.
export const DEPTH_GLSL = /* glsl */`
float viewZFromDepth(float depth, float near, float far) { return (near * far) / ((far - near) * depth - far); }
`;

// The sun's shadow map covers only the part of the battle the camera is looking at, sized to the view: a
// close-up gets shadows a few centimetres a texel, the wide view the whole battlefield. Its position snaps to
// whole texels so the shadow edges do not crawl as the camera moves.
export class ShadowFocus {
    constructor(light, camera) {
        this.light = light;
        this.camera = camera;
        this.radius = 0;
        this.focus = new THREE.Vector3();
        this.basis = new THREE.Matrix4();
        this.inverse = new THREE.Matrix4();
        this.tmp = new THREE.Vector3();
        this.dir = new THREE.Vector3();
        this.changed = true;
    }

    update(sunDir) {
        const camera = this.camera;
        camera.getWorldDirection(this.dir);
        // Where the view meets the sea; looking level or up, a point ahead of the camera.
        const hit = this.dir.y < -.05 ? -camera.position.y / this.dir.y : 14;
        this.tmp.copy(camera.position).addScaledVector(this.dir, Math.min(hit, 40));
        this.tmp.y = 0;
        const distance = camera.position.distanceTo(this.tmp);
        // Sizes in steps of a quarter, so the projection is not rebuilt every frame.
        const wanted = THREE.MathUtils.clamp(distance * .62, 3, 17);
        const radius = Math.pow(1.25, Math.ceil(Math.log(wanted) / Math.log(1.25)));
        const shadow = this.light.shadow, cam = shadow.camera;
        if (radius !== this.radius) {
            this.radius = radius;
            cam.left = -radius; cam.right = radius; cam.top = radius; cam.bottom = -radius;
            cam.updateProjectionMatrix();
            this.changed = true;
        }
        // Snap the centre to the shadow map's texel grid, in the light's own frame.
        this.basis.lookAt(sunDir, new THREE.Vector3(), new THREE.Vector3(0, 1, 0));
        this.inverse.copy(this.basis).invert();
        const texel = radius * 2 / shadow.mapSize.x;
        this.tmp.applyMatrix4(this.inverse);
        this.tmp.x = Math.round(this.tmp.x / texel) * texel;
        this.tmp.y = Math.round(this.tmp.y / texel) * texel;
        this.tmp.applyMatrix4(this.basis);
        if (this.tmp.distanceToSquared(this.focus) > 1e-10) this.changed = true;
        this.focus.copy(this.tmp);
        this.light.target.position.copy(this.focus);
        this.light.position.copy(this.focus).addScaledVector(sunDir, 60);
        this.light.target.updateMatrixWorld();
        this.light.updateMatrixWorld();
        const changed = this.changed;
        this.changed = false;
        return changed;
    }
}

// Renders the scene with only some layers enabled, into the current image (no swap). The first one clears.
export class LayerRenderPass extends Pass {
    constructor(scene, camera, layers, {clear = true} = {}) {
        super();
        this.scene = scene;
        this.camera = camera;
        this.mask = layers.reduce((m, layer) => m | (1 << layer), 0);
        this.clear = clear;
        this.needsSwap = false;
    }

    render(renderer, writeBuffer, readBuffer) {
        const saved = this.camera.layers.mask;
        const autoClear = renderer.autoClear;
        this.camera.layers.mask = this.mask;
        renderer.autoClear = false;
        renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);
        if (this.clear) renderer.clear();
        renderer.render(this.scene, this.camera);
        renderer.autoClear = autoClear;
        this.camera.layers.mask = saved;
    }
}

// Scalable ambient obscurance (McGuire et al.), half resolution, with a depth-aware blur. Corners and contact
// points darken: deckhouse to deck, turret to barbette, the hull where it meets the sea, the foot of the wall.
const AO_SHADER = /* glsl */`
uniform sampler2D tDepth;
uniform mat4 uProjInv;
uniform vec2 uTexel;
uniform float uRadius, uIntensity, uProjScale, uAspect;
varying vec2 vUv;
vec3 viewPos(vec2 uv) {
    float d = texture2D(tDepth, uv).x;
    vec4 p = uProjInv * vec4(vec3(uv, d) * 2. - 1., 1.);
    return p.xyz / p.w;
}
void main() {
    float depth = texture2D(tDepth, vUv).x;
    if (depth >= .99999) { gl_FragColor = vec4(1.); return; }
    vec3 p = viewPos(vUv);
    vec2 t = uTexel * 2.;
    vec3 pr = viewPos(vUv + vec2(t.x, 0.)), pl = viewPos(vUv - vec2(t.x, 0.));
    vec3 pu = viewPos(vUv + vec2(0., t.y)), pd = viewPos(vUv - vec2(0., t.y));
    vec3 dx = abs(pr.z - p.z) < abs(p.z - pl.z) ? pr - p : p - pl;
    vec3 dy = abs(pu.z - p.z) < abs(p.z - pd.z) ? pu - p : p - pd;
    vec3 n = normalize(cross(dx, dy));
    if (dot(n, p) > 0.) n = -n;
    float noise = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(.06711056, .00583715))));
    float radius = clamp(uRadius * uProjScale / -p.z, t.y * 1.5, .1);
    float sum = 0.;
    const int N = 14;
    for (int i = 0; i < N; i++) {
        float f = (float(i) + .5 + noise * .5) / float(N);
        float a = (float(i) * 2.399963 + noise * 6.2831853);
        vec2 offset = vec2(cos(a) / uAspect, sin(a)) * radius * f;
        vec3 v = viewPos(vUv + offset) - p;
        float vv = dot(v, v);
        float falloff = max(0., 1. - vv / (uRadius * uRadius));
        sum += falloff * max(0., dot(v, n) + p.z * .0015) / (vv + .0002);
    }
    float occlusion = sum / float(N) * uRadius * 1.6;
    gl_FragColor = vec4(vec3(pow(clamp(1. - uIntensity * occlusion, 0., 1.), 1.4)), 1.);
}`;

const BLUR_SHADER = /* glsl */`
uniform sampler2D tAO, tDepth;
uniform vec2 uStep;
uniform float uNear, uFar;
varying vec2 vUv;
${DEPTH_GLSL}
void main() {
    float z = viewZFromDepth(texture2D(tDepth, vUv).x, uNear, uFar);
    float sum = 0., weight = 0.;
    for (int i = -4; i <= 4; i++) {
        vec2 uv = vUv + uStep * float(i);
        float zi = viewZFromDepth(texture2D(tDepth, uv).x, uNear, uFar);
        float w = exp(-float(i * i) / 10.) * exp(-abs(zi - z) / (abs(z) * .015 + .002));
        sum += texture2D(tAO, uv).r * w;
        weight += w;
    }
    gl_FragColor = vec4(vec3(sum / weight), 1.);
}`;

// Multiplies the occlusion into the image in place (blending dst × src), keeping its depth for the next layer.
const APPLY_SHADER = /* glsl */`
uniform sampler2D tAO;
uniform float uStrength;
varying vec2 vUv;
void main() { gl_FragColor = vec4(vec3(mix(1., texture2D(tAO, vUv).r, uStrength)), 1.); }`;

export class AmbientOcclusionPass extends Pass {
    constructor(camera, {radius = .09, intensity = 1.15, strength = .85} = {}) {
        super();
        this.camera = camera;
        this.needsSwap = false;
        this.depth = {value: null};      // published for soft particles and motion blur
        const target = () => new THREE.WebGLRenderTarget(2, 2, {type: THREE.UnsignedByteType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter});
        this.raw = target();
        this.blurred = target();
        this.aoMaterial = new THREE.ShaderMaterial({
            vertexShader: VERTEX, fragmentShader: AO_SHADER, depthTest: false, depthWrite: false,
            uniforms: {tDepth: this.depth, uProjInv: {value: new THREE.Matrix4()}, uTexel: {value: new THREE.Vector2()}, uRadius: {value: radius}, uIntensity: {value: intensity}, uProjScale: {value: 1}, uAspect: {value: 1}},
        });
        const blur = (from) => new THREE.ShaderMaterial({
            vertexShader: VERTEX, fragmentShader: BLUR_SHADER, depthTest: false, depthWrite: false,
            uniforms: {tAO: {value: from.texture}, tDepth: this.depth, uStep: {value: new THREE.Vector2()}, uNear: {value: camera.near}, uFar: {value: camera.far}},
        });
        this.blurX = blur(this.raw);
        this.blurY = blur(this.blurred);
        this.applyMaterial = new THREE.ShaderMaterial({
            vertexShader: VERTEX, fragmentShader: APPLY_SHADER, depthTest: false, depthWrite: false, transparent: true,
            blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.ZeroFactor, blendDst: THREE.SrcColorFactor,
            blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
            uniforms: {tAO: {value: this.raw.texture}, uStrength: {value: strength}},
        });
        this.quad = new FullScreenQuad();
        this.enabled = true;
    }

    setSize(width, height) {
        const w = Math.max(1, Math.round(width / 2)), h = Math.max(1, Math.round(height / 2));
        this.raw.setSize(w, h);
        this.blurred.setSize(w, h);
        this.aoMaterial.uniforms.uTexel.value.set(1 / width, 1 / height);
        this.blurX.uniforms.uStep.value.set(1 / w, 0);
        this.blurY.uniforms.uStep.value.set(0, 1 / h);
    }

    render(renderer, writeBuffer, readBuffer) {
        this.depth.value = readBuffer.depthTexture;
        const camera = this.camera, u = this.aoMaterial.uniforms;
        u.uProjInv.value.copy(camera.projectionMatrixInverse);
        u.uProjScale.value = camera.projectionMatrix.elements[5] * .5;
        u.uAspect.value = camera.aspect;
        this.quad.material = this.aoMaterial;
        renderer.setRenderTarget(this.raw);
        this.quad.render(renderer);
        this.quad.material = this.blurX;
        renderer.setRenderTarget(this.blurred);
        this.quad.render(renderer);
        this.quad.material = this.blurY;
        renderer.setRenderTarget(this.raw);
        this.quad.render(renderer);
        // Multiply into the image without clearing it first.
        const autoClear = renderer.autoClear;
        renderer.autoClear = false;
        this.quad.material = this.applyMaterial;
        renderer.setRenderTarget(readBuffer);
        this.quad.render(renderer);
        renderer.autoClear = autoClear;
    }
}
