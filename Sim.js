.pragma library

// The ride itself: where the train is on the loop, how fast it is going, and
// what just happened. The numbers that describe the line match ride.frag.

var LOOP = 4800
var VMAX = 23
var ACC = 0.75
var DEC = 0.85
var DWELL = 13
var DOORS_BEFORE_DEPARTURE = 3.2
var JOINT_SPACING = 18
var STATIONS = [400, 2300, 3400, 4350]
var TUNNEL = [1320, 1730]
var NO_TRAIN = 100000

function ahead(travel, target) {
  var d = target - travel
  return d < 0 ? d + LOOP : d
}

function nextStation(travel) {
  var best = 0
  for (var i = 1; i < STATIONS.length; i++) {
    if (ahead(travel, STATIONS[i]) < ahead(travel, STATIONS[best])) best = i
  }
  return best
}

function inTunnel(travel) {
  return travel > TUNNEL[0] && travel < TUNNEL[1]
}

function initial() {
  return {
    time: 0, travel: 700, speed: VMAX, accel: 0, dwell: 0,
    next: nextStation(700), odometer: 0, jointAt: JOINT_SPACING,
    passZ: NO_TRAIN, passWait: 20, passHeard: false
  }
}

// Advance the ride by dt seconds. `rand` is a number in [0, 1) used to space
// out the oncoming trains. Returns what happened: "arrive", "doors", "clack", "pass".
function step(s, dt, rand) {
  var events = []
  dt = Math.max(0, Math.min(Number(dt) || 0, 0.1))
  if (dt === 0) return events
  s.time = (s.time + dt) % 3600
  var before = s.speed

  if (s.dwell > 0) {
    var left = s.dwell - dt
    if (s.dwell > DOORS_BEFORE_DEPARTURE && left <= DOORS_BEFORE_DEPARTURE) events.push("doors")
    s.dwell = Math.max(left, 0)
    if (s.dwell === 0) s.next = (s.next + 1) % STATIONS.length
  } else {
    var d = ahead(s.travel, STATIONS[s.next])
    var braking = Math.sqrt(2 * DEC * d)
    if (braking < s.speed + ACC * dt) s.speed = Math.max(Math.min(s.speed, braking), 0.25)
    else s.speed = Math.min(VMAX, s.speed + ACC * dt)
    var moved = s.speed * dt
    if (moved >= d) {
      s.odometer += d
      s.travel = STATIONS[s.next]
      s.speed = 0
      s.dwell = DWELL
      events.push("arrive")
    } else {
      s.odometer += moved
      s.travel = (s.travel + moved) % LOOP
    }
    if (s.odometer >= s.jointAt) {
      s.jointAt += JOINT_SPACING
      events.push("clack")
    }
  }
  s.accel += ((s.speed - before) / dt - s.accel) * Math.min(1, dt * 4)

  if (s.passZ < NO_TRAIN) {
    s.passZ -= (s.speed + 21) * dt
    if (!s.passHeard && s.passZ < 125) {
      s.passHeard = true
      events.push("pass")
    }
    if (s.passZ < -500) s.passZ = NO_TRAIN
  } else if (s.speed > 12) {
    s.passWait -= dt
    if (s.passWait <= 0) {
      s.passZ = 500
      s.passHeard = false
      s.passWait = 30 + 50 * rand
    }
  }
  return events
}
