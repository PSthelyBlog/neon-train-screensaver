#!/usr/bin/env python3
"""Synthesize Loop Line's sounds. Needs numpy. Run: tools/gen-sounds.py [out-dir]

Loops are shaped in the frequency domain, so they repeat without a seam.
"""
import os
import sys
import wave

import numpy as np

SR = 44100
rng = np.random.default_rng(2077)


def noise_loop(seconds, shape):
    """Looping noise whose spectrum follows shape(frequencies)."""
    n = int(SR * seconds)
    spectrum = np.fft.rfft(rng.standard_normal(n))
    spectrum *= shape(np.fft.rfftfreq(n, 1 / SR))
    out = np.fft.irfft(spectrum, n)
    return out / np.max(np.abs(out))


def band(f, low, high, slope=2.0):
    return 1 / (1 + (low / np.maximum(f, 1e-3)) ** (2 * slope)) / (1 + (f / high) ** (2 * slope))


def stereo(left, right=None):
    return np.stack([left, left if right is None else right], axis=1)


def save(path, data, peak):
    data = data / np.max(np.abs(data)) * peak
    with wave.open(path, "wb") as f:
        f.setnchannels(2)
        f.setsampwidth(2)
        f.setframerate(SR)
        f.writeframes((np.clip(data, -1, 1) * 32767).astype("<i2").tobytes())


def t(seconds):
    return np.arange(int(SR * seconds)) / SR


def rumble():
    def side():
        low = noise_loop(6, lambda f: band(f, 28, 150) / np.maximum(f, 20) ** 0.5)
        roar = noise_loop(6, lambda f: band(f, 280, 950))
        return low + roar * 0.16 * (1 + 0.3 * np.sin(2 * np.pi * t(6) / 3))
    return stereo(side(), side())


def hum():
    x = t(4)
    air = lambda: noise_loop(4, lambda f: band(f, 120, 1400, 1.0) / np.maximum(f, 60) ** 0.6)
    tone = sum(a * np.sin(2 * np.pi * f * x) for f, a in ((100, 0.5), (200, 0.2), (300, 0.08)))
    return stereo(air() + tone * 0.25, air() + tone * 0.25)


def motor():
    x = t(4)
    wob = 0.6 * np.sin(2 * np.pi * 0.5 * x)
    tone = sum(a * np.sin(2 * np.pi * f * x + wob * (i + 1)) for i, (f, a) in enumerate(((420, 1.0), (840, 0.4), (1260, 0.18), (2100, 0.06))))
    return stereo(tone + noise_loop(4, lambda f: band(f, 500, 2500)) * 0.15)


def clack():
    x = t(0.55)
    out = np.zeros_like(x)
    for start, gain in ((0.0, 1.0), (0.105, 0.8)):
        y = np.maximum(x - start, 0)
        on = x >= start
        thump = np.sin(2 * np.pi * (95 - 60 * y) * y) * np.exp(-y * 38)
        tick = rng.standard_normal(len(x)) * np.exp(-y * 160)
        out += on * gain * (thump + tick * 0.25)
    return stereo(out)


def rain():
    def side():
        wash = noise_loop(6, lambda f: band(f, 1500, 7500, 1.0))
        patter = np.zeros(SR * 6)
        for at in rng.integers(0, SR * 6 - 800, 260):
            n = int(rng.integers(120, 700))
            patter[at:at + n] += rng.standard_normal(n) * np.exp(-np.arange(n) / (n / 5)) * rng.uniform(0.3, 1.0)
        return wash + patter * 0.5
    return stereo(side(), side())


def bell(freq, seconds):
    x = t(seconds)
    mod = np.sin(2 * np.pi * freq * 3.01 * x) * np.exp(-x * 7) * 1.4
    return (np.sin(2 * np.pi * freq * x + mod) + 0.3 * np.sin(2 * np.pi * freq * 2 * x)) * np.exp(-x * 2.6)


def chime():
    out = np.zeros(int(SR * 2.8))
    for i, freq in enumerate((587.33, 880.0, 739.99)):
        note = bell(freq, 1.9)
        at = int(i * 0.34 * SR)
        out[at:at + len(note)] += note
    return stereo(out)


def doors():
    x = t(2.6)
    out = np.zeros_like(x)
    for i in range(3):
        y = x - i * 0.3
        out += (y > 0) * (y < 0.14) * np.sin(2 * np.pi * 1320 * y) * 0.5
    hiss_at = x - 1.0
    hiss = rng.standard_normal(len(x)) * (hiss_at > 0) * np.exp(-np.maximum(hiss_at, 0) * 3.2) * np.minimum(np.maximum(hiss_at, 0) * 30, 1)
    spectrum = np.fft.rfft(hiss)
    spectrum *= band(np.fft.rfftfreq(len(hiss), 1 / SR), 2000, 9000, 1.0)
    out += np.fft.irfft(spectrum, len(hiss)) * 2.2
    y = np.maximum(x - 2.0, 0)
    out += (x > 2.0) * np.sin(2 * np.pi * 70 * y) * np.exp(-y * 22) * 1.2
    return stereo(out)


def passing():
    x = t(3.2)
    env = np.exp(-((x - 1.5) / 0.55) ** 2)
    def side(shift):
        body = noise_loop(3.2, lambda f: band(f, 150, 2600, 1.0))
        clatter = 0.6 + 0.4 * np.sign(np.sin(2 * np.pi * 17 * x))
        return body * np.exp(-((x - 1.5 - shift) / 0.55) ** 2) * clatter
    tone = np.sin(2 * np.pi * (330 * x - 28 * np.tanh((x - 1.5) * 3) * x * 0.2)) * env * 0.12
    return stereo(side(-0.12) + tone, side(0.12) + tone)


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "sounds")
    os.makedirs(out, exist_ok=True)
    for name, make, peak in (("rumble", rumble, 0.8), ("hum", hum, 0.5), ("motor", motor, 0.5), ("clack", clack, 0.8),
                             ("rain", rain, 0.6), ("chime", chime, 0.7), ("doors", doors, 0.6), ("pass", passing, 0.85)):
        save(os.path.join(out, name + ".wav"), make(), peak)
        print("wrote", name + ".wav")


if __name__ == "__main__":
    main()
