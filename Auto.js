.pragma library

// The quality watchdog.
//
// The ride is a full-screen shader, so its quality level and its frame rate
// decide how hard the GPU works. A GPU that cannot keep up does not just
// look bad: it drags the whole desktop down with it, because the screensaver
// and the compositor share the same frame.
//
// The watchdog is handed the intervals between the frames the ride actually
// got, and keeps the ride within what the machine can deliver.
//
// The quality the user picked is the ceiling, not a promise. The ride starts
// on the cheapest rung and climbs towards the ceiling only while the machine
// proves it can stay there, and steps back down the moment it cannot. A
// machine that cannot carry the ceiling gets the cheapest ride that works,
// not a frozen desktop.
//
//   - The display's own pace is learned from the intervals themselves, so a
//     60 Hz and a 144 Hz screen are both judged against their own tick.
//   - A frame is late when it takes much longer than that tick. A share of
//     late frames over a window means the GPU is not keeping up.
//   - The frame rate the user picked is the ceiling too: the ride never goes
//     past it.
//   - At the bottom of the ladder, still behind, the ride gives up rather
//     than take the desktop down with it.
//
// A stall that stops the frames altogether is not visible in the frame
// times: no frames, no measurements. The service watches for that against
// the wall clock, and calls stall() for it.

var QUALITY_NAMES = ["low", "medium", "high", "ultra"]
var MIN_LEVEL = 0
var MAX_LEVEL = 3

// The frame rates the ride runs at.
var SLOW_FPS = 30
var FAST_FPS = 60

// The ladder, cheapest rung first. Each rung is [quality level, frame rate].
//
// The order is by cost. The quality level sets the render scale and the
// number of ray marching steps, the frame rate is the multiplier, so the
// cheap rungs come first and the expensive ones last. A rung is never
// skipped: the ride walks the ladder one step at a time.
var LADDER = [
  [0, 30], // low, 30 fps
  [0, 60], // low, 60 fps
  [1, 30], // medium, 30 fps
  [1, 60], // medium, 60 fps
  [2, 30], // high, 30 fps
  [2, 60], // high, 60 fps
  [3, 30], // ultra, 30 fps
  [3, 60]  // ultra, 60 fps
]

// A frame is late past this multiple of the display's own tick.
var LATE_RATIO = 1.5
// The share of late frames in a window that counts as the GPU falling behind.
var LATE_SHARE = 0.25
// The share of late frames under which the GPU has room to spare.
var CALM_SHARE = 0.05
// Frames in a window.
var WINDOW = 45
// Frames ignored at the start, while the shader is still warming up.
var WARMUP = 30
// Windows late before the ride steps down.
var BEHIND = 2
// Windows calm before the ride steps up.
var CLIMB = 3
// A single frame this long is a stall on its own.
var STALL = 0.5
// A median frame this long means the machine is starved whatever the display
// claims. It is set below 30 fps on purpose: a 30 Hz display is slow, but it
// is not a machine in trouble.
var STARVED = 1.0 / 24

// The ceiling is what the user asked for: a quality level and a frame rate.
function initial(ceilingLevel, fpsCap) {
  return {
    rung: 0,
    ceiling: ceilingOf(ceilingLevel, fpsCap),
    samples: [],
    since: 0,
    behind: 0,
    calm: 0,
    stopped: false
  }
}

function copy(state) {
  return {
    rung: state.rung,
    ceiling: state.ceiling,
    samples: state.samples.slice(),
    since: state.since,
    behind: state.behind,
    calm: state.calm,
    stopped: state.stopped
  }
}

// The highest rung the ceiling allows.
function ceilingOf(ceilingLevel, fpsCap) {
  var level = Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, ceilingLevel))
  var cap = fpsCap === SLOW_FPS ? SLOW_FPS : FAST_FPS
  var best = 0
  for (var i = 0; i < LADDER.length; i++) {
    if (LADDER[i][0] <= level && LADDER[i][1] <= cap) best = i
  }
  return best
}

// The quality level the ride should run at right now.
function level(state) {
  return LADDER[state.rung][0]
}

// The frame rate the ride should run at right now.
function fps(state) {
  return LADDER[state.rung][1]
}

function name(state) {
  return QUALITY_NAMES[level(state)]
}

// A new ride: the machine has to prove itself again, from the bottom.
function reset(state) {
  var s = copy(state)
  s.rung = 0
  s.samples = []
  s.since = 0
  s.behind = 0
  s.calm = 0
  s.stopped = false
  return s
}

// One frame interval, in seconds. Returns the new state.
//
// The decision is taken once per window, not once per frame: the frames in
// between are collected, and the window as a whole is judged.
function observe(state, interval) {
  var s = copy(state)
  if (!(interval > 0)) return s
  if (s.stopped) return s

  s.samples.push(interval)
  if (s.samples.length > WINDOW) s.samples.shift()
  s.since++

  // Nothing is decided from the first frames: the shader is still warming
  // up, and its first frames are always slow.
  if (s.samples.length < WARMUP) return s

  // A frame that took half a second is a stall on its own, whatever the
  // rest of the window looks like.
  if (interval >= STALL) return degrade(s)

  var sorted = s.samples.slice().sort(function(a, b) { return a - b })
  var median = sorted[Math.floor(sorted.length * 0.5)]

  // The machine is starving when the frames come far slower than any
  // display would deliver them, no matter how slow the display is. This is
  // judged on every frame, because a machine in this state is in trouble
  // right now, not in a window's time.
  if (median > STARVED) {
    s.calm = 0
    s.behind++
    if (s.behind >= BEHIND) return degrade(s)
    return s
  }

  // The rest is judged once per window: the frames in between are
  // collected, and the window as a whole is what counts.
  if (s.since < WINDOW) return s
  s.since = 0

  var tick = sorted[Math.floor(sorted.length * 0.25)]
  if (!(tick > 0)) tick = 0.004

  var late = 0
  for (var i = 0; i < s.samples.length; i++) {
    if (s.samples[i] > tick * LATE_RATIO) late++
  }
  var share = late / s.samples.length

  if (share > LATE_SHARE) {
    s.calm = 0
    s.behind++
    if (s.behind >= BEHIND) return degrade(s)
    return s
  }

  s.behind = 0
  if (share > CALM_SHARE) return s

  s.calm++
  if (s.calm >= CLIMB && s.rung < s.ceiling) {
    var climbed = copy(s)
    climbed.rung++
    climbed.calm = 0
    return climbed
  }
  return s
}

// Too heavy. Step down the ladder. At the very bottom, give up the ride
// rather than let the machine stall.
function degrade(state) {
  var s = copy(state)
  s.behind = 0
  s.calm = 0
  if (s.rung > 0) {
    s.rung--
  } else {
    s.stopped = true
  }
  return s
}

// The frames stopped coming altogether. That is the case the frame times
// cannot see: no frames, no measurements. The wall clock can.
function stall(state) {
  return degrade(state)
}
