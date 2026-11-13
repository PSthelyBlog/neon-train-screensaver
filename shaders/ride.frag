#version 440

// Loop Line: a window seat on an endless elevated loop through a neon city.
// One pass. The cabin wall and window are planes, trackside structures are
// planes with analytic motion blur, and the city is a grid of boxes walked
// with a 2D DDA. Everything is periodic over LOOP metres, so the ride repeats.

layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;

layout(std140, binding = 0) uniform buf {
    mat4 qt_Matrix;
    float qt_Opacity;
    float time;      // seconds
    float travel;    // metres along the loop, 0..LOOP
    float speed;     // m/s
    float passZ;     // centre of the oncoming train, metres ahead of the eye
    float rain;      // 0, 0.5, 1
    float quality;   // 0 low .. 3 ultra
    float aspect;    // width / height
    float pixel;     // 1 / rendered height
};

const float LOOP = 4800.0;
const float CELL = 24.0;
const float NZ = 200.0;      // LOOP / CELL
const float X0 = 16.0;       // where the city grid starts
const float GH = 9.0;        // street level below the cabin floor
const float WALLX = 1.4;
const float EDGEX = 6.6;
const float SHUTTER = 0.012;

float h11(float p) { p = fract(p * .1031); p *= p + 33.33; p *= p + p; return fract(p); }
float h12(vec2 p) { vec3 q = fract(vec3(p.xyx) * .1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
vec3 h32(vec2 p) { vec3 q = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); q += dot(q, q.yxz + 33.33); return fract((q.xxy + q.yzz) * q.zyx); }
vec2 h22(vec2 p) { return h32(p).xy; }

float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3. - 2. * f);
    return mix(mix(h12(i), h12(i + vec2(1, 0)), f.x), mix(h12(i + vec2(0, 1)), h12(i + vec2(1, 1)), f.x), f.y);
}

float fbm(vec2 p) {
    float a = .5, s = 0.;
    for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= .5; }
    return s;
}

vec3 neon(float h) {
    h = fract(h) * 6.;
    if (h < 1.) return vec3(1., .08, .55);
    if (h < 2.) return vec3(.05, .85, 1.);
    if (h < 3.) return vec3(1., .55, .08);
    if (h < 4.) return vec3(.55, .25, 1.);
    if (h < 5.) return vec3(.2, 1., .55);
    return vec3(1., .15, .12);
}

float band(float z, float a, float b, float w) { return smoothstep(a - w, a + w, z) * (1. - smoothstep(b - w, b + w, z)); }

// Coverage of a thin object repeated every `period` metres, smeared by motion.
float postMask(float zw, float period, float halfW, float px) {
    float blur = abs(speed) * SHUTTER + px;
    float pz = abs(mod(zw + period * .5, period) - period * .5);
    float w = halfW + blur * .5;
    return clamp((w - pz) / max(blur, .004) + .5, 0., 1.) * (2. * halfW / (2. * halfW + blur * .6));
}

// x = tallest building, y = share of built lots, z = neon, w = open water
vec4 district(float zl) {
    float old = band(zl, 1300., 2900., 80.);
    float water = band(zl, 2900., 3900., 40.);
    float ind = band(zl, 3900., 4740., 60.);
    float down = clamp(1. - old - water - ind, 0., 1.);
    return vec4(190. * down + 62. * old + 36. * ind,
                (.93 * down + .97 * old + .72 * ind) * (1. - water),
                down + 1.35 * old + .35 * ind, water);
}

// x = signed distance along the track to the nearest station, y = its index
vec2 stationAt(float zl) {
    vec2 r = vec2(zl - 400., 0.);
    if (abs(zl - 2300.) < abs(r.x)) r = vec2(zl - 2300., 1.);
    if (abs(zl - 3400.) < abs(r.x)) r = vec2(zl - 3400., 2.);
    if (abs(zl - 4350.) < abs(r.x)) r = vec2(zl - 4350., 3.);
    return r;
}
bool inStation(float zl) { return abs(stationAt(zl).x) < 62.; }
bool inTunnel(float zl) { return zl > 1320. && zl < 1730.; }
bool onBridge(float zl) { return zl > 2950. && zl < 3850.; }

float fogDensity() { return .0013 + .0014 * rain; }

vec3 haze(float y) {
    vec3 c = mix(vec3(.085, .032, .07), vec3(.022, .017, .048), smoothstep(-.02, .22, y));
    return mix(c, vec3(.004, .006, .015), smoothstep(.15, .75, y));
}

vec3 applyFog(vec3 col, float t, vec3 rd) {
    return mix(haze(rd.y), col, exp(-t * fogDensity()));
}

// A distant row of towers, drawn as a flat silhouette at depth D.
vec3 skyline(vec3 c, vec3 rd, float zcam, float D, float W, float cnt, float seed, float hmax) {
    float k = D / max(rd.x, .08);
    float zf = zcam + rd.z * k;
    float yf = 1.3 + rd.y * k + GH;
    float ci = floor(zf / W), cf = fract(zf / W), id = mod(ci, cnt);
    vec3 r = h32(vec2(id, seed));
    float hL = hmax * (.22 + .78 * r.x * r.x) * (r.y > .93 ? 2.1 : 1.);
    float wd = .35 + .6 * r.z;
    if (abs(cf - .5) > wd * .5 || yf > hL || yf < 0.) return c;
    vec3 body = haze(rd.y) * .42;
    vec2 g = vec2(zf / 5., yf / 5.5);
    vec2 gf = fract(g);
    float lit = step(.78, h12(floor(g) + id * 3.7 + seed)) * step(.25, gf.x) * step(gf.x, .75) * step(.3, gf.y) * step(gf.y, .7);
    vec3 wc = mix(vec3(1., .72, .42), vec3(.6, .85, 1.), step(.5, r.z));
    body += wc * lit * 1.3;
    if (r.y > .93) body += neon(r.x * 9.) * smoothstep(.06, .0, abs(cf - .5)) * 1.2;
    body += neon(r.z * 5. + seed) * step(.6, r.x) * smoothstep(3., 1., abs(yf - hL * .8)) * .9;
    float blink = step(.5, fract(time * .6 + r.x * 7.));
    body += vec3(1., .1, .08) * blink * step(hL - 5., yf) * smoothstep(.05, .0, abs(cf - .5)) * 1.5;
    return mix(c, body, exp(-D * fogDensity() * .45));
}

vec3 sky(vec3 rd, float zcam) {
    vec3 c = haze(rd.y);
    if (rd.y > .01) {
        vec2 uv = rd.xz / (rd.y + .1) * .55 + vec2(0., zcam * .00035);
        float cl = fbm(uv * 1.4 + time * .004);
        vec3 under = mix(vec3(.3, .08, .22), vec3(.32, .17, .06), fbm(uv * .6 + 5.));
        c += under * cl * cl * .16 * smoothstep(.0, .3, rd.y);
    }
    for (int i = 0; i < 3; i++) {
        float fi = float(i);
        vec3 d = normalize(vec3(1., .2 + .13 * fi, 1.4 * sin(time * .011 * (fi + 1.) + fi * 2.1)));
        float a = max(dot(rd, d), 0.);
        c += mix(vec3(1., .2, .15), vec3(.8, .9, 1.), step(.5, fract(time * .9 + fi * .37))) * pow(a, 60000.) * 2.;
    }
    c = skyline(c, rd, zcam, 2400., 80., 60., 11., 430.);
    c = skyline(c, rd, zcam, 1200., 48., 100., 23., 250.);
    return c;
}

struct Hit { float t; vec3 n; vec2 cid; vec4 rnd; float h; vec3 mn; vec3 mx; };

float lotHeight(vec2 cid, out vec4 rnd) {
    rnd = vec4(h32(cid + 3.7), h12(cid * 1.37 + 9.1));
    vec4 d = district((cid.y + .5) * CELL);
    if (rnd.x > d.y) return 0.;
    return (9. + d.x * pow(rnd.y, 2.2)) * mix(.7, 1., clamp(cid.x / 3., 0., 1.));
}

vec2 box(vec3 ro, vec3 ird, vec3 mn, vec3 mx, out vec3 n) {
    vec3 t0 = (mn - ro) * ird, t1 = (mx - ro) * ird;
    vec3 a = min(t0, t1), b = max(t0, t1);
    n = step(a.yzx, a.xyz) * step(a.zxy, a.xyz);
    return vec2(max(max(a.x, a.y), a.z), min(min(b.x, b.y), b.z));
}

bool city(vec3 ro, vec3 rd, float tMax, int steps, out Hit hit) {
    hit.t = 1e9;
    if (rd.x < .002) return false;
    vec3 ird = 1. / rd;
    float t0 = max((X0 - ro.x) * ird.x, 0.);
    vec2 p = vec2(ro.x + rd.x * t0 - X0, ro.z + rd.z * t0) / CELL;
    vec2 c = floor(p);
    c.x = max(c.x, 0.);
    vec2 sgn = vec2(1., rd.z < 0. ? -1. : 1.);
    vec2 dd = abs(CELL * ird.xz);
    vec2 side = (sgn * (c - p) + sgn * .5 + .5) * dd;
    float t = t0;
    for (int i = 0; i < 128; i++) {
        if (i >= steps || t > tMax || c.x > 44.) break;
        if (rd.y > 0. && ro.y + rd.y * t > 235. - GH) break;
        vec2 cid = vec2(c.x, mod(c.y, NZ));
        vec4 rnd;
        float h = lotHeight(cid, rnd);
        if (h > 0.) {
            float m = 2.5 + 3. * rnd.z;
            vec3 mn = vec3(X0 + c.x * CELL + m, -GH, c.y * CELL + m);
            vec3 mx = vec3(X0 + (c.x + 1.) * CELL - m, -GH + h, (c.y + 1.) * CELL - m);
            bool tiered = rnd.w > .45 && h > 45.;
            vec3 n;
            vec3 top = mx;
            if (tiered) top.y = -GH + h * .32;
            vec2 tb = box(ro, ird, mn, top, n);
            float best = 1e9;
            if (tb.x < tb.y && tb.x > 0.) { best = tb.x; hit.n = n; hit.mn = mn; hit.mx = top; }
            if (tiered) {
                vec3 mn2 = mn + vec3(3.2, 0., 3.2), mx2 = mx - vec3(3.2, 0., 3.2);
                vec3 n2;
                vec2 tb2 = box(ro, ird, mn2, mx2, n2);
                if (tb2.x < tb2.y && tb2.x > 0. && tb2.x < best) { best = tb2.x; hit.n = n2; hit.mn = mn2; hit.mx = mx2; }
            }
            if (best < tMax) {
                hit.t = best; hit.cid = cid; hit.rnd = rnd; hit.h = h;
                return true;
            }
        }
        if (side.x < side.y) { t = t0 + side.x; side.x += dd.x; c.x += sgn.x; }
        else { t = t0 + side.y; side.y += dd.y; c.y += sgn.y; }
    }
    return false;
}

// Animated sign content. Abstract blocks, bars and rings; no lettering.
vec3 billboard(vec2 q, vec2 cid) {
    float ty = h12(cid + 91.);
    vec3 a = neon(h12(cid + 12.) * 6.), b = neon(h12(cid + 29.) * 6. + 2.);
    float tt = time * .35 + ty * 20.;
    vec3 c;
    if (ty < .34) {
        vec2 g = vec2(q.x * 3., q.y * 2.);
        vec2 gi = floor(g), gf = fract(g);
        float ph = floor(tt * 1.5 + h12(gi) * 4.);
        vec2 sub = floor(gf * vec2(4., 5.));
        float on = step(.45, h12(sub + gi * 7. + ph * 3.1)) * step(.12, gf.x) * step(gf.x, .88) * step(.12, gf.y) * step(gf.y, .88);
        on *= step(.25, h12(gi + ph));
        c = mix(b * .025, a, on);
    } else if (ty < .67) {
        float s = sin(q.x * 6. + tt * 3.) * .5 + .5;
        c = mix(a, b, step(.5, fract(q.y * 3. + tt * .6))) * (.35 + .65 * s);
    } else {
        float r = length(q * vec2(1.6, 1.));
        float ring = .5 + .5 * sin(r * 14. - tt * 5.);
        c = mix(b * .15, a, smoothstep(.4, .6, ring)) * smoothstep(1.4, .2, r) + a * smoothstep(.22, .18, r);
    }
    c *= .9 + .1 * step(.3, fract(tt * 9. + ty * 3.));
    return c * 1.5;
}

vec3 shadeBuilding(vec3 p, Hit h, vec3 rd) {
    float fp = h.t * pixel * 1.1;
    vec4 d = district((h.cid.y + .5) * CELL);
    vec3 acc = neon(h.rnd.y * 6. + h.cid.x * .37);
    vec3 base = vec3(.016, .019, .027) * (.7 + h.rnd.x);
    float v = p.y + GH;
    if (h.n.y > .5) {
        vec2 g = p.xz / 3.;
        float l = step(.975, h12(floor(g) + h.cid)) * smoothstep(.5, .2, length(fract(g) - .5));
        return base * 1.4 + acc * l * 1.5 * (1. - clamp(fp, 0., 1.));
    }
    bool xf = h.n.x > .5;
    float u = xf ? p.z - h.mn.z : p.x - h.mn.x;
    float w = xf ? h.mx.z - h.mn.z : h.mx.x - h.mn.x;
    float face = xf ? 1. : 2.;

    vec2 wsz = vec2(1.6 + 1.8 * h.rnd.x, 3.2 + .6 * h.rnd.w);
    vec2 g = vec2(u, v) / wsz;
    vec2 wid = floor(g), wf = fract(g);
    float thr = mix(.35, .92, h.rnd.z);
    float r1 = h12(wid + h.cid * 13.7 + face * 31.), r2 = h11(wid.y * 7.3 + h.cid.x * 3.1 + h.cid.y);
    float lit = step(thr, mix(r1, r2, .35));
    float mask = smoothstep(.08, .14, wf.x) * smoothstep(.92, .86, wf.x) * smoothstep(.18, .26, wf.y) * smoothstep(.9, .82, wf.y);
    float lod = clamp(fp / (wsz.x * .4), 0., 1.);
    float blinds = .72 + .28 * step(.5, fract(wf.y * 7. + r1 * 3.));
    float wv = mix(lit * mask * blinds, (1. - thr) * .42, lod * lod);
    vec3 wc = mix(vec3(1., .72, .42), vec3(.65, .85, 1.), smoothstep(.3, .7, h12(h.cid + 50.)));
    if (r1 > .965) wc = acc;
    float tv = step(.985, r2) * (.6 + .4 * sin(time * 9. + r1 * 40.));
    vec3 em = wc * wv * (.12 + .9 * r1 * r1) * (1. - .5 * tv);

    float sx = h12(h.cid + 5.3);
    if (sx > .5) em += acc * smoothstep(.3 + fp, .08, min(u, w - u)) * 1.5 * d.z;
    if (sx < .62) {
        float per = wsz.y * 6.;
        float fb = abs(fract(v / per) - .5) * per;
        em += acc * smoothstep(.25 + fp, .08, fb) * .9 * d.z;
    }
    if (h12(h.cid + 77.) > .5 && w > 8.) {
        float hx = w * .36, hy = min(h.h * .16, 8.);
        vec2 q = vec2(u - w * .5, v - h.h * mix(.4, .75, h12(h.cid + 61.))) / vec2(hx, hy);
        if (abs(q.x) < 1. && abs(q.y) < 1.) {
            em = billboard(q, h.cid + face) * (.85 + .15 * sin(v * 9.)) * min(d.z, 1.2);
            base *= .3;
        }
    }
    vec3 street = mix(vec3(1., .55, .2), vec3(.2, .8, .9), band((h.cid.y + .5) * CELL, 3900., 4740., 60.));
    return base * .6 + em + base * street * exp(-v / 9.) * 1.6 + haze(.1) * .012;
}

vec3 cars(float along, float across, float idx, float lane) {
    float sp = 9. + 5. * h11(idx * 3.1 + lane * 7.);
    float q = (along + lane * time * sp) / 15. + h11(idx * 5.7 + lane) * 10.;
    float car = step(.55, h12(vec2(mod(floor(q), 320.), idx * 5. + lane)));
    float f = (fract(q) - .5) * 15.;
    float spot = exp(-f * f / 5.) * exp(-pow((across - lane * 1.6) / 1.1, 2.));
    return mix(vec3(1., .08, .04), vec3(1., .95, .8), step(0., lane)) * car * spot * 2.2;
}

vec3 ground(vec3 p, vec3 rd, float t, bool reflections) {
    float zl = mod(p.z, LOOP);
    vec4 d = district(zl);
    float fres = pow(1. - clamp(-rd.y, 0., 1.), 5.);
    if (d.w > .5 && p.x > 9.) {
        vec2 w = p.xz * .22;
        float amp = .22 / (1. + t * .004);
        vec3 n = normalize(vec3((vnoise(w + time * .3) - .5) * amp, 1., (vnoise(w * 1.7 - time * .25 + 9.) - .5) * amp));
        vec3 r = reflect(rd, n);
        r.y = abs(r.y);
        return vec3(.002, .004, .007) + sky(r, p.z) * (.05 + .95 * fres) * 1.3;
    }
    vec2 g = vec2(p.x - X0, p.z);
    vec2 gc = floor(g / CELL), gf = g - gc * CELL;
    vec2 near = min(gf, CELL - gf);
    vec3 lamp = mix(vec3(1., .55, .2), vec3(.2, .8, .9), band(zl, 3900., 4740., 60.));
    vec3 col = vec3(.012, .013, .017);
    float dc = p.x < X0 ? length(vec2(p.x - 14., near.y)) : length(near);
    col += lamp * exp(-dc * dc / 40.) * .55;
    if (p.x < X0) {
        col += cars(p.z, p.x - 11., -1., 1.) + cars(p.z, p.x - 11., -1., -1.);
    } else {
        float dx = gf.x < CELL * .5 ? gf.x : gf.x - CELL;
        float sxi = gc.x + (gf.x < CELL * .5 ? 0. : 1.);
        col += cars(p.z, dx, sxi, 1.) + cars(p.z, dx, sxi, -1.);
        float dz = gf.y < CELL * .5 ? gf.y : gf.y - CELL;
        float szi = mod(gc.y + (gf.y < CELL * .5 ? 0. : 1.), NZ) + 400.;
        col += (cars(p.x, dz, szi, 1.) + cars(p.x, dz, szi, -1.)) * d.y;
    }
    float puddle = smoothstep(.4, .7, vnoise(p.xz * .13));
    float wet = mix(.18, .75, puddle) * (.6 + .4 * rain);
    vec3 n = normalize(vec3((vnoise(p.xz * 2.1) - .5) * .05, 1., (vnoise(p.xz * 2.3 + 7.) - .5) * .05));
    vec3 r = reflect(rd, n);
    vec3 rc = haze(r.y);
    if (reflections) {
        Hit h;
        if (city(p + vec3(0., .02, 0.), r, 400., 26, h)) rc = applyFog(shadeBuilding(p + r * h.t, h, r), h.t, r);
    }
    return col + rc * wet * (.08 + .92 * fres);
}

vec3 farScene(vec3 ro, vec3 rd, int steps, bool reflections) {
    float tG = rd.y < -1e-4 ? (-GH - ro.y) / rd.y : 1e9;
    Hit h;
    if (city(ro, rd, tG, steps, h)) return applyFog(shadeBuilding(ro + rd * h.t, h, rd), h.t, rd);
    if (tG < 1e8) return applyFog(ground(ro + rd * tG, rd, tG, reflections), tG, rd);
    return sky(rd, ro.z);
}

// Whatever stands on the far edge of the viaduct: railing and masts, the
// tunnel wall, or the bridge truss. rgb is premultiplied by a.
vec4 edgePlane(float y, float zw, float px) {
    float zl = mod(zw, LOOP);
    if (inStation(zl)) return vec4(0.);
    if (inTunnel(zl)) {
        if (y > 5.6) return vec4(vec3(.004), 1.);
        vec3 c = vec3(.014, .015, .017) * (.8 + .4 * vnoise(vec2(zw * .7, y * 2.)));
        c *= 1. - .5 * postMask(zw, 6., .03, px);
        c *= 1. - .4 * smoothstep(.04, .0, abs(y - 3.1)) - .4 * smoothstep(.04, .0, abs(y - .4));
        c = mix(c, vec3(.006), smoothstep(.12, .08, abs(y - 2.75)));
        float seg = floor(zw / 12.);
        vec3 lc = h11(mod(seg, 400.)) > .8 ? neon(seg * .37) : vec3(.75, .95, 1.);
        float pz = abs(mod(zw + 6., 12.) - 6.);
        float inY = step(.7, y) * step(y, 2.3);
        c += lc * postMask(zw, 12., .07, px) * inY * 4.;
        c += lc * exp(-pz * pz / 2.5) * exp(-pow(max(abs(y - 1.5) - .8, 0.), 2.) / 1.5) * .09;
        return vec4(c, 1.);
    }
    vec3 steel = vec3(.014, .016, .02) + haze(.05) * .06;
    if (onBridge(zl)) {
        if (y > 4.6 && y < 5.05) return vec4(steel * 1.3, 1.);
        if (y < -.55) return vec4(steel, 1.);
        if (y > 5.05) return vec4(0.);
        float a = postMask(zw, 12., .2, px);
        float bay = floor(zw / 12.), pz = zw - bay * 12.;
        float f = (y + .55) / 5.15;
        float lz = mod(bay, 2.) < 1. ? f * 12. : (1. - f) * 12.;
        float blur = abs(speed) * SHUTTER + px;
        a = max(a, clamp((.3 - abs(pz - lz)) / max(blur, .004) + .5, 0., 1.) * (.6 / (.6 + blur * .6)));
        vec3 c = steel * a;
        c += vec3(1., .12, .08) * postMask(zw, 12., .1, px) * smoothstep(.12, .05, abs(y - 4.4)) * 2.;
        return vec4(c, a);
    }
    float a = 0.;
    vec3 c = vec3(0.);
    if (y < .15) {
        a = y > .07 ? 1. : max(.14, postMask(zw, 1.5, .03, px));
        c = steel * a;
    }
    if (y < 6.3) {
        float pm = postMask(zw, 30., .16, px);
        float pz = abs(mod(zw + 15., 30.) - 15.);
        float r = length(vec2(pz, y - 5.3));
        vec3 lampc = vec3(1., .75, .45);
        c = c * (1. - pm) + steel * pm;
        a = a + pm * (1. - a);
        float bl = abs(speed) * SHUTTER;
        c += lampc * (smoothstep(.28 + bl, .1, r) * 4. / (1. + bl * 3.) + exp(-r * r / 1.2) * .1);
    }
    for (int i = 0; i < 2; i++) {
        float wy = i == 0 ? 5.75 : 4.95;
        float wa = smoothstep(px + .012, 0., abs(y - wy) - .012) * .8;
        c = c * (1. - wa) + vec3(.004) * wa;
        a = a + wa * (1. - a);
    }
    return vec4(c, a);
}

vec3 oncoming(float y, float zw) {
    vec3 c = vec3(.03, .033, .04);
    c += vec3(.9, .5, .1) * smoothstep(.05, .02, abs(y - .62)) * .8;
    float win = smoothstep(.95, 1.02, y) * smoothstep(2.05, 1.98, y);
    float blur = (abs(speed) + 21.) * SHUTTER;
    float pat = mix(step(.18, fract(zw / 2.5)), .82, clamp(blur / .9, 0., 1.));
    float gap = clamp((abs(fract(zw / 21.) - .5) * 21. - .5) / max(blur, .05), 0., 1.);
    c += vec3(1., .82, .6) * win * pat * gap * (.5 + .12 * sin(zw * .8) + .1 * vnoise(vec2(zw * .4, 2.)));
    return c;
}

vec3 stationLight(float idx) { return neon(idx * .29 + .2); }

vec3 trackside(vec3 ro, vec3 rd, int steps, bool reflections) {
    float best = 1e9;
    vec3 col = vec3(0.);
    float t, zl;
    vec3 p;
    float zcam = mod(ro.z, LOOP);
    bool nearStation = abs(stationAt(zcam).x) < 400.;

    // Oncoming train on the neighbouring track.
    t = (3.3 - ro.x) / rd.x;
    p = ro + rd * t;
    if (abs(p.z - ro.z - passZ) < 58. && p.y > -.75 && p.y < 2.75) { best = t; col = oncoming(p.y, p.z - passZ); }

    if (nearStation) {
        // Platform edge face.
        t = (6.4 - ro.x) / rd.x;
        p = ro + rd * t;
        zl = mod(p.z, LOOP);
        if (t < best && p.y < 0. && inStation(zl)) {
            best = t;
            col = vec3(.02) + stationLight(stationAt(zl).y) * smoothstep(.1, .02, -p.y) * 1.2;
        }
        // Platform floor.
        if (rd.y < -1e-4) {
            t = -ro.y / rd.y;
            p = ro + rd * t;
            zl = mod(p.z, LOOP);
            if (t < best && p.x > 6.4 && p.x < 12. && inStation(zl)) {
                best = t;
                vec2 tile = fract(p.xz / .9);
                float joint = step(.04, tile.x) * step(.04, tile.y);
                float lightAmt = .55 + .45 * exp(-pow(p.x - 9.3, 2.) / 6.);
                col = vec3(.075, .08, .085) * (.75 + .25 * joint) * lightAmt;
                col += stationLight(stationAt(zl).y) * smoothstep(.2, .14, abs(p.x - 6.9)) * 1.6;
                col += vec3(.9, .95, 1.) * exp(-pow(p.x - 12., 2.) / 3.) * .1;
            }
        }
        // Canopy.
        if (rd.y > 1e-4) {
            t = (4.2 - ro.y) / rd.y;
            p = ro + rd * t;
            zl = mod(p.z, LOOP);
            if (t < best && p.x > 5.6 && p.x < 12.4 && inStation(zl)) {
                best = t;
                float seg = step(.06, fract(p.z / 4.));
                float strip = smoothstep(.16, .1, abs(p.x - 8.)) + smoothstep(.16, .1, abs(p.x - 10.6));
                col = vec3(.008, .0085, .01) + vec3(.92, .97, 1.) * strip * seg * 2.6;
            }
        }
        // Columns.
        t = (9.2 - ro.x) / rd.x;
        p = ro + rd * t;
        zl = mod(p.z, LOOP);
        if (t < best && p.y > 0. && p.y < 4.2 && inStation(zl)) {
            float pm = postMask(p.z, 10., .2, t * pixel);
            if (pm > .5) {
                best = t;
                col = vec3(.02, .021, .024) + stationLight(stationAt(zl).y) * smoothstep(.07, .03, abs(p.y - 2.4)) * 1.5;
            }
        }
        // Back wall with screens and a coloured line.
        t = (12. - ro.x) / rd.x;
        p = ro + rd * t;
        zl = mod(p.z, LOOP);
        if (t < best && p.y > 0. && p.y < 4.2 && inStation(zl)) {
            best = t;
            vec2 st = stationAt(zl);
            vec3 sl = stationLight(st.y);
            vec2 tile = fract(vec2(p.z, p.y) / vec2(.6, .3));
            col = vec3(.03, .032, .035) * (.8 + .2 * step(.06, tile.x) * step(.1, tile.y));
            col += sl * smoothstep(.1, .07, abs(p.y - 3.62)) * 1.4;
            float seg = floor((st.x + 66.) / 12.), sz = st.x + 66. - seg * 12. - 6.;
            vec2 q = vec2(sz / 3.6, (p.y - 2.05) / 1.15);
            if (abs(q.x) < 1. && abs(q.y) < 1.) {
                if (mod(seg, 3.) < 1.) {
                    // Name plate: bars standing in for lettering.
                    float bar = step(.25, fract(q.x * 5. + .5)) * smoothstep(.5, .4, abs(q.y)) * step(h11(floor(q.x * 5. + .5) + st.y * 9.), .8);
                    col = mix(vec3(.22, .23, .25), vec3(.01), bar);
                    col = mix(col, sl * 1.5, step(.72, abs(q.y)));
                } else {
                    col = billboard(q, vec2(seg, st.y + 300.)) * .7;
                }
            }
        }
    }

    // Tunnel ceiling.
    if (rd.y > 1e-4) {
        t = (5.6 - ro.y) / rd.y;
        p = ro + rd * t;
        if (t < best && p.x < EDGEX && inTunnel(mod(p.z, LOOP))) { best = t; col = vec3(.006, .007, .008); }
    }

    // Edge of the viaduct, which can be see-through.
    t = (EDGEX - ro.x) / rd.x;
    vec4 edge = vec4(0.);
    if (t < best) {
        p = ro + rd * t;
        edge = edgePlane(p.y, p.z, t * pixel);
        if (edge.a > .995) return edge.rgb;
    }
    if (best < 1e8) return edge.rgb + col * (1. - edge.a);
    // Viaduct deck, for the steep rays that reach it.
    if (rd.y < -1e-4) {
        t = (-1.1 - ro.y) / rd.y;
        if (ro.x + rd.x * t < EDGEX) return edge.rgb + vec3(.012) * (1. - edge.a);
    }
    return edge.rgb + farScene(ro, rd, steps, reflections) * (1. - edge.a);
}

// xy = refraction offset, z = how much water covers the glass here
vec3 dropLayer(vec2 uv, float t, float sz, float seed) {
    vec2 asp = vec2(3., 1.);
    vec2 st = uv * sz;
    st.y += t * .22;
    vec2 g = st * asp;
    vec2 id = floor(g);
    vec2 f = fract(g) - .5;
    float n = h12(id + seed);
    float tt = t * 1.1 + n * 6.2831;
    float yo = -sin(tt + sin(tt + sin(tt) * .5)) * .36;
    float xo = (n - .5) * .55 + sin(st.y * 9. + n * 20.) * .02;
    vec2 dp = (f - vec2(xo, yo)) / asp;
    float d = length(dp);
    float ex = step(.5, h12(id * 1.7 + seed + 3.));
    float drop = smoothstep(.055, .0, d);
    float trail = smoothstep(.012, .0, abs(dp.x)) * smoothstep(yo, yo + .06, f.y) * smoothstep(yo + .35, yo, f.y);
    return vec3(dp * (drop * 4.5 + trail * .4), drop + trail * .12) * ex;
}

vec3 cabinSpill(float zcam) {
    float zl = mod(zcam, LOOP);
    vec3 c = neon(floor(zcam / 55.) * .23) * vnoise(vec2(zcam * .07, 3.)) * .5;
    c += vec3(1., .6, .3) * vnoise(vec2(zcam * .11, 9.)) * .25;
    c *= 1. - district(zl).w * .7;
    if (inTunnel(zl)) { float pz = mod(zcam + 6., 12.) - 6.; c = vec3(.7, .9, 1.) * (.12 + .7 * exp(-pz * pz / 6.)); }
    float sd = abs(stationAt(zl).x);
    c = mix(c, vec3(.95, .98, 1.) * .8, smoothstep(75., 45., sd));
    return c;
}

vec3 aces(vec3 x) { return clamp((x * (2.51 * x + .03)) / (x * (2.43 * x + .59) + .14), 0., 1.); }

void main() {
    vec2 uv = (qt_TexCoord0 - .5) * 2.;
    uv.y = -uv.y;
    int steps = quality < .5 ? 44 : (quality < 1.5 ? 64 : (quality < 2.5 ? 92 : 124));
    bool reflections = quality > 1.5;

    float sp = clamp(speed / 23., 0., 1.);
    float yaw = .15 + .085 * sin(time * .07) + .03 * sin(time * .19 + 1.);
    float pitch = .03 + .024 * sin(time * .11 + 2.);
    vec3 eye = vec3(-.35, 1.27 + sp * (.005 * sin(time * 9.) + .003 * sin(time * 13.7)), sp * .004 * sin(time * 6.1));
    vec3 f = vec3(cos(pitch) * cos(yaw), sin(pitch), cos(pitch) * sin(yaw));
    vec3 r = normalize(cross(f, vec3(sp * .004 * sin(time * 4.3), 1., 0.)));
    vec3 u = cross(r, f);
    const float th = .445;
    vec3 rd = normalize(f + r * uv.x * aspect * th + u * uv.y * th);

    // The cabin wall.
    float tw = (WALLX - eye.x) / rd.x;
    vec3 wp = eye + rd * tw;
    const float P = 2.5;
    vec2 q = vec2(mod(wp.z + P * .5, P) - P * .5, wp.y - 1.37);
    vec2 bd = abs(q) - vec2(1.02, .62) + .14;
    float sd = length(max(bd, 0.)) + min(max(bd.x, bd.y), 0.) - .14;
    vec3 spill = cabinSpill(travel);
    vec3 led = vec3(.2, .9, .85);
    vec3 col;

    if (sd > 0.) {
        vec3 base = vec3(.02, .021, .025) + vnoise(vec2(wp.z * 40., wp.y * 3.)) * .003;
        if (wp.y < .72) base *= .6 - .25 * smoothstep(.01, .0, abs(wp.y - .5));
        if (wp.y > 2.3) base *= .45;
        col = base * (.3 + spill * 1.1);
        col += base * led * exp(-max(2.13 - wp.y, 0.) * 7.) * .9 * step(wp.y, 2.16);
        col += led * smoothstep(.018, .012, abs(wp.y - 2.145)) * .9;
        col = mix(col, vec3(.004), smoothstep(.04, .03, sd));
        col += (spill + .1) * .05 * smoothstep(.035, .045, sd) * smoothstep(.075, .05, sd);
        col *= 1. - .5 * smoothstep(.25, .0, sd);
    } else {
        vec3 rdo = rd;
        float wetness = 0.;
        if (rain > .01) {
            vec2 guv = vec2(wp.z + wp.y * sp * .45, wp.y);
            vec3 d1 = dropLayer(guv, time, 2.6, 1.);
            vec3 d2 = dropLayer(guv * 1.7 + 3.1, time * 1.2, 2.6, 7.) * step(.6, rain);
            vec2 sg = guv * 46.;
            vec2 si = floor(sg), sf = fract(sg) - .5;
            vec2 so = sf - (h22(si) - .5) * .5;
            float sm = smoothstep(.22, .05, length(so)) * step(1. - .22 * rain, h12(si + 9.)) * (.5 + .5 * sin(time * .3 + h12(si) * 6.3));
            vec2 off = d1.xy + d2.xy + so * sm * .12;
            wetness = d1.z + d2.z + sm * .5;
            rdo = normalize(rd + vec3(0., off.y, off.x) * .55);
        }
        col = trackside(eye + vec3(0., 0., travel), rdo, steps, reflections);
        col *= vec3(.9, .95, .93) * (1. - .12 * clamp(wetness, 0., 1.));
        col += haze(.05) * wetness * .04;

        // The cabin, faintly, in the glass.
        float fr = .05 + .55 * pow(1. - rd.x, 4.);
        float t2 = 2.8 / rd.x;
        float y2 = wp.y + rd.y * t2, z2 = wp.z + rd.z * t2;
        vec3 refl = vec3(.012) + spill * .02;
        refl += led * smoothstep(.03, .015, abs(y2 - 2.145)) * 1.2;
        if (rd.y > .001 && y2 > 2.3) {
            float t3 = (2.3 - wp.y) / rd.y;
            float x3 = WALLX - rd.x * t3;
            refl = vec3(.01) + vec3(1., .9, .75) * smoothstep(.3, .22, abs(x3)) * step(.08, fract((wp.z + rd.z * t3) / 1.8)) * .7;
        }
        vec2 q2 = vec2(mod(z2 + P * .5, P) - P * .5, y2 - 1.37);
        if (abs(q2.x) < 1.02 && abs(q2.y) < .62) refl *= .25;
        col += refl * fr * .38;
        col *= 1. - .35 * smoothstep(-.1, .0, sd);
    }

    col = aces(col * 1.1);
    col = mix(col, col * vec3(.94, 1., 1.06), .5);
    col *= 1. - .32 * dot(uv * vec2(.8, .9), uv * vec2(.8, .9));
    col = pow(col, vec3(1. / 2.2));
    col += (h12(qt_TexCoord0 * vec2(aspect, 1.) / pixel + fract(time) * 91.) - .5) * .018;
    fragColor = vec4(clamp(col, 0., 1.), 1.) * qt_Opacity;
}
