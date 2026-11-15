// Run: node tests/auto.test.mjs
import { readFileSync } from "node:fs"
import assert from "node:assert/strict"

const source = readFileSync(new URL("../Auto.js", import.meta.url), "utf8").replace(".pragma library", "")
const Auto = new Function(source + "; return { initial, reset, observe, level, fps, name }")()

// A machine that keeps up: 60 frames a second, all of them on time.
function healthy(seconds, tick = 1 / 60) {
  const frames = Math.round(seconds / tick)
  return new Array(frames).fill(tick)
}

// A machine that cannot: the frames come far too slowly.
function starved(seconds, slow = 1 / 8) {
  const frames = Math.round(seconds / slow)
  return new Array(frames).fill(slow)
}

function feed(state, frames) {
  let s = state
  for (const f of frames) s = Auto.observe(s, f)
  return s
}

// The ride starts on the cheapest rung.
let s = Auto.initial(3, 60)
assert.equal(Auto.level(s), 0, "the ride starts at the lowest quality")
assert.equal(Auto.fps(s), 30, "the ride starts at 30 fps")

// A machine that keeps up climbs to the ceiling.
s = feed(s, healthy(60))
assert.equal(Auto.level(s), 3, "a healthy machine reaches the ceiling")
assert.equal(Auto.fps(s), 60, "a healthy machine reaches the ceiling frame rate")
s = feed(s, healthy(60))
assert.equal(Auto.level(s), 3, "and stays there")
assert.equal(Auto.fps(s), 60, "and stays there")

// The ceiling is respected.
s = Auto.initial(1, 60)
s = feed(s, healthy(120))
assert.equal(Auto.level(s), 1, "the ride never passes the ceiling")
s = Auto.initial(3, 30)
s = feed(s, healthy(120))
assert.equal(Auto.fps(s), 30, "the ride never passes the frame rate ceiling")

// A machine that cannot keep up is stepped down, not left to freeze.
s = Auto.initial(3, 60)
s = feed(s, starved(3))
assert.ok(Auto.level(s) < 3 || Auto.fps(s) < 60, "a starved machine is stepped down")
assert.ok(!s.stopped, "a starved machine is not stopped yet")

// Starved all the way down, the ride gives up rather than hang the desktop.
s = Auto.initial(3, 60)
s = feed(s, starved(60))
assert.equal(Auto.level(s), 0, "the ride walks down to the lowest quality")
assert.equal(Auto.fps(s), 30, "the ride walks down to 30 fps")
assert.ok(s.stopped, "the ride gives up when nothing works")

// A single stalled frame is enough to step down.
s = Auto.initial(3, 60)
s = feed(s, healthy(20))
const before = Auto.level(s)
const beforeFps = Auto.fps(s)
s = Auto.observe(s, 0.9)
assert.ok(Auto.level(s) < before || Auto.fps(s) < beforeFps, "a stalled frame steps the ride down")

// A ceiling the machine cannot carry is stepped below, not obeyed to death.
s = Auto.initial(3, 60)
s = feed(s, healthy(20))
assert.equal(Auto.level(s), 3, "the machine proves it can do more")
s = feed(s, starved(60))
assert.ok(Auto.level(s) < 3, "the ride steps below the ceiling it cannot carry")
assert.ok(s.stopped, "and gives up when even the bottom is too much")

// A new ride starts at the bottom again.
s = Auto.initial(3, 60)
s = feed(s, healthy(20))
s = Auto.reset(s)
assert.equal(Auto.level(s), 0, "a new ride starts at the bottom")
assert.equal(Auto.fps(s), 30, "a new ride starts at 30 fps")
assert.ok(!s.stopped, "a new ride is not stopped")

// Nothing is decided from the warm-up frames.
s = Auto.initial(3, 60)
s = feed(s, new Array(20).fill(0.4))
assert.equal(Auto.level(s), 0, "the warm-up frames decide nothing")
assert.equal(Auto.fps(s), 30, "the warm-up frames decide nothing")
assert.ok(!s.stopped, "the warm-up frames do not stop the ride")

// Bad measurements are ignored.
s = Auto.initial(3, 60)
s = Auto.observe(s, 0)
s = Auto.observe(s, -1)
s = Auto.observe(s, NaN)
assert.equal(Auto.level(s), 0, "a bad measurement changes nothing")
assert.ok(!s.stopped, "a bad measurement does not stop the ride")

// A 30 Hz display is slow, but it is not a machine in trouble.
s = Auto.initial(3, 60)
s = feed(s, healthy(30, 1 / 30))
assert.equal(Auto.level(s), 3, "a 30 Hz display is not mistaken for a starved machine")
assert.ok(!s.stopped, "a 30 Hz display is not mistaken for a starved machine")

// The names match the level the ride is running at.
assert.equal(Auto.name(Auto.initial(0, 30)), "low")
const climbed = feed(Auto.initial(3, 60), healthy(60))
assert.equal(Auto.name(climbed), "ultra")

console.log("ok: the watchdog climbs to the ceiling, steps down, and gives up")
