import QtQuick
import Quickshell
import qs.Commons
import qs.Commons as Commons
import qs.Ui

Panel {
  id: root
  moduleName: "io.github.psthelyblog.neon-train-screensaver"
  ipcTarget: "loopline-panel"

  property var service: null
  readonly property bool running: service ? service.active : false
  readonly property string icon: String.fromCodePoint(0xF052C)
  readonly property color dim: Qt.darker(root.bar.foreground, 1.4)

  readonly property string subtitle: {
    if (!service) return ""
    if (running) return strings.t("subtitle.running")
    if (!service.startWhenIdle) return strings.t("subtitle.manual")
    return strings.t("subtitle.idle").arg(minutesLabel(service.timeoutSeconds))
  }

  function minutesLabel(seconds) {
    var minutes = seconds / 60
    return strings.tn("idle.minutes", minutes).arg(Commons.I18n.formatNumber(minutes, minutes % 1 === 0 ? 0 : 1))
  }

  function set(key, value) {
    if (service) service.setSetting(key, value)
  }

  function ride() {
    close()
    if (service) service.start(false)
  }

  function resolveService() {
    var found = bar && bar.shell ? bar.shell.serviceFor("io.github.psthelyblog.neon-train-screensaver") : null
    if (found) service = found
  }

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  Commons.Translations { id: strings; directory: Qt.resolvedUrl("i18n") }

  // Third-party services can come up after the bar.
  Timer {
    interval: 500
    running: root.service === null
    repeat: true
    triggeredOnStart: true
    onTriggered: root.resolveService()
  }

  BarIconButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: root.icon
    tooltipText: strings.t("tooltip")
    onPressed: function(b) {
      if (b === Qt.RightButton) root.ride()
      else root.toggle()
    }
  }

  component Label: Text {
    textFormat: Text.PlainText
    color: root.bar.foreground
    font.family: root.bar.fontFamily
    font.pixelSize: Style.font.bodySmall
  }

  component SettingRow: Item {
    id: row
    property string label: ""
    default property alias control: slot.data
    width: parent ? parent.width : 0
    implicitHeight: visible ? Math.max(rowLabel.implicitHeight, slot.height) : 0

    Label {
      id: rowLabel
      anchors.left: parent.left
      anchors.right: slot.left
      anchors.rightMargin: Style.space(8)
      anchors.verticalCenter: parent.verticalCenter
      elide: Text.ElideRight
      text: row.label
    }
    Item {
      id: slot
      anchors.right: parent.right
      anchors.verticalCenter: parent.verticalCenter
      width: childrenRect.width
      height: childrenRect.height
    }
  }

  component Choice: ButtonGroup {
    foreground: root.bar.foreground
    background: root.bar.background
    fontFamily: root.bar.fontFamily
    fontSize: Style.font.bodySmall
    focusable: false
  }

  component Switch: ToggleSwitch {
    foreground: root.bar.foreground
  }

  KeyboardPanel {
    id: panel
    anchorItem: button
    owner: root
    bar: root.bar
    open: root.opened
    focusTarget: keyCatcher
    contentWidth: panel.fittedContentWidth(Style.space(380))
    contentHeight: panel.fittedContentHeight(column.implicitHeight)

    PanelKeyCatcher {
      id: keyCatcher
      anchors.fill: parent
      onActivateRequested: root.ride()
      onCloseRequested: root.close()
      onTabRequested: function(direction) { root.switchPanel(direction) }

      Column {
        id: column
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: parent.top
        spacing: Style.space(12)

        Item {
          width: parent.width
          implicitHeight: Math.max(heroIcon.implicitHeight, heroLabels.implicitHeight, rideButton.implicitHeight)

          Text {
            id: heroIcon
            anchors.left: parent.left
            anchors.verticalCenter: parent.verticalCenter
            textFormat: Text.PlainText
            text: root.icon
            color: root.bar.foreground
            font.family: root.bar.fontFamily
            font.pixelSize: Style.font.display
          }
          Column {
            id: heroLabels
            anchors.left: heroIcon.right
            anchors.leftMargin: Style.space(14)
            anchors.right: rideButton.left
            anchors.rightMargin: Style.space(10)
            anchors.verticalCenter: parent.verticalCenter
            spacing: Style.space(2)

            Text {
              width: parent.width
              textFormat: Text.PlainText
              text: strings.t("name")
              color: root.bar.foreground
              font.family: root.bar.fontFamily
              font.pixelSize: Style.font.title
              font.bold: true
              elide: Text.ElideRight
            }
            Text {
              width: parent.width
              textFormat: Text.PlainText
              text: root.subtitle
              color: root.dim
              font.family: root.bar.fontFamily
              font.pixelSize: Style.font.caption
              elide: Text.ElideRight
            }
          }
          Button {
            id: rideButton
            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter
            text: strings.t("start")
            fontSize: Style.font.bodySmall
            foreground: root.bar.foreground
            fontFamily: root.bar.fontFamily
            bordered: true
            enabled: root.service !== null
            onClicked: root.ride()
          }
        }

        SettingRow {
          label: strings.t("idle.start")
          Switch { checked: root.service ? root.service.startWhenIdle : false; onToggled: root.set("startWhenIdle", !checked) }
        }
        SettingRow {
          label: strings.t("idle.after")
          opacity: root.service && root.service.startWhenIdle ? 1 : 0.4
          Choice {
            options: [60, 150, 300, 600].map(function(seconds) { return { value: String(seconds), label: root.minutesLabel(seconds) } })
            value: root.service ? String(root.service.timeoutSeconds) : ""
            onChanged: function(v) { root.set("timeout", Number(v)) }
          }
        }

        PanelSeparator { width: parent.width; foreground: root.bar.foreground }
        PanelSectionHeader { text: strings.t("section.graphics"); foreground: root.bar.foreground; fontFamily: root.bar.fontFamily }

        SettingRow {
          label: strings.t("quality")
          Choice {
            options: ["auto", "low", "medium", "high", "ultra"].map(function(q) { return { value: q, label: strings.t("quality." + q) } })
            value: root.service ? root.service.quality : ""
            onChanged: function(v) { root.set("quality", v) }
          }
        }
        SettingRow {
          label: strings.t("quality.running")
          visible: root.service ? root.service.runningQuality !== root.service.quality : false
          Label {
            text: root.service ? strings.t("quality.running.at").arg(root.service.runningQuality) : ""
            color: root.dim
            font.pixelSize: Style.font.bodySmall
          }
        }
        SettingRow {
          label: strings.t("quality.paused")
          visible: root.service ? root.service.blocked : false
          Button {
            text: strings.t("quality.paused.try")
            fontSize: Style.font.bodySmall
            foreground: root.bar.foreground
            fontFamily: root.bar.fontFamily
            bordered: true
            enabled: root.service !== null
            onClicked: { if (root.service) root.service.resume() }
          }
        }
        SettingRow {
          label: strings.t("fps")
          Choice {
            options: [30, 60].map(function(f) { return { value: String(f), label: strings.t("fps.value").arg(Commons.I18n.formatNumber(f, 0)) } })
            value: root.service ? String(root.service.userFps) : ""
            onChanged: function(v) { root.set("fps", Number(v)) }
          }
        }
        SettingRow {
          label: strings.t("rain")
          Choice {
            options: ["off", "light", "heavy"].map(function(r) { return { value: r, label: strings.t("rain." + r) } })
            value: root.service ? root.service.rain : ""
            onChanged: function(v) { root.set("rain", v) }
          }
        }
        SettingRow {
          label: strings.t("hud")
          Switch { checked: root.service ? root.service.hud : false; onToggled: root.set("hud", !checked) }
        }

        PanelSeparator { width: parent.width; foreground: root.bar.foreground }
        PanelSectionHeader { text: strings.t("section.sound"); foreground: root.bar.foreground; fontFamily: root.bar.fontFamily }

        SettingRow {
          label: strings.t("sound")
          Switch { checked: root.service ? root.service.sound : false; onToggled: root.set("sound", !checked) }
        }
        Column {
          width: parent.width
          spacing: Style.space(12)
          opacity: root.service && root.service.sound ? 1 : 0.4
          enabled: root.service !== null && root.service.sound

          SettingRow {
            label: strings.t("volume")
            PanelSlider {
              width: Style.space(200)
              bar: root.bar
              value: root.service ? root.service.volume : 0
              onReleased: function(v) { root.set("volume", Math.round(v * 100) / 100) }
            }
          }
          SettingRow {
            label: strings.t("sound.train")
            Switch { checked: root.service ? root.service.soundTrain : false; onToggled: root.set("soundTrain", !checked) }
          }
          SettingRow {
            label: strings.t("sound.rain")
            Switch { checked: root.service ? root.service.soundRain : false; onToggled: root.set("soundRain", !checked) }
          }
          SettingRow {
            label: strings.t("sound.chimes")
            Switch { checked: root.service ? root.service.soundChimes : false; onToggled: root.set("soundChimes", !checked) }
          }
        }
      }
    }
  }
}
