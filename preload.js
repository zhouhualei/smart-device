"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("smartHomeBridge", {
  onBluetoothDevices(callback) {
    ipcRenderer.on("bluetooth-device-list", (_event, devices) => callback(devices));
  },
  selectBluetoothDevice(deviceId) {
    ipcRenderer.send("select-bluetooth-device", deviceId);
  },
  cancelBluetoothSelection() {
    ipcRenderer.send("cancel-bluetooth-selection");
  },
  playNativePromptTone() {
    return ipcRenderer.invoke("play-native-prompt-tone");
  },
  getSystemBluetoothDevices() {
    return ipcRenderer.invoke("get-system-bluetooth-devices");
  },
  openBluetoothSettings() {
    return ipcRenderer.invoke("open-bluetooth-settings");
  },
  openSoundOutputSettings() {
    return ipcRenderer.invoke("open-sound-output-settings");
  }
});

window.addEventListener("DOMContentLoaded", () => {
  document.body.dataset.runtime = "electron";
});
