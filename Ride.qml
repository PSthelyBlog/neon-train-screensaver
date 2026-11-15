import QtQuick
import qs.Commons
import qs.Commons as Commons

// One screen's view of the ride. Any key, click, or real mouse movement ends it.
Item {
  id: root

  required property var service
  property bool driver: false

  readonly property real renderScale: [0.6, 0.8, 1, 1.5][service.qualityLevel]
  property bool armed: false
  property bool hasOrigin: false
  property point origin: Qt.point(0, 0)
  property real pending: 0
  property bool shown: false

  focus: true
  Keys.onPressed: function(event) {
    event.accepted = true
    root.service.stop()
  }

  Commons.Translations { id: strings; directory: Qt.resolvedUrl("i18n") }

  Component.onCompleted: {
    forceActiveFocus()
    shown = true
  }

  Timer { interval: 700; running: true; onTriggered: root.armed = true }

  FrameAnimation {
    running: root.driver
    onTriggered: {
      root.pending += frameTime
      root.service.reportFrame(frameTime)
      if (root.pending + 0.002 < 1 / root.service.fps) return
      root.service.advance(root.pending)
      root.pending = 0
    }
  }

  ShaderEffect {
    id: scene
    anchors.fill: parent
    blending: false
    opacity: root.shown ? 1 : 0
    Behavior on opacity { NumberAnimation { duration: Style.duration(280); easing.type: Easing.OutCubic } }

    layer.enabled: root.renderScale !== 1
    layer.smooth: true
    layer.textureSize: Qt.size(Math.max(1, Math.round(width * root.renderScale)), Math.max(1, Math.round(height * root.renderScale)))

    property real time: root.service.time
    property real travel: root.service.travel
    property real speed: root.service.speed
    property real passZ: root.service.passZ
    property real rain: root.service.rainLevel
    property real quality: root.service.qualityLevel
    property real aspect: height > 0 ? width / height : 1
    property real pixel: 1 / Math.max(1, height * root.renderScale)

    vertexShader: Qt.resolvedUrl("shaders/ride.vert.qsb")
    fragmentShader: Qt.resolvedUrl("shaders/ride.frag.qsb")
  }

  // Station display, like the strip above a carriage door.
  Rectangle {
    id: display
    readonly property bool wanted: root.service.hud && (root.service.atStation || root.service.stationDistance < 420)
    anchors.left: parent.left
    anchors.bottom: parent.bottom
    anchors.margins: Math.round(root.height * 0.045)
    width: label.implicitWidth + height
    height: Math.round(label.implicitHeight * 1.9)
    radius: Style.cornerRadius
    color: Qt.rgba(0, 0, 0, 0.55)
    border.width: 1
    border.color: Qt.rgba(0.2, 0.9, 0.85, 0.5)
    opacity: wanted ? 1 : 0
    Behavior on opacity { NumberAnimation { duration: Style.duration(display.wanted ? 180 : 120); easing.type: Easing.OutCubic } }

    Text {
      id: label
      anchors.centerIn: parent
      textFormat: Text.PlainText
      text: strings.t(root.service.atStation ? "hud.at" : "hud.next").arg(strings.t("station." + root.service.stationIndex))
      color: Qt.rgba(0.55, 0.98, 0.94, 1)
      font.family: Style.font.family
      font.pixelSize: Math.max(12, Math.round(root.height / 54))
      font.letterSpacing: 1.5
    }
  }

  MouseArea {
    anchors.fill: parent
    hoverEnabled: true
    acceptedButtons: Qt.AllButtons
    cursorShape: Qt.BlankCursor
    onPressed: root.service.stop()
    onWheel: root.service.stop()
    onPositionChanged: function(mouse) {
      if (!root.hasOrigin || !root.armed) {
        root.origin = Qt.point(mouse.x, mouse.y)
        root.hasOrigin = true
        return
      }
      if (Math.abs(mouse.x - root.origin.x) + Math.abs(mouse.y - root.origin.y) > 24) root.service.stop()
    }
  }
}
