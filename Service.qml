import QtQuick
import QtMultimedia
import Quickshell
import Quickshell.Io
import Quickshell.Wayland
import qs.Commons
import "Sim.js" as Sim

// Owns everything that must exist once: the settings, the idle trigger, the
// ride, and its sound. Each screen gets a window that only draws the ride.
Item {
  id: root

  property var shell: null

  readonly property string configDir: (Quickshell.env("XDG_CONFIG_HOME") || (Quickshell.env("HOME") + "/.config")) + "/loopline"
  readonly property string settingsPath: configDir + "/settings.json"

  // Settings as the rest of the plugin reads them. The file can be edited by
  // hand, so every value is checked on the way in.
  readonly property bool startWhenIdle: cfg.startWhenIdle === true
  readonly property int timeoutSeconds: Math.max(30, Math.min(7200, Math.round(Number(cfg.timeout) || 150)))
  readonly property string quality: ["low", "medium", "high", "ultra"].indexOf(cfg.quality) >= 0 ? cfg.quality : "high"
  readonly property int qualityLevel: ["low", "medium", "high", "ultra"].indexOf(quality)
  readonly property int fps: Number(cfg.fps) === 30 ? 30 : 60
  readonly property string rain: ["off", "light", "heavy"].indexOf(cfg.rain) >= 0 ? cfg.rain : "light"
  readonly property real rainLevel: rain === "off" ? 0 : (rain === "light" ? 0.5 : 1)
  readonly property bool hud: cfg.hud !== false
  readonly property bool sound: cfg.sound !== false
  readonly property real volume: Math.max(0, Math.min(1, Number(cfg.volume)))
  readonly property bool soundTrain: cfg.soundTrain !== false
  readonly property bool soundRain: cfg.soundRain !== false
  readonly property bool soundChimes: cfg.soundChimes !== false

  // The ride, mirrored out of Sim.js for the windows to bind to.
  property bool active: false
  property bool startedByIdle: false
  property real startedAt: 0
  property var ride: null
  property real time: 0
  property real travel: 0
  property real speed: 0
  property real passZ: Sim.NO_TRAIN
  property bool atStation: false
  property int stationIndex: 0
  property real stationDistance: 0

  property real fade: 0
  property real tunnelMix: 0
  property real effort: 0
  readonly property real master: sound && active ? volume * volume * fade : 0
  readonly property real trainGain: soundTrain ? master : 0

  function setSetting(key, value) {
    var known = ["startWhenIdle", "timeout", "quality", "fps", "rain", "hud", "sound", "volume", "soundTrain", "soundRain", "soundChimes"]
    if (known.indexOf(key) >= 0) cfg[key] = value
  }

  function start(byIdle) {
    if (active) return
    ride = Sim.initial()
    fade = 0
    tunnelMix = 0
    effort = 0
    publish()
    startedByIdle = !!byIdle
    startedAt = Date.now()
    active = true
  }

  function stop() {
    if (!active) return
    active = false
    ride = null
  }

  function publish() {
    time = ride.time
    travel = ride.travel
    speed = ride.speed
    passZ = ride.passZ
    atStation = ride.dwell > 0
    stationIndex = ride.next
    stationDistance = Sim.ahead(ride.travel, Sim.STATIONS[ride.next])
  }

  // Called once a frame by the window on the first screen.
  function advance(dt) {
    if (!active || !ride) return
    var events = Sim.step(ride, dt, Math.random())
    publish()
    dt = Math.min(dt, 0.1)
    fade = Math.min(1, fade + dt / 1.5)
    tunnelMix += ((Sim.inTunnel(travel) ? 1 : 0) - tunnelMix) * Math.min(1, dt * 1.5)
    effort = speed > 0.3 ? Math.min(1, Math.abs(ride.accel) / 0.8) : 0
    for (var i = 0; i < events.length; i++) {
      var event = events[i]
      if (event === "clack" && speed > 1.5) clackFx.play()
      else if (event === "pass") passFx.play()
      else if (event === "arrive") chimeFx.play()
      else if (event === "doors") doorsFx.play()
    }
  }

  onActiveChanged: {
    var loops = [rumbleFx, humFx, motorFx, rainFx]
    for (var i = 0; i < loops.length; i++) {
      if (active) loops[i].play()
      else loops[i].stop()
    }
    if (!active) {
      var shots = [clackFx, passFx, chimeFx, doorsFx]
      for (var j = 0; j < shots.length; j++) shots[j].stop()
    }
    if (active) hideCursor.running = true
    else if (!hideCursor.running) restoreCursor()
  }

  // A pointer at rest keeps its arrow when a window appears beneath it, so
  // Hyprland is asked to hide an idle pointer for the length of the ride.
  property real cursorTimeoutBefore: 0

  function restoreCursor() {
    var seconds = Math.max(0, Number(cursorTimeoutBefore) || 0)
    showCursor.command = ["hyprctl", "eval", "hl.config({ cursor = { inactive_timeout = " + seconds + " } })"]
    showCursor.running = true
  }

  Process {
    id: hideCursor
    command: ["bash", "-c", "hyprctl -j getoption cursor:inactive_timeout | jq -r .float; hyprctl eval 'hl.config({ cursor = { inactive_timeout = 1 } })' >/dev/null"]
    stdout: StdioCollector {
      onStreamFinished: {
        var before = Number(String(text).trim())
        if (isFinite(before) && before !== 1) root.cursorTimeoutBefore = before
      }
    }
    onExited: if (!root.active) root.restoreCursor()
  }
  Process { id: showCursor }

  function idleReached() {
    if (active || !startWhenIdle || guard.running) return
    guard.running = true
  }

  function activityReported() {
    // Mapping the windows can itself be reported as activity; real input
    // reaches them directly, so the first moments are ignored here.
    if (active && startedByIdle && Date.now() - startedAt > 1500) stop()
  }

  FileView {
    id: settingsFile
    path: root.settingsPath
    watchChanges: true
    printErrors: false
    onFileChanged: reload()
    onAdapterUpdated: writeAdapter()
    onLoadFailed: makeConfigDir.running = true

    JsonAdapter {
      id: cfg
      property bool startWhenIdle: true
      property int timeout: 150
      property string quality: "high"
      property int fps: 60
      property string rain: "light"
      property bool hud: true
      property bool sound: true
      property real volume: 0.6
      property bool soundTrain: true
      property bool soundRain: true
      property bool soundChimes: true
    }
  }

  Process {
    id: makeConfigDir
    command: ["mkdir", "-p", root.configDir]
    onExited: settingsFile.writeAdapter()
  }

  IdleMonitor {
    id: idleMonitor
    enabled: root.startWhenIdle
    timeout: root.timeoutSeconds
    respectInhibitors: true
    onIsIdleChanged: isIdle ? root.idleReached() : root.activityReported()
  }

  // Stay out of the way of Omarchy's stay-awake switch and of the lock screen.
  Process {
    id: guard
    command: ["bash", "-lc", "[[ -f \"$HOME/.local/state/omarchy/indicators/stay-awake\" ]] && exit 1; [[ $(omarchy-shell lock isLocked 2>/dev/null) == true ]] && exit 1; exit 0"]
    onExited: function(exitCode) {
      if (exitCode === 0 && idleMonitor.isIdle) root.start(true)
    }
  }

  // Nobody is watching once the session locks.
  Timer {
    interval: 4000
    repeat: true
    running: root.active
    onTriggered: if (!lockProbe.running) lockProbe.running = true
  }
  Process {
    id: lockProbe
    command: ["bash", "-lc", "omarchy-shell lock isLocked 2>/dev/null"]
    stdout: StdioCollector {
      onStreamFinished: if (String(text).trim() === "true") root.stop()
    }
  }

  SoundEffect {
    id: rumbleFx
    source: Qt.resolvedUrl("sounds/rumble.wav")
    loops: SoundEffect.Infinite
    volume: root.trainGain * Math.pow(root.speed / Sim.VMAX, 1.3) * (0.7 + 0.3 * root.tunnelMix)
  }
  SoundEffect {
    id: humFx
    source: Qt.resolvedUrl("sounds/hum.wav")
    loops: SoundEffect.Infinite
    volume: root.trainGain * 0.3
  }
  SoundEffect {
    id: motorFx
    source: Qt.resolvedUrl("sounds/motor.wav")
    loops: SoundEffect.Infinite
    volume: root.trainGain * root.effort * 0.14
  }
  SoundEffect {
    id: rainFx
    source: Qt.resolvedUrl("sounds/rain.wav")
    loops: SoundEffect.Infinite
    volume: root.soundRain ? root.master * root.rainLevel * 0.6 * (1 - 0.75 * root.tunnelMix) : 0
  }
  SoundEffect {
    id: clackFx
    source: Qt.resolvedUrl("sounds/clack.wav")
    volume: root.trainGain * (0.3 + 0.5 * root.speed / Sim.VMAX)
  }
  SoundEffect {
    id: passFx
    source: Qt.resolvedUrl("sounds/pass.wav")
    volume: root.trainGain * 0.9
  }
  SoundEffect {
    id: chimeFx
    source: Qt.resolvedUrl("sounds/chime.wav")
    volume: root.soundChimes ? root.master * 0.6 : 0
  }
  SoundEffect {
    id: doorsFx
    source: Qt.resolvedUrl("sounds/doors.wav")
    volume: root.soundChimes ? root.master * 0.55 : 0
  }

  Variants {
    model: Quickshell.screens

    PanelWindow {
      id: window

      required property var modelData

      screen: modelData
      visible: root.active
      color: "black"
      anchors { top: true; bottom: true; left: true; right: true }
      exclusionMode: ExclusionMode.Ignore
      WlrLayershell.namespace: "loopline-screensaver"
      WlrLayershell.layer: WlrLayer.Overlay
      WlrLayershell.keyboardFocus: WlrKeyboardFocus.Exclusive

      Loader {
        anchors.fill: parent
        active: root.active
        sourceComponent: Ride {
          service: root
          driver: window.modelData === Quickshell.screens[0]
        }
      }
    }
  }

  ShellIpc {
    target: "loopline"

    function start(): void { root.start(false) }
    function stop(): void { root.stop() }
    function toggle(): void { root.active ? root.stop() : root.start(false) }
    function status(): string {
      return JSON.stringify({
        active: root.active, startedByIdle: root.startedByIdle, startWhenIdle: root.startWhenIdle,
        timeout: root.timeoutSeconds, travel: Math.round(root.travel), speed: Math.round(root.speed * 10) / 10,
        atStation: root.atStation, station: root.stationIndex
      })
    }
  }
}
