"use strict";

const { app, BrowserWindow, ipcMain, session, shell } = require("electron");
const { execFile } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

let mainWindow = null;
let bluetoothSelection = null;

function createWindow() {
  const win = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 920,
    minHeight: 680,
    title: "森居蓝牙管家",
    titleBarStyle: "hiddenInset",
    backgroundColor: "#020806",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      enableBlinkFeatures: "WebBluetooth"
    }
  });

  mainWindow = win;

  win.webContents.on("select-bluetooth-device", (event, devices, callback) => {
    event.preventDefault();
    bluetoothSelection = callback;
    win.webContents.send("bluetooth-device-list", devices.map((device) => ({
      deviceId: device.deviceId,
      deviceName: device.deviceName || "未命名 BLE 设备"
    })));
  });

  win.loadFile("index.html");
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
    return permission === "bluetooth" || permission === "bluetoothScanning";
  });

  session.defaultSession.setDevicePermissionHandler((details) => {
    return details.deviceType === "bluetooth";
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

ipcMain.on("select-bluetooth-device", (_event, deviceId) => {
  if (!bluetoothSelection) return;
  bluetoothSelection(deviceId);
  bluetoothSelection = null;
  if (mainWindow) {
    mainWindow.webContents.send("bluetooth-device-list", []);
  }
});

ipcMain.on("cancel-bluetooth-selection", () => {
  if (!bluetoothSelection) return;
  bluetoothSelection("");
  bluetoothSelection = null;
  if (mainWindow) {
    mainWindow.webContents.send("bluetooth-device-list", []);
  }
});

ipcMain.handle("play-native-prompt-tone", async () => {
  const tonePath = path.join(os.tmpdir(), "smart-home-prompt-tone.wav");
  fs.writeFileSync(tonePath, createPromptToneWav());
  await new Promise((resolve, reject) => {
    execFile("/usr/bin/afplay", [tonePath], (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
  return true;
});

ipcMain.handle("get-system-bluetooth-devices", async () => {
  const output = await new Promise((resolve) => {
    execFile("/usr/bin/defaults", ["read", "/Library/Preferences/com.apple.Bluetooth"], (error, stdout) => {
      resolve(error ? "" : stdout);
    });
  });
  return parseBluetoothPreference(output);
});

ipcMain.handle("open-bluetooth-settings", async () => {
  await shell.openExternal("x-apple.systempreferences:com.apple.Bluetooth");
  return true;
});

ipcMain.handle("open-sound-output-settings", async () => {
  await shell.openExternal("x-apple.systempreferences:com.apple.Sound-Settings.extension");
  return true;
});

function parseBluetoothPreference(text) {
  const paired = new Set(readAddressList(text, "PairedDevices"));
  const lowEnergy = new Set(readAddressList(text, "LEPairedDevices"));
  const devices = [];
  const cacheStart = text.indexOf("DeviceCache =");
  const cacheEnd = text.indexOf("\n    HIDDevices =", cacheStart);
  if (cacheStart < 0 || cacheEnd < 0) return devices;
  const cacheText = text.slice(cacheStart, cacheEnd);

  const blockPattern = /"([0-9a-f]{2}(?:-[0-9a-f]{2}){5})" =\s+\{([\s\S]*?)\n        \};/gi;
  let match = blockPattern.exec(cacheText);
  while (match) {
    const address = match[1].toLowerCase();
    const body = match[2];
    const nameMatch = body.match(/\n\s+Name = ("[^"]+"|[^;\n]+);/) || body.match(/\n\s+displayName = ("[^"]+"|[^;\n]+);/);
    const name = nameMatch ? decodeBluetoothName(nameMatch[1]) : "";
    if (name) {
      devices.push({
        address,
        name,
        paired: paired.has(address),
        lowEnergy: lowEnergy.has(address) || /^LE-/i.test(name),
        kind: lowEnergy.has(address) || /^LE-/i.test(name) ? "BLE" : "Classic"
      });
    }
    match = blockPattern.exec(cacheText);
  }

  return devices.sort((a, b) => Number(b.paired) - Number(a.paired) || a.name.localeCompare(b.name));
}

function readAddressList(text, key) {
  const match = text.match(new RegExp(`${key} =\\s+\\(([\\s\\S]*?)\\);`));
  if (!match) return [];
  return Array.from(match[1].matchAll(/"([0-9a-f]{2}(?:-[0-9a-f]{2}){5})"/gi), (item) => item[1].toLowerCase());
}

function decodeBluetoothName(value) {
  const trimmed = value.trim();
  if (!trimmed.startsWith('"')) return trimmed;
  return trimmed.slice(1, -1).replace(/\\U([0-9a-fA-F]{4})/g, (_match, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function createPromptToneWav() {
  const sampleRate = 44100;
  const durationSeconds = 0.9;
  const sampleCount = Math.floor(sampleRate * durationSeconds);
  const dataSize = sampleCount * 2;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < sampleCount; i += 1) {
    const time = i / sampleRate;
    const frequency = time < 0.22 ? 660 : time < 0.48 ? 880 : 1046.5;
    const envelope = Math.min(1, time / 0.03) * Math.max(0, 1 - time / durationSeconds);
    const sample = Math.sin(2 * Math.PI * frequency * time) * envelope * 0.24;
    buffer.writeInt16LE(Math.max(-1, Math.min(1, sample)) * 32767, 44 + i * 2);
  }

  return buffer;
}
