"use strict";

const devices = [];
const iconPaths = {
  filter: '<path d="M5 4h14v3l-5 6v5l-4 2v-7L5 7V4Z"/>',
  pot: '<path d="M6 9h12v8a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3V9Z"/><path d="M9 6h6M4 11H2M22 11h-2"/>',
  router: '<path d="M4 15h16v5H4z"/><path d="M7 15V9M12 15V6M17 15V9"/>',
  remote: '<rect x="8" y="3" width="8" height="18" rx="2"/><path d="M10 7h4M10 11h4"/>',
  gateway: '<path d="M4 14h16v6H4z"/><path d="M7 14V5M11 14V5M15 14V5M19 14V5"/>',
  lock: '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  lamp: '<path d="M8 4h8l2 7H6l2-7Z"/><path d="M12 11v8M9 20h6"/>'
};

const CONNECT_RETRY_LIMIT = 3;
const CONNECT_RETRY_DELAY_MS = 900;

let activeRoom = "all";
let selectedId = "";
let selectedBluetoothDevice = null;
let selectedGattServer = null;
let selectedServices = [];
let systemBluetoothDevices = [];
const grid = document.querySelector("#deviceGrid");
const detail = document.querySelector("#detailCard");
const nearbyList = document.querySelector("#nearbyList");

function renderDevices() {
  const filtered = devices.filter((device) => activeRoom === "all" || device.roomId === activeRoom);
  if (!filtered.length) {
    grid.innerHTML = `<section class="empty-state"><h2>还没有真实设备</h2><p>点击右上角蓝牙按钮或“重新扫描”，选择附近的 BLE 智能硬件。系统会弹出附近设备列表。</p></section>`;
    return;
  }

  grid.innerHTML = filtered.map((device) => {
    const selected = device.id === selectedId ? " selected" : "";
    const offline = device.offline ? " offline" : "";
    const metaPrefix = device.warning ? `<span class="warning">${device.warning}</span> | ` : "";
    return `<article class="device-card${selected}${offline}" data-id="${device.id}" tabindex="0" role="button" aria-label="${device.name}"><span class="badge">${device.status}</span><div class="device-icon"><svg viewBox="0 0 24 24" aria-hidden="true">${iconPaths[device.icon]}</svg></div><h3>${device.name}</h3><p>${device.room} | ${metaPrefix}${device.meta}</p></article>`;
  }).join("");
  document.querySelectorAll(".device-card").forEach((card) => {
    card.addEventListener("click", () => selectDevice(card.dataset.id));
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectDevice(card.dataset.id);
      }
    });
  });
}

function renderDetail() {
  const device = devices.find((item) => item.id === selectedId);
  if (!device) {
    detail.innerHTML = `<p class="eyebrow">Device Detail</p><h2>等待连接</h2><p class="notice">当前没有接入设备。请先扫描附近蓝牙设备。</p><button class="primary-button" type="button" id="detailScanButton">扫描真实蓝牙设备</button>`;
    document.querySelector("#detailScanButton").addEventListener("click", scan);
    return;
  }

  detail.innerHTML = `
    <p class="eyebrow">Device Detail</p>
    <h2>${device.name}</h2>
    <dl>
      <div><dt>房间</dt><dd>${device.room}</dd></div>
      <div><dt>连接</dt><dd>${device.status}</dd></div>
      <div><dt>信号</dt><dd>${device.signal}</dd></div>
      <div><dt>电量</dt><dd>${device.battery}</dd></div>
      <div><dt>服务</dt><dd>${device.services || "未读取"}</dd></div>
      <div><dt>信息</dt><dd>${device.meta}</dd></div>
    </dl>
    <div class="action-row">
      <button class="primary-button" type="button" id="connectButton">${device.connected ? "重新连接" : "连接 GATT"}</button>
      <button class="text-button wide" type="button" id="toneButton">提示音</button>
      <button class="text-button wide" type="button" id="systemButton">系统设置</button>
      <button class="text-button wide" type="button" id="forgetButton">移除</button>
    </div>
    <form class="wifi-form" id="wifiForm">
      <p class="notice">WiFi 配网需要设备厂商提供 BLE 服务 UUID 和写入特征 UUID。填入后会把 SSID/密码写入设备。</p>
      <label>WiFi 名称<input name="ssid" autocomplete="off" placeholder="家里的 WiFi 名称" /></label>
      <label>WiFi 密码<input name="password" type="password" autocomplete="off" placeholder="WiFi 密码" /></label>
      <label>服务 UUID<input name="serviceUuid" autocomplete="off" placeholder="例如 0000xxxx-0000-1000-8000-00805f9b34fb" /></label>
      <label>写入特征 UUID<input name="characteristicUuid" autocomplete="off" placeholder="厂商配网 characteristic UUID" /></label>
      <button class="primary-button" type="submit">写入 WiFi 配网</button>
    </form>
  `;

  document.querySelector("#connectButton").addEventListener("click", connectSelectedDevice);
  document.querySelector("#toneButton").addEventListener("click", playPromptTone);
  document.querySelector("#systemButton").addEventListener("click", openSystemAudioSettings);
  document.querySelector("#forgetButton").addEventListener("click", forgetSelectedDevice);
  document.querySelector("#wifiForm").addEventListener("submit", provisionWifi);
}

function renderNearby(devicesFromBluetooth = [], scanning = false) {
  if (scanning) {
    nearbyList.innerHTML = `<li><span>正在打开系统蓝牙扫描...</span><small>BLE</small></li>${renderSystemDeviceRows()}`;
    return;
  }

  const bleRows = devicesFromBluetooth.length ? devicesFromBluetooth.map((device) => `
    <li>
      <button class="nearby-device ble-device" type="button" data-id="${device.deviceId}">
        <span>${device.deviceName}</span>
        <small>BLE</small>
      </button>
    </li>
  `).join("") : `<li><span>暂无 BLE 扫描结果</span><small>点击扫描</small></li>`;

  nearbyList.innerHTML = `${bleRows}${renderSystemDeviceRows()}`;

  document.querySelectorAll(".ble-device").forEach((button) => {
    button.addEventListener("click", () => {
      window.smartHomeBridge.selectBluetoothDevice(button.dataset.id);
    });
  });

  document.querySelectorAll(".system-device").forEach((button) => {
    button.addEventListener("click", () => selectSystemBluetoothDevice(button.dataset.address));
  });
}

function renderSystemDeviceRows() {
  if (!systemBluetoothDevices.length) return "";
  return `
    <li class="nearby-section">系统蓝牙设备</li>
    ${systemBluetoothDevices.map((device) => `
      <li>
        <button class="nearby-device system-device" type="button" data-address="${device.address}">
          <span>${device.name}</span>
          <small>${device.kind}${device.paired ? " 已配对" : ""}</small>
        </button>
      </li>
    `).join("")}
  `;
}

function selectDevice(id) {
  selectedId = id;
  renderDevices();
  renderDetail();
}

async function scan() {
  await refreshSystemBluetoothDevices();
  if (!navigator.bluetooth) {
    renderNearby([], false);
    detail.innerHTML = `<p class="eyebrow">Bluetooth</p><h2>当前环境不支持</h2><p class="notice">请通过 Electron 桌面客户端打开，不要只用普通浏览器打开 index.html。</p>`;
    return;
  }

  renderNearby([], true);

  try {
    const bluetoothDevice = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: ["battery_service", "device_information", "generic_access"]
    });
    selectedBluetoothDevice = bluetoothDevice;
    bluetoothDevice.addEventListener("gattserverdisconnected", onGattDisconnected);
    upsertBluetoothDevice(bluetoothDevice, false);
    await connectSelectedDevice();
  } catch (error) {
    if (error.name !== "NotFoundError") {
      showDetailError("蓝牙扫描失败", error.message);
    }
    renderNearby([], false);
  }
}

async function refreshSystemBluetoothDevices() {
  try {
    if (!window.smartHomeBridge || !window.smartHomeBridge.getSystemBluetoothDevices) return;
    const allDevices = await window.smartHomeBridge.getSystemBluetoothDevices();
    systemBluetoothDevices = allDevices.filter((device) => {
      return /bose|soundlink|revolve/i.test(device.name) || device.kind === "Classic";
    });
  } catch (error) {
    console.warn("System Bluetooth device lookup failed:", error);
    systemBluetoothDevices = [];
  }
}

function selectSystemBluetoothDevice(address) {
  const systemDevice = systemBluetoothDevices.find((device) => device.address === address);
  if (!systemDevice) return;
  selectedBluetoothDevice = null;
  selectedGattServer = null;
  selectedServices = [];
  const fakeDevice = {
    id: `system-${systemDevice.address}`,
    name: systemDevice.name,
    room: "未分配",
    roomId: "unassigned",
    status: systemDevice.paired ? "系统已配对" : "系统缓存",
    meta: systemDevice.lowEnergy ? "BLE 系统设备" : "Classic 音频设备，不走 GATT",
    signal: systemDevice.kind,
    battery: "系统读取",
    icon: "gateway",
    warning: systemDevice.lowEnergy ? "系统 BLE" : "非 LE",
    connected: false,
    services: systemDevice.paired ? "系统蓝牙" : "未配对",
    systemAddress: systemDevice.address,
    systemKind: systemDevice.kind
  };
  const existing = devices.find((item) => item.id === fakeDevice.id);
  if (existing) Object.assign(existing, fakeDevice);
  else devices.unshift(fakeDevice);
  selectedId = fakeDevice.id;
  renderDevices();
  renderDetail();
}

async function connectSelectedDevice() {
  if (!selectedBluetoothDevice || !selectedBluetoothDevice.gatt) {
    const device = devices.find((item) => item.id === selectedId);
    if (device && device.systemKind === "Classic") {
      showDetailError("这是非 LE 音频设备", "这个设备不通过 GATT 连接。请在 macOS 系统蓝牙里连接它，然后在声音输出里选择 Bose。");
      return;
    }
    showDetailError("还没有选择 BLE 设备", "请先扫描并选择一个 BLE 设备。");
    return;
  }

  const device = devices.find((item) => item.id === selectedId);
  if (device) {
    device.status = "连接中";
    device.meta = "准备重试 GATT";
    renderDevices();
    renderDetail();
  }

  for (let attempt = 1; attempt <= CONNECT_RETRY_LIMIT; attempt += 1) {
    try {
      updateSelectedDevice({
        status: "连接中",
        meta: `正在建立 GATT，第 ${attempt}/${CONNECT_RETRY_LIMIT} 次`
      });

      if (selectedBluetoothDevice.gatt.connected) {
        selectedBluetoothDevice.gatt.disconnect();
        await sleep(250);
      }

      selectedGattServer = await selectedBluetoothDevice.gatt.connect();
      selectedServices = await readAllowedServices(selectedGattServer);
      const battery = await readBatteryLevel(selectedGattServer);
      upsertBluetoothDevice(selectedBluetoothDevice, true, {
        battery: battery === null ? "未提供" : `${battery}%`,
        services: selectedServices === null ? "权限受限" : `${selectedServices.length} 个`,
        meta: selectedServices === null ? "GATT 已连接，服务读取受限" : "GATT 已连接"
      });
      await playPromptTone();
      return;
    } catch (error) {
      const finalAttempt = attempt === CONNECT_RETRY_LIMIT;
      if (!finalAttempt) {
        updateSelectedDevice({
          status: "重试中",
          meta: `第 ${attempt} 次失败，正在重试`
        });
        await sleep(CONNECT_RETRY_DELAY_MS);
        continue;
      }

      upsertBluetoothDevice(selectedBluetoothDevice, false, {
        status: "连接失败",
        meta: formatBluetoothError(selectedBluetoothDevice, error)
      });
    }
  }
}

async function readAllowedServices(server) {
  try {
    return await server.getPrimaryServices();
  } catch (_error) {
    return null;
  }
}

async function readBatteryLevel(server) {
  try {
    const service = await server.getPrimaryService("battery_service");
    const characteristic = await service.getCharacteristic("battery_level");
    const value = await characteristic.readValue();
    return value.getUint8(0);
  } catch (_error) {
    return null;
  }
}

function updateSelectedDevice(patch) {
  const device = devices.find((item) => item.id === selectedId);
  if (!device) return;
  Object.assign(device, patch);
  renderDevices();
  renderDetail();
}

function upsertBluetoothDevice(bluetoothDevice, connected, overrides = {}) {
  const id = bluetoothDevice.id;
  const existing = devices.find((item) => item.id === id);
  const next = {
    id,
    name: bluetoothDevice.name || "未命名 BLE 设备",
    room: "未分配",
    roomId: "unassigned",
    status: connected ? "已连接" : "已发现",
    meta: connected ? "GATT 已连接" : "等待连接",
    signal: "BLE",
    battery: "未读取",
    icon: "gateway",
    warning: "真实设备",
    connected,
    services: "未读取",
    ...overrides
  };

  if (existing) {
    Object.assign(existing, next);
  } else {
    devices.unshift(next);
  }

  selectedId = id;
  renderDevices();
  renderDetail();
}

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function formatBluetoothError(bluetoothDevice, error) {
  const message = error && error.message ? error.message : "未知蓝牙错误";
  const name = bluetoothDevice.name || "";
  if (/bose|soundlink|revolve/i.test(name)) {
    return `重试 ${CONNECT_RETRY_LIMIT} 次失败：${message}。这个 Bose 音箱大概率是蓝牙音频设备，不开放 BLE GATT 控制。请先用 macOS 系统蓝牙连接它。`;
  }
  return `重试 ${CONNECT_RETRY_LIMIT} 次失败：${message}`;
}

async function playPromptTone() {
  let webAudioPlayed = false;
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (AudioContext) {
    const audioContext = new AudioContext();
    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }

    const master = audioContext.createGain();
    master.gain.setValueAtTime(0.0001, audioContext.currentTime);
    master.gain.exponentialRampToValueAtTime(0.26, audioContext.currentTime + 0.03);
    master.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.72);
    master.connect(audioContext.destination);

    playBeep(audioContext, master, 660, 0, 0.18);
    playBeep(audioContext, master, 880, 0.2, 0.2);
    playBeep(audioContext, master, 1046.5, 0.44, 0.24);

    window.setTimeout(() => audioContext.close(), 900);
    webAudioPlayed = true;
  }

  if (window.smartHomeBridge && window.smartHomeBridge.playNativePromptTone) {
    try {
      await window.smartHomeBridge.playNativePromptTone();
      return;
    } catch (error) {
      if (!webAudioPlayed) {
        showDetailError("无法播放提示音", error.message);
      }
    }
  } else if (!webAudioPlayed) {
    showDetailError("无法播放提示音", "当前运行环境不支持音频播放。");
  }
}

async function openSystemAudioSettings() {
  if (!window.smartHomeBridge) return;
  if (window.smartHomeBridge.openBluetoothSettings) {
    await window.smartHomeBridge.openBluetoothSettings();
  }
  if (window.smartHomeBridge.openSoundOutputSettings) {
    await window.smartHomeBridge.openSoundOutputSettings();
  }
}

function playBeep(audioContext, output, frequency, delay, duration) {
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  const start = audioContext.currentTime + delay;
  const end = start + duration;

  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(1, start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, end);
  oscillator.connect(gain);
  gain.connect(output);
  oscillator.start(start);
  oscillator.stop(end + 0.02);
}

function onGattDisconnected() {
  const device = devices.find((item) => item.id === selectedId);
  if (device) {
    device.connected = false;
    device.status = "已断开";
    device.meta = "蓝牙连接已断开";
    renderDevices();
    renderDetail();
  }
}

async function provisionWifi(event) {
  event.preventDefault();
  if (!selectedGattServer || !selectedGattServer.connected) {
    showDetailError("设备未连接", "请先连接 GATT，再写入 WiFi 配网信息。");
    return;
  }

  const data = new FormData(event.currentTarget);
  const ssid = String(data.get("ssid") || "").trim();
  const password = String(data.get("password") || "");
  const serviceUuid = String(data.get("serviceUuid") || "").trim();
  const characteristicUuid = String(data.get("characteristicUuid") || "").trim();

  if (!ssid || !serviceUuid || !characteristicUuid) {
    showDetailError("信息不完整", "WiFi 名称、服务 UUID 和写入特征 UUID 都需要填写。");
    return;
  }

  try {
    const service = await selectedGattServer.getPrimaryService(serviceUuid);
    const characteristic = await service.getCharacteristic(characteristicUuid);
    const payload = new TextEncoder().encode(JSON.stringify({ ssid, password }));
    await characteristic.writeValue(payload);
    showDetailError("WiFi 配网已写入", "设备是否成功联网取决于它的厂商协议和固件支持。");
  } catch (error) {
    showDetailError("WiFi 配网写入失败", error.message);
  }
}

function forgetSelectedDevice() {
  const index = devices.findIndex((item) => item.id === selectedId);
  if (index >= 0) {
    devices.splice(index, 1);
  }
  selectedBluetoothDevice = null;
  selectedGattServer = null;
  selectedServices = [];
  selectedId = devices[0] ? devices[0].id : "";
  renderDevices();
  renderDetail();
}

function showDetailError(title, message) {
  detail.innerHTML = `<p class="eyebrow">Status</p><h2>${title}</h2><p class="notice">${message}</p><div class="action-row"><button class="primary-button" type="button" id="backToScanButton">继续扫描</button><button class="text-button wide" type="button" id="errorToneButton">提示音</button></div>`;
  document.querySelector("#backToScanButton").addEventListener("click", scan);
  document.querySelector("#errorToneButton").addEventListener("click", playPromptTone);
}

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    activeRoom = tab.dataset.room;
    document.querySelectorAll(".tab").forEach((item) => item.classList.toggle("active", item === tab));
    const next = devices.find((device) => activeRoom === "all" || device.roomId === activeRoom);
    if (next) selectedId = next.id;
    renderDevices();
    renderDetail();
  });
});
document.querySelector("#scanButton").addEventListener("click", scan);
document.querySelector("#scanSmallButton").addEventListener("click", scan);
document.querySelector("#addButton").addEventListener("click", () => {
  activeRoom = "unassigned";
  document.querySelectorAll(".tab").forEach((item) => item.classList.toggle("active", item.dataset.room === activeRoom));
  selectedId = devices[0] ? devices[0].id : "";
  renderDevices();
  renderDetail();
});

if (window.smartHomeBridge) {
  window.smartHomeBridge.onBluetoothDevices((bluetoothDevices) => {
    renderNearby(bluetoothDevices, false);
  });
}

renderDevices();
renderDetail();
refreshSystemBluetoothDevices()
  .catch(() => {
    systemBluetoothDevices = [];
  })
  .finally(() => renderNearby());
