const grid            = document.getElementById('devicesGrid');
const refreshBtn      = document.getElementById('refreshBtn');
const lastUpdated     = document.getElementById('lastUpdated');
const intervalSelect  = document.getElementById('refreshInterval');
const bodyEl          = document.body;

let autoRefreshTimer = null;
let devicesCache = [];
let selectedDeviceId = null;
let commandInFlight = false;

const drawerElements = createControlDrawer();

/* ── Templates ──────────────────────────────────────────────── */

function skeletonHTML() {
  return Array.from({ length: 3 }).map(() => `
    <div class="skeleton-card" aria-hidden="true">
      <div class="skeleton-line skel-title"></div>
      <div class="skeleton-line skel-sub"></div>
      <div class="skeleton-line skel-divider"></div>
      <div class="skel-stats">
        <div class="skeleton-line skel-stat"></div>
        <div class="skeleton-line skel-stat"></div>
      </div>
    </div>`).join('');
}

function errorHTML(message) {
  return `
    <div class="error-state" role="alert">
      <span class="material-symbols-rounded">cloud_off</span>
      <h2>Impossibile caricare i dispositivi</h2>
      <p>${escapeHtml(message)}</p>
      <button class="btn-filled" onclick="loadDevices()">
        <span class="material-symbols-rounded">refresh</span>
        Riprova
      </button>
    </div>`;
}

function emptyHTML() {
  return `
    <div class="empty-state">
      <span class="material-symbols-rounded">devices_other</span>
      <p>Nessun dispositivo trovato.</p>
    </div>`;
}

function formatTemp(value) {
  return value !== null ? `${value.toFixed(1)} °C` : null;
}

function formatEnergy(value) {
  return value !== null ? `${(value / 1000).toFixed(2)} kWh` : null;
}

function statHTML(iconClass, icon, value, label) {
  const displayValue = value !== null
    ? `<span class="stat-value">${escapeHtml(value)}</span>`
    : `<span class="stat-value unavailable">—</span>`;
  return `
    <div class="stat">
      <span class="material-symbols-rounded stat-icon ${iconClass}">${icon}</span>
      ${displayValue}
      <span class="stat-label">${label}</span>
    </div>`;
}

function deviceCardHTML(device) {
  const isPowered = device.Power === true;
  const isOffline = device.Offline === true;
  const name      = device.name ?? 'Dispositivo sconosciuto';
  const deviceId  = Number.isInteger(device.id) ? String(device.id) : '';

  const chipClass = isPowered ? 'chip-on' : 'chip-off';
  const chipIcon  = isPowered ? 'power' : 'power_off';
  const chipLabel = isPowered ? 'Acceso' : 'Spento';
  const controlHint = deviceId ? 'Premi per controllare' : 'ID non disponibile';

  return `
    <article class="device-card control-card" role="button" tabindex="0" aria-label="${escapeHtml(name)}. ${controlHint}" data-device-id="${escapeHtml(deviceId)}" ${deviceId ? '' : 'aria-disabled="true"'}>
      <div class="card-header">
        <h2 class="card-name">${escapeHtml(name)}</h2>
        <span class="status-chip ${chipClass}">
          <span class="material-symbols-rounded">${chipIcon}</span>
          ${chipLabel}
        </span>
      </div>
      ${isOffline ? `
      <div class="offline-banner">
        <span class="material-symbols-rounded">wifi_off</span>
        Dispositivo non raggiungibile
      </div>` : ''}
      <div class="card-divider"></div>
      <div class="card-stats">
        ${statHTML('temp',   'thermostat', formatTemp(device.RoomTemperature),        'Temp. ambiente')}
        ${statHTML('energy', 'bolt',       formatEnergy(device.CurrentEnergyConsumed), 'Energia totale')}
      </div>
      <div class="card-control-hint">
        <span class="material-symbols-rounded">tune</span>
        Controlli rapidi
      </div>
    </article>`;
}

function createControlDrawer() {
  const overlay = document.createElement('div');
  overlay.className = 'drawer-overlay';
  overlay.hidden = true;

  overlay.innerHTML = `
    <aside class="device-drawer" role="dialog" aria-modal="true" aria-labelledby="drawerDeviceTitle">
      <header class="drawer-header">
        <div>
          <p class="drawer-overline">Controllo dispositivo</p>
          <h2 id="drawerDeviceTitle" class="drawer-title">--</h2>
          <p id="drawerDeviceMeta" class="drawer-meta">--</p>
        </div>
        <button class="icon-btn drawer-close" type="button" aria-label="Chiudi pannello">
          <span class="material-symbols-rounded">close</span>
        </button>
      </header>
      <div class="drawer-body">
        <div class="md-switch-card">
          <div class="md-switch-copy">
            <span class="material-symbols-rounded">power_settings_new</span>
            <div>
              <p class="switch-label">Alimentazione</p>
              <p class="switch-caption" id="switchCaption">Stato non disponibile</p>
            </div>
          </div>
          <label class="md-switch" aria-label="Interruttore accensione condizionatore">
            <input id="powerSwitch" type="checkbox" />
            <span class="track"></span>
            <span class="thumb"></span>
          </label>
        </div>
        <p id="drawerFeedback" class="drawer-feedback" aria-live="polite"></p>
      </div>
    </aside>`;

  bodyEl.appendChild(overlay);

  const drawer = overlay.querySelector('.device-drawer');
  const closeBtn = overlay.querySelector('.drawer-close');
  const powerSwitch = overlay.querySelector('#powerSwitch');

  closeBtn.addEventListener('click', closeDrawer);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) {
      closeDrawer();
    }
  });

  powerSwitch.addEventListener('change', onPowerSwitchChange);

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !overlay.hidden) {
      closeDrawer();
    }
  });

  return {
    overlay,
    drawer,
    title: overlay.querySelector('#drawerDeviceTitle'),
    meta: overlay.querySelector('#drawerDeviceMeta'),
    powerSwitch,
    switchCaption: overlay.querySelector('#switchCaption'),
    feedback: overlay.querySelector('#drawerFeedback')
  };
}

function getDeviceById(deviceId) {
  return devicesCache.find((device) => Number(device.id) === deviceId) ?? null;
}

function openDrawerForDevice(deviceId) {
  const device = getDeviceById(deviceId);
  if (!device) {
    return;
  }

  selectedDeviceId = deviceId;
  drawerElements.title.textContent = device.name ?? 'Dispositivo sconosciuto';
  drawerElements.meta.textContent = `ID dispositivo: ${deviceId}`;

  const isPowerKnown = typeof device.Power === 'boolean';
  drawerElements.powerSwitch.checked = device.Power === true;
  drawerElements.powerSwitch.disabled = !isPowerKnown || commandInFlight;
  drawerElements.switchCaption.textContent = isPowerKnown
    ? (device.Power ? 'Il condizionatore è acceso' : 'Il condizionatore è spento')
    : 'Stato non disponibile';
  drawerElements.feedback.textContent = '';

  drawerElements.overlay.hidden = false;
  requestAnimationFrame(() => drawerElements.overlay.classList.add('open'));
  bodyEl.classList.add('drawer-open');
}

function closeDrawer() {
  drawerElements.overlay.classList.remove('open');
  bodyEl.classList.remove('drawer-open');

  setTimeout(() => {
    if (!drawerElements.overlay.classList.contains('open')) {
      drawerElements.overlay.hidden = true;
    }
  }, 180);
}

function setFeedback(message, tone = '') {
  drawerElements.feedback.className = `drawer-feedback ${tone}`.trim();
  drawerElements.feedback.textContent = message;
}

async function onPowerSwitchChange(event) {
  if (!Number.isInteger(selectedDeviceId) || commandInFlight) {
    return;
  }

  const targetPower = event.target.checked;
  const previousPower = !targetPower;

  commandInFlight = true;
  drawerElements.powerSwitch.disabled = true;
  setFeedback('Invio comando in corso...', 'info');

  try {
    const res = await fetch(`/api/devices/${selectedDeviceId}/power`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ on: targetPower })
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }

    const currentDevice = getDeviceById(selectedDeviceId);
    if (currentDevice) {
      currentDevice.Power = targetPower;
    }

    drawerElements.switchCaption.textContent = targetPower
      ? 'Il condizionatore è acceso'
      : 'Il condizionatore è spento';
    setFeedback(targetPower ? 'Comando ON inviato con successo.' : 'Comando OFF inviato con successo.', 'success');

    await loadDevices();
  } catch (err) {
    event.target.checked = previousPower;
    setFeedback(`Comando non inviato: ${err.message ?? 'errore sconosciuto'}`, 'error');
  } finally {
    commandInFlight = false;
    const selectedDevice = Number.isInteger(selectedDeviceId) ? getDeviceById(selectedDeviceId) : null;
    drawerElements.powerSwitch.disabled = !selectedDevice || typeof selectedDevice.Power !== 'boolean';
  }
}

/* ── Helpers ────────────────────────────────────────────────── */

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function updateTimestamp() {
  const now = new Date();
  lastUpdated.textContent =
    `Aggiornato alle ${now.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
}

function setSpinning(active) {
  refreshBtn.classList.toggle('spinning', active);
  refreshBtn.disabled = active;
}

/* ── Core fetch ─────────────────────────────────────────────── */

async function loadDevices() {
  setSpinning(true);
  grid.innerHTML = skeletonHTML();

  try {
    const res = await fetch('/api/devices/summary');
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }

    const devices = await res.json();
    devicesCache = Array.isArray(devices) ? devices : [];

    if (!Array.isArray(devices) || devices.length === 0) {
      grid.innerHTML = emptyHTML();
    } else {
      grid.innerHTML = devices.map(deviceCardHTML).join('');
    }

    if (Number.isInteger(selectedDeviceId)) {
      const selectedDevice = getDeviceById(selectedDeviceId);
      if (selectedDevice) {
        openDrawerForDevice(selectedDeviceId);
      } else {
        closeDrawer();
      }
    }

    updateTimestamp();
  } catch (err) {
    grid.innerHTML = errorHTML(err.message ?? 'Errore sconosciuto');
  } finally {
    setSpinning(false);
  }
}

grid.addEventListener('click', (event) => {
  const card = event.target.closest('.control-card');
  if (!card) {
    return;
  }

  const id = Number(card.dataset.deviceId);
  if (!Number.isInteger(id) || id <= 0) {
    return;
  }

  openDrawerForDevice(id);
});

grid.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') {
    return;
  }

  const card = event.target.closest('.control-card');
  if (!card) {
    return;
  }

  event.preventDefault();

  const id = Number(card.dataset.deviceId);
  if (!Number.isInteger(id) || id <= 0) {
    return;
  }

  openDrawerForDevice(id);
});

/* ── Auto-refresh ──────────────────────────────────────────── */
function scheduleRefresh() {
  clearInterval(autoRefreshTimer);
  autoRefreshTimer = null;

  const seconds = parseInt(intervalSelect.value, 10);
  if (seconds > 0) {
    autoRefreshTimer = setInterval(loadDevices, seconds * 1000);
  }
}

intervalSelect.addEventListener('change', scheduleRefresh);

refreshBtn.addEventListener('click', () => {
  scheduleRefresh();
  loadDevices();
});

scheduleRefresh();
loadDevices();
