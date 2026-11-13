// Run: node tests/sim.test.mjs
import { readFileSync } from "node:fs"
import assert from "node:assert/strict"

const source = readFileSync(new URL("../Sim.js", import.meta.url), "utf8").replace(".pragma library", "")
const Sim = new Function(source + "; return { LOOP, VMAX, STATIONS, NO_TRAIN, initial, step, ahead, nextStation, inTunnel }")()

assert.equal(Sim.nextStation(700), 1)
assert.equal(Sim.nextStation(4500), 0)
assert.equal(Sim.ahead(4700, 400), 500)

// Twenty minutes of riding at 60 fps: every station is served in order, the
// train stops exactly on its mark, and nothing leaves its range.
const s = Sim.initial()
const arrivals = []
let doors = 0, clacks = 0, passes = 0
for (let i = 0; i < 20 * 60 * 60; i++) {
  for (const event of Sim.step(s, 1 / 60, (i * 0.618) % 1)) {
    if (event === "arrive") { arrivals.push(s.next); assert.equal(s.travel, Sim.STATIONS[s.next]); assert.equal(s.speed, 0) }
    if (event === "doors") doors++
    if (event === "clack") clacks++
    if (event === "pass") passes++
  }
  assert.ok(s.travel >= 0 && s.travel < Sim.LOOP)
  assert.ok(s.speed >= 0 && s.speed <= Sim.VMAX)
  assert.ok(Number.isFinite(s.accel) && Math.abs(s.accel) < 2)
}
assert.ok(arrivals.length >= 8, "at least two loops")
arrivals.forEach((station, i) => assert.equal(station, (1 + i) % 4))
assert.ok(doors === arrivals.length || doors === arrivals.length - 1)
assert.ok(clacks > 500 && passes > 5)

// Bad time steps change nothing or are capped.
const t = Sim.initial()
assert.deepEqual(Sim.step(t, NaN, 0), [])
assert.deepEqual(Sim.step(t, -1, 0), [])
Sim.step(t, 50, 0)
assert.ok(t.travel < 703)
console.log("ok: " + arrivals.length + " stops, " + clacks + " rail joints, " + passes + " passing trains")
