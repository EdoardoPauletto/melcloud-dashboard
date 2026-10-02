// ⚙️ VARIABILI GLOBALI E INIZIALIZZAZIONE ⚙️
// Definisce gli elementi DOM chiave che saranno utilizzati nel codice.
const grid            = document.getElementById('devicesGrid');       // La griglia dove verranno visualizzati i dispositivi.
const refreshBtn      = document.getElementById('refreshBtn');        // Il pulsante per aggiornare manualmente i dati.
const lastUpdated     = document.getElementById('lastUpdated');       // L'elemento che mostra l'orario dell'ultimo aggiornamento.
const intervalSelect  = document.getElementById('refreshInterval');   // Il selettore per l'intervallo di refresh automatico.
const logoutBtn       = document.getElementById('logoutBtn');         // Il pulsante di uscita, visibile con autenticazione per sessione.
const bodyEl          = document.body;                                // Il corpo della pagina, usato per gestire lo stato di apertura del drawer.

// Configurazione slider temperatura (in gradi Celsius).
const TEMP_SLIDER_MIN = 16;
const TEMP_SLIDER_MAX = 31;
const TEMP_SLIDER_STEP = 0.5;
const FAN_SLIDER_MIN = 1;
const FAN_SLIDER_MAX = 6;
const FAN_SLIDER_STEP = 1;

// Modalità di funzionamento, nell'ordine mostrato dal selettore. `value` è il codice
// OperationMode di MELCloud; `capability` è il flag del riepilogo che indica se il
// modello la supporta (null = sempre disponibile).
const OPERATION_MODES = [
  { value: 3, key: 'cool', icon: 'ac_unit',         capability: 'CanCool' },
  { value: 1, key: 'heat', icon: 'sunny',           capability: 'CanHeat' },
  { value: 2, key: 'dry',  icon: 'water_drop',      capability: 'CanDry' },
  { value: 7, key: 'fan',  icon: 'mode_fan',        capability: null },
  { value: 8, key: 'auto', icon: 'thermostat_auto', capability: 'CanAuto' }
];

// Stati globali e cache dei dati.
let autoRefreshTimer = null;                                          // Timer per il refresh automatico.
let devicesCache = [];                                                // Array che memorizza lo stato corrente di tutti i dispositivi.
let selectedDeviceId = null;                                          // ID del dispositivo attualmente selezionato per il controllo.
let commandInFlight = false;                                          // Flag che indica se un comando (es. accensione/spegnimento) è in fase di trasmissione.
let drawerElements = null;                                            // Elementi DOM del drawer, creato dopo il caricamento delle traduzioni.

// Testi tradotti dal catalogo centrale i18n/strings.json (vedi i18n/i18n.js).
const t = I18n.t;

/**
 * Traduzione già sanificata, da usare all'interno dei template HTML.
 * @param {string} key Chiave del catalogo.
 * @param {object} [params] Valori per i segnaposto {nome}.
 * @returns {string} Testo tradotto e con l'HTML neutralizzato.
 */
function th(key, params) {
  return escapeHtml(t(key, params));
}

async function apiFetch(url, options) {
  // Tutte le fetch della dashboard passano da qui. Il browser allega
  // automaticamente il cookie di sessione alle richieste verso la stessa origine.
  // La lingua esplicita fa sì che il server risponda con errori nella lingua della pagina.
  const headers = { 'Accept-Language': I18n.lang, ...options?.headers };
  const response = await fetch(url, { ...options, headers });
  if (response.status === 401) {
    // La sessione è scaduta o il server è stato riavviato: tornando alla root,
    // il backend servirà nuovamente la pagina di login.
    window.location.replace('./');
    throw new Error(t('dashboard.sessionExpired'));
  }
  return response;
}

/* ── Templates ──────────────────────────────────────────────── */

/**
 * Genera un template HTML scheletrico (skeleton) per visualizzare lo stato di caricamento.
 * Questo migliora l'esperienza utente mostrando una struttura prima che i dati arrivino.
 * @returns {string} HTML contenente i placeholder.
 */
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

/**
 * Genera un template HTML per mostrare un messaggio di errore.
 * @param {string} message Il messaggio di errore da visualizzare.
 * @returns {string} HTML con lo stato di errore.
 */
function errorHTML(message) {
  return `
    <div class="error-state" role="alert">
      <span class="material-symbols-rounded">cloud_off</span>
      <h2>${th('dashboard.loadError')}</h2>
      <p>${escapeHtml(message)}</p>
      <button class="btn-filled" onclick="loadDevices()">
        <span class="material-symbols-rounded">refresh</span>
        ${th('dashboard.retry')}
      </button>
    </div>`;
}

/**
 * Genera un template HTML per lo stato quando non ci sono dispositivi disponibili.
 * @returns {string} HTML con lo stato vuoto.
 */
function emptyHTML() {
  return `
    <div class="empty-state">
      <span class="material-symbols-rounded">devices_other</span>
      <p>${th('dashboard.noDevices')}</p>
    </div>`;
}

/**
 * Formatta il valore della temperatura, aggiungendo il simbolo di gradi.
 * @param {number | null} value Il valore numerico della temperatura.
 * @returns {string | null} La stringa formattata (es. "20.5 °C") o null se non disponibile.
 */
function formatTemp(value) {
  return value !== null ? `${I18n.formatNumber(value, 1)} °C` : null;
}

/**
 * Formatta il valore dell'energia, convertendolo in kWh e arrotondando.
 * @param {number | null} value Il valore numerico di consumo energetico (presumibilmente in milliwatt-ora).
 * @returns {string | null} La stringa formattata (es. "1.23 kWh") o null se non disponibile.
 */
function formatEnergy(value) {
  return value !== null ? `${I18n.formatNumber(value / 1000, 2)} kWh` : null;
}

/**
 * Crea un piccolo blocco di stato (stat) da visualizzare nella card del dispositivo.
 * @param {string} iconClass Classe CSS per lo stile dell'icona.
 * @param {string} icon Codice del simbolo Material Icons.
 * @param {number | null} value Il valore da mostrare.
 * @param {string} label L'etichetta descrittiva (es. "Temp. ambiente").
 * @returns {string} Il blocco HTML del singolo stat.
 */
function statHTML(iconClass, icon, value, label) {
  // Controlla se il valore è disponibile per mostrarlo, altrimenti mostra "—".
  const displayValue = value !== null
    ? `<span class="stat-value">${escapeHtml(value)}</span>`
    : `<span class="stat-value unavailable">—</span>`;
  return `
    <div class="stat">
      <span class="material-symbols-rounded stat-icon ${iconClass}">${icon}</span>
      ${displayValue}
      <span class="stat-label">${escapeHtml(label)}</span>
    </div>`;
}

/**
 * Genera l'intero template HTML per una singola scheda dispositivo.
 * @param {object} device L'oggetto dispositivo caricato dalla API.
 * @returns {string} L'HTML completo della scheda.
 */
function deviceCardHTML(device) {
  const isPowered = device.Power === true;
  const isOffline = device.Offline === true;
  const name      = device.name ?? t('device.unknownName');
  const deviceId  = Number.isInteger(device.id) ? String(device.id) : ''; // Assicura che l'ID sia una stringa per l'uso nell'attributo data.

  const chipClass = isPowered ? 'chip-on' : 'chip-off';
  const chipIcon  = isPowered ? 'power' : 'power_off';
  const chipLabel = th(isPowered ? 'device.on' : 'device.off');
  const controlHint = th(deviceId ? 'device.controlHint' : 'device.idUnavailable');

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
        ${th('device.offline')}
      </div>` : ''}
      <div class="card-divider"></div>
      <div class="card-stats">
        ${statHTML('temp',   'thermostat', formatTemp(device.RoomTemperature),        t('device.roomTemperature'))}
        ${statHTML('energy', 'bolt',       formatEnergy(device.CurrentEnergyConsumed), t('device.totalEnergy'))}
      </div>
      <div class="card-control-hint">
        <span class="material-symbols-rounded">tune</span>
        ${th('device.quickControls')}
      </div>
    </article>`;
}

/**
 * Crea e inizializza il pannello di controllo (Control Drawer/Sidebar).
 * Aggiunge gli event listener necessari per chiudere il pannello e interagire con gli switch.
 * @returns {object} Un oggetto contenente riferimenti agli elementi DOM del drawer per un facile accesso.
 */
function createControlDrawer() {
  const overlay = document.createElement('div');
  overlay.className = 'drawer-overlay';
  overlay.hidden = true;

  overlay.innerHTML = `
    <aside class="device-drawer" role="dialog" aria-modal="true" aria-labelledby="drawerDeviceTitle">
      <header class="drawer-header">
        <div>
          <p class="drawer-overline">${th('drawer.overline')}</p>
          <h2 id="drawerDeviceTitle" class="drawer-title">--</h2>
          <p id="drawerDeviceMeta" class="drawer-meta">--</p>
        </div>
        <button class="icon-btn drawer-close" type="button" aria-label="${th('drawer.close')}">
          <span class="material-symbols-rounded">close</span>
        </button>
      </header>
      <div class="drawer-body">
        <div class="md-switch-card">
          <div class="md-switch-copy">
            <span class="material-symbols-rounded">power_settings_new</span>
            <div>
              <p class="switch-label">${th('drawer.power')}</p>
              <p class="switch-caption" id="switchCaption">${th('drawer.powerUnknown')}</p>
            </div>
          </div>
          <label class="md-switch" aria-label="${th('drawer.powerSwitch')}">
            <input id="powerSwitch" type="checkbox" />
            <span class="track"></span>
            <span class="thumb"></span>
          </label>
        </div>
        <div class="md-mode-card">
          <div class="md-slider-copy">
            <span id="operationModeIcon" class="material-symbols-rounded">tune</span>
            <div>
              <p class="switch-label">${th('drawer.mode')}</p>
              <p class="switch-caption" id="operationModeCaption">${th('drawer.modeUnknown')}</p>
            </div>
          </div>
          <div id="operationModeGroup" class="md-segmented" role="radiogroup" aria-label="${th('drawer.modeGroup')}">
            ${OPERATION_MODES.map((mode) => `
            <label class="md-segment mode-${mode.key}" title="${th(`mode.${mode.key}Description`)}">
              <input type="radio" name="operationMode" value="${mode.value}" />
              <span class="md-segment-content">
                <span class="material-symbols-rounded">${mode.icon}</span>
                <span class="md-segment-label">${th(`mode.${mode.key}`)}</span>
              </span>
            </label>`).join('')}
          </div>
        </div>
        <div class="md-slider-card">
          <div class="md-slider-head">
            <div class="md-slider-copy">
              <span class="material-symbols-rounded">thermostat</span>
              <div>
                <p class="switch-label">${th('drawer.temperature')}</p>
                <p class="switch-caption">${th('drawer.temperatureCaption')}</p>
              </div>
            </div>
            <span id="temperatureValue" class="temperature-value">--</span>
          </div>
          <input id="temperatureSlider" class="md-slider" type="range" aria-label="${th('drawer.temperatureSlider')}" />
        </div>
        <div class="md-slider-card">
          <div class="md-slider-head">
            <div class="md-slider-copy">
              <span class="material-symbols-rounded">air</span>
              <div>
                <p class="switch-label">${th('drawer.fanSpeed')}</p>
                <p class="switch-caption">${th('drawer.fanSpeedCaption')}</p>
              </div>
            </div>
            <span id="fanSpeedValue" class="fan-speed-value">
              <span id="fanSpeedIcon" class="material-symbols-rounded fan-speed-icon">mode_fan</span>
              <span id="fanSpeedText">--</span>
            </span>
          </div>
          <input id="fanSpeedSlider" class="md-slider" type="range" aria-label="${th('drawer.fanSpeedSlider')}" />
        </div>
        <p id="drawerFeedback" class="drawer-feedback" aria-live="polite"></p>
      </div>
    </aside>`;

  bodyEl.appendChild(overlay);

  const drawer = overlay.querySelector('.device-drawer');
  const closeBtn = overlay.querySelector('.drawer-close');
  const powerSwitch = overlay.querySelector('#powerSwitch');
  const temperatureSlider = overlay.querySelector('#temperatureSlider');
  const fanSpeedSlider = overlay.querySelector('#fanSpeedSlider');
  const operationModeGroup = overlay.querySelector('#operationModeGroup');

  // Event Listener per chiudere il drawer:
  // 1. Click sul pulsante di chiusura.
  closeBtn.addEventListener('click', closeDrawer);
  // 2. Click fuori dal drawer (sull'overlay).
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) {
      closeDrawer();
    }
  });
  // 3. Tasto Esc sulla tastiera.
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !overlay.hidden) {
      closeDrawer();
    }
  });

  // Event Listener per l'interazione con lo switch di alimentazione.
  powerSwitch.addEventListener('change', onPowerSwitchChange);
  temperatureSlider.addEventListener('input', onTemperatureSliderInput);
  temperatureSlider.addEventListener('change', onTemperatureSliderChange);
  fanSpeedSlider.addEventListener('input', onFanSpeedSliderInput);
  fanSpeedSlider.addEventListener('change', onFanSpeedSliderChange);
  operationModeGroup.addEventListener('change', onOperationModeChange);

  temperatureSlider.min = String(TEMP_SLIDER_MIN);
  temperatureSlider.max = String(TEMP_SLIDER_MAX);
  temperatureSlider.step = String(TEMP_SLIDER_STEP);
  fanSpeedSlider.min = String(FAN_SLIDER_MIN);
  fanSpeedSlider.max = String(FAN_SLIDER_MAX);
  fanSpeedSlider.step = String(FAN_SLIDER_STEP);

  return {
    overlay,
    drawer,
    title: overlay.querySelector('#drawerDeviceTitle'),
    meta: overlay.querySelector('#drawerDeviceMeta'),
    powerSwitch,
    temperatureSlider,
    fanSpeedSlider,
    operationModeInputs: [...operationModeGroup.querySelectorAll('input[name="operationMode"]')],
    operationModeIcon: overlay.querySelector('#operationModeIcon'),
    operationModeCaption: overlay.querySelector('#operationModeCaption'),
    temperatureValue: overlay.querySelector('#temperatureValue'),
    fanSpeedValue: overlay.querySelector('#fanSpeedValue'),
    fanSpeedIcon: overlay.querySelector('#fanSpeedIcon'),
    fanSpeedText: overlay.querySelector('#fanSpeedText'),
    switchCaption: overlay.querySelector('#switchCaption'),
    feedback: overlay.querySelector('#drawerFeedback')
  };
}

/**
 * Aggiorna lo stato abilitato/disabilitato dei controlli nel drawer.
 */
function updateDrawerControlsState() {
  const selectedDevice = Number.isInteger(selectedDeviceId) ? getDeviceById(selectedDeviceId) : null;
  const isPowerKnown = Boolean(selectedDevice && typeof selectedDevice.Power === 'boolean');

  drawerElements.powerSwitch.disabled = !isPowerKnown || commandInFlight;
  drawerElements.temperatureSlider.disabled = !selectedDevice || commandInFlight;
  drawerElements.fanSpeedSlider.disabled = !selectedDevice || commandInFlight;
  drawerElements.operationModeInputs.forEach((input) => {
    input.disabled = !selectedDevice || commandInFlight;
  });
}

/**
 * Cerca la definizione di una modalità a partire dal codice OperationMode.
 * @param {unknown} value Codice OperationMode letto dal dispositivo.
 * @returns {object | null} La modalità corrispondente o null se sconosciuta.
 */
function getOperationMode(value) {
  return OPERATION_MODES.find((mode) => mode.value === value) ?? null;
}

/**
 * Nasconde dal selettore le modalità che il modello dichiara di non supportare.
 * @param {object} device Dispositivo selezionato.
 */
function updateOperationModeAvailability(device) {
  drawerElements.operationModeInputs.forEach((input) => {
    const mode = getOperationMode(Number(input.value));
    input.closest('.md-segment').hidden = Boolean(mode?.capability) && device[mode.capability] === false;
  });
}

/**
 * Seleziona il segmento della modalità indicata e aggiorna icona e descrizione.
 * @param {unknown} value Codice OperationMode; un valore sconosciuto deseleziona tutto.
 */
function updateOperationModeValue(value) {
  const mode = getOperationMode(value);

  drawerElements.operationModeInputs.forEach((input) => {
    input.checked = mode !== null && Number(input.value) === mode.value;
  });
  drawerElements.operationModeIcon.textContent = mode ? mode.icon : 'tune';
  drawerElements.operationModeIcon.classList.toggle('is-heat', mode?.key === 'heat');
  drawerElements.operationModeCaption.textContent = mode
    ? t(`mode.${mode.key}Description`)
    : t('drawer.modeUnknown');
}

/**
 * Mantiene la temperatura all'interno del range supportato dallo slider.
 * @param {number} value Temperatura da vincolare.
 * @returns {number} Temperatura limitata al range consentito.
 */
function clampTemperature(value) {
  return Math.min(TEMP_SLIDER_MAX, Math.max(TEMP_SLIDER_MIN, value));
}

/**
 * Aggiorna la label visiva della temperatura selezionata.
 * @param {number} value Temperatura da mostrare.
 */
function updateTemperatureValue(value) {
  drawerElements.temperatureValue.textContent = formatTemp(value);
}

/**
 * Vincola il valore dello slider ventola al range supportato.
 * @param {number} value Velocita da vincolare.
 * @returns {number} Velocita limitata al range consentito.
 */
function clampFanSliderValue(value) {
  const rounded = Math.round(value);
  return Math.min(FAN_SLIDER_MAX, Math.max(FAN_SLIDER_MIN, rounded));
}

/**
 * Traduce il valore del payload ventola in valore slider.
 * 1..5 restano invariati, 0/auto diventano 6.
 * @param {unknown} value Valore ventola letto dallo stato dispositivo.
 * @returns {number | null} Valore slider o null se non riconosciuto.
 */
function fanPayloadToSliderValue(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }

  if (value === 0) {
    return FAN_SLIDER_MAX;
  }

  if (value >= FAN_SLIDER_MIN && value <= FAN_SLIDER_MAX - 1) {
    return Math.round(value);
  }

  return null;
}

/**
 * Sceglie il valore iniziale dello slider ventola dal setpoint attuale.
 * @param {object} device Dispositivo selezionato.
 * @returns {number} Valore iniziale slider ventola.
 */
function getSliderInitialFanSpeed(device) {
  const setFan = fanPayloadToSliderValue(device.SetFanSpeed);
  if (setFan !== null) {
    return setFan;
  }

  const fan = fanPayloadToSliderValue(device.FanSpeed);
  if (fan !== null) {
    return fan;
  }

  return FAN_SLIDER_MAX;
}

/**
 * Converte il valore slider (1..6) nel payload API ventola.
 * @param {number} sliderValue Valore dello slider.
 * @returns {number | string} Valore da inviare al backend.
 */
function fanSliderToPayload(sliderValue) {
  return sliderValue === FAN_SLIDER_MAX ? 'auto' : sliderValue;
}

/**
 * Aggiorna il badge della ventola con valore e icona dinamici.
 * @param {number} sliderValue Valore dello slider ventola.
 */
function updateFanSpeedValue(sliderValue) {
  const clamped = clampFanSliderValue(sliderValue);
  const isAuto = clamped === FAN_SLIDER_MAX;

  drawerElements.fanSpeedText.textContent = isAuto ? t('drawer.fanSpeedAuto') : String(clamped);
  drawerElements.fanSpeedIcon.textContent = isAuto ? 'autorenew' : 'mode_fan';
  drawerElements.fanSpeedValue.classList.toggle('is-auto', isAuto);

  const fanScale = isAuto ? 1 : 0.9 + (clamped - FAN_SLIDER_MIN) * 0.12;
  drawerElements.fanSpeedIcon.style.setProperty('--fan-icon-scale', String(fanScale));
}

/**
 * Sceglie il valore iniziale dello slider usando SetTemperature, con fallback su temperatura ambiente.
 * @param {object} device Dispositivo selezionato.
 * @returns {number} Temperatura iniziale dello slider.
 */
function getSliderInitialTemperature(device) {
  const setTemperature = typeof device.SetTemperature === 'number' && Number.isFinite(device.SetTemperature)
    ? device.SetTemperature
    : null;

  if (setTemperature !== null) {
    return clampTemperature(setTemperature);
  }

  const roomTemperature = typeof device.RoomTemperature === 'number' && Number.isFinite(device.RoomTemperature)
    ? device.RoomTemperature
    : null;

  if (roomTemperature !== null) {
    return clampTemperature(roomTemperature);
  }

  return clampTemperature((TEMP_SLIDER_MIN + TEMP_SLIDER_MAX) / 2);
}

/**
 * Recupera un dispositivo specifico dalla cache basandosi sul suo ID.
 * @param {string | number} deviceId L'ID del dispositivo da cercare.
 * @returns {object | null} L'oggetto dispositivo trovato o null se non esiste.
 */
function getDeviceById(deviceId) {
  return devicesCache.find((device) => Number(device.id) === deviceId) ?? null; // Trova il dispositivo nella cache, assicurandosi che i tipi di ID coincidano.
}

/**
 * Popola il drawer con i dati dello stato del dispositivo indicato.
 * Non tocca il messaggio di feedback, così un aggiornamento dei dati dopo un
 * comando non cancella la conferma o l'errore appena mostrati.
 * @param {number} deviceId L'ID del dispositivo da visualizzare nel drawer.
 * @param {object} device Il dispositivo letto dalla cache.
 */
function renderDrawer(deviceId, device) {
  drawerElements.title.textContent = device.name ?? t('device.unknownName');
  drawerElements.meta.textContent = t('drawer.deviceId', { id: deviceId });

  // Configura l'input dello switch.
  const isPowerKnown = typeof device.Power === 'boolean';
  drawerElements.powerSwitch.checked = device.Power === true;
  // Aggiorna la caption per riflettere lo stato attuale.
  drawerElements.switchCaption.textContent = isPowerKnown
    ? t(device.Power ? 'drawer.powerOn' : 'drawer.powerOff')
    : t('drawer.powerUnknown');

  updateOperationModeAvailability(device);
  updateOperationModeValue(device.OperationMode);

  const sliderTemperature = getSliderInitialTemperature(device);
  drawerElements.temperatureSlider.value = String(sliderTemperature);
  updateTemperatureValue(sliderTemperature);

  const sliderFanSpeed = getSliderInitialFanSpeed(device);
  drawerElements.fanSpeedSlider.value = String(sliderFanSpeed);
  updateFanSpeedValue(sliderFanSpeed);

  updateDrawerControlsState();
}

/**
 * Apre il pannello di controllo (drawer) per un dispositivo specificato,
 * partendo senza messaggi di feedback residui da un dispositivo precedente.
 * @param {string | number} deviceId L'ID del dispositivo da visualizzare nel drawer.
 */
function openDrawerForDevice(deviceId) {
  const device = getDeviceById(deviceId);
  if (!device) {
    return; // Abbandona se il dispositivo non è trovato nella cache.
  }

  selectedDeviceId = deviceId;
  renderDrawer(deviceId, device);
  setFeedback('');

  drawerElements.overlay.hidden = false;
  requestAnimationFrame(() => drawerElements.overlay.classList.add('open'));
  bodyEl.classList.add('drawer-open'); // Blocca lo scroll dello sfondo.
}

/**
 * Chiude il pannello di controllo (drawer), rimuovendo le classi di apertura.
 */
function closeDrawer() {
  drawerElements.overlay.classList.remove('open');
  bodyEl.classList.remove('drawer-open');
  selectedDeviceId = null; // Resetta l'ID del dispositivo selezionato quando il drawer viene chiuso.

  setTimeout(() => { // Usa setTimeout per aspettare che l'animazione di chiusura sia completata (basato sull'CSS).
    if (!drawerElements.overlay.classList.contains('open')) {
      drawerElements.overlay.hidden = true;
    }
  }, 180);
}

/**
 * Imposta e visualizza un messaggio di feedback nel drawer (es. successo, errore).
 * @param {string} message Il testo del messaggio da mostrare.
 * @param {string} [tone=''] La tonalità (classe CSS) del messaggio (es. 'error', 'success', 'info').
 */
function setFeedback(message, tone = '') {
  drawerElements.feedback.className = `drawer-feedback ${tone}`.trim();
  drawerElements.feedback.textContent = message;
}

/**
 * Gestisce l'evento di cambio dello switch di alimentazione.
 * Invia una richiesta API e aggiorna lo stato locale e l'UI.
 * @param {Event} event L'evento di cambiamento dello switch.
 */
async function onPowerSwitchChange(event) {
  if (!Number.isInteger(selectedDeviceId) || commandInFlight) { // Non procedere se l'ID non è valido o se un comando è già in corso.
    return;
  }

  const targetPower = event.target.checked;
  const previousPower = !targetPower; // Lo stato prima del click, per il rollback in caso di errore.

  // Imposta lo stato di "comando in volo" per impedire doppio invio e disabilita lo switch.
  commandInFlight = true;
  updateDrawerControlsState();
  setFeedback(t('drawer.powerSending'), 'info');

  try {
    const res = await apiFetch(`/api/devices/${selectedDeviceId}/power`, {
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

    drawerElements.switchCaption.textContent = t(targetPower ? 'drawer.powerOn' : 'drawer.powerOff');
    setFeedback(t(targetPower ? 'drawer.powerSentOn' : 'drawer.powerSentOff'), 'success');

    await loadDevices(); // Ricarica tutti i dispositivi per sincronizzare completamente lo stato con il server.
  } catch (err) {
    event.target.checked = previousPower;
    setFeedback(t('drawer.powerFailed', { error: err.message ?? t('common.unknownError') }), 'error');
  } finally {
    commandInFlight = false;
    updateDrawerControlsState();
  }
}

/**
 * Invia al backend la modalità scelta nel selettore.
 * @param {Event} event Evento change del radio button selezionato.
 */
async function onOperationModeChange(event) {
  if (!Number.isInteger(selectedDeviceId) || commandInFlight) {
    return;
  }

  const targetMode = getOperationMode(Number(event.target.value));
  if (!targetMode) {
    return;
  }

  const currentDevice = getDeviceById(selectedDeviceId);
  const previousMode = currentDevice ? currentDevice.OperationMode : null; // Per il rollback in caso di errore.

  commandInFlight = true;
  updateDrawerControlsState();
  updateOperationModeValue(targetMode.value);
  setFeedback(t('drawer.modeSending'), 'info');

  try {
    const res = await apiFetch(`/api/devices/${selectedDeviceId}/set`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ mode: targetMode.value })
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }

    if (currentDevice) {
      currentDevice.OperationMode = targetMode.value;
    }

    setFeedback(t('drawer.modeSet', { mode: t(`mode.${targetMode.key}Description`) }), 'success');

    await loadDevices();
  } catch (err) {
    updateOperationModeValue(previousMode);
    setFeedback(t('drawer.modeFailed', { error: err.message ?? t('common.unknownError') }), 'error');
  } finally {
    commandInFlight = false;
    updateDrawerControlsState();
  }
}

/**
 * Aggiorna il valore mostrato accanto allo slider durante il trascinamento.
 * @param {Event} event Evento input del range slider.
 */
function onTemperatureSliderInput(event) {
  const sliderValue = Number.parseFloat(event.target.value);
  if (!Number.isFinite(sliderValue)) {
    return;
  }

  updateTemperatureValue(sliderValue);
}

/**
 * Aggiorna il valore mostrato accanto allo slider ventola durante il trascinamento.
 * @param {Event} event Evento input del range slider.
 */
function onFanSpeedSliderInput(event) {
  const sliderValue = Number.parseInt(event.target.value, 10);
  if (!Number.isFinite(sliderValue)) {
    return;
  }

  updateFanSpeedValue(sliderValue);
}

/**
 * Invia al backend la nuova temperatura impostata con lo slider.
 * @param {Event} event Evento change del range slider.
 */
async function onTemperatureSliderChange(event) {
  if (!Number.isInteger(selectedDeviceId) || commandInFlight) {
    return;
  }

  const slider = event.target;
  const rawTemperature = Number.parseFloat(slider.value);
  if (!Number.isFinite(rawTemperature)) {
    return;
  }

  const targetTemperature = clampTemperature(rawTemperature);
  const currentDevice = getDeviceById(selectedDeviceId);
  const previousSetTemperature = currentDevice && typeof currentDevice.SetTemperature === 'number'
    ? currentDevice.SetTemperature
    : null;

  commandInFlight = true;
  updateDrawerControlsState();
  setFeedback(t('drawer.temperatureSending'), 'info');

  try {
    const res = await apiFetch(`/api/devices/${selectedDeviceId}/set`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ temperature: targetTemperature })
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }

    if (currentDevice) {
      currentDevice.SetTemperature = targetTemperature;
    }

    updateTemperatureValue(targetTemperature);
    setFeedback(t('drawer.temperatureSet', { value: formatTemp(targetTemperature) }), 'success');

    await loadDevices();
  } catch (err) {
    if (previousSetTemperature !== null) {
      const rollbackTemperature = clampTemperature(previousSetTemperature);
      slider.value = String(rollbackTemperature);
      updateTemperatureValue(rollbackTemperature);
    }

    setFeedback(t('drawer.temperatureFailed', { error: err.message ?? t('common.unknownError') }), 'error');
  } finally {
    commandInFlight = false;
    updateDrawerControlsState();
  }
}

/**
 * Invia al backend la nuova velocita ventola impostata con lo slider.
 * @param {Event} event Evento change del range slider.
 */
async function onFanSpeedSliderChange(event) {
  if (!Number.isInteger(selectedDeviceId) || commandInFlight) {
    return;
  }

  const slider = event.target;
  const rawFanSliderValue = Number.parseInt(slider.value, 10);
  if (!Number.isFinite(rawFanSliderValue)) {
    return;
  }

  const targetFanSliderValue = clampFanSliderValue(rawFanSliderValue);
  const currentDevice = getDeviceById(selectedDeviceId);
  const previousFanSliderValue = currentDevice
    ? getSliderInitialFanSpeed(currentDevice)
    : FAN_SLIDER_MAX;

  commandInFlight = true;
  updateDrawerControlsState();
  setFeedback(t('drawer.fanSpeedSending'), 'info');

  try {
    const res = await apiFetch(`/api/devices/${selectedDeviceId}/set`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ fanSpeed: fanSliderToPayload(targetFanSliderValue) })
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }

    if (currentDevice) {
      const normalized = targetFanSliderValue === FAN_SLIDER_MAX ? 0 : targetFanSliderValue;
      currentDevice.SetFanSpeed = normalized;
      currentDevice.FanSpeed = normalized;
    }

    slider.value = String(targetFanSliderValue);
    updateFanSpeedValue(targetFanSliderValue);
    const fanSpeedLabel = targetFanSliderValue === FAN_SLIDER_MAX
      ? t('drawer.fanSpeedAuto')
      : String(targetFanSliderValue);
    setFeedback(t('drawer.fanSpeedSet', { value: fanSpeedLabel }), 'success');

    await loadDevices();
  } catch (err) {
    slider.value = String(previousFanSliderValue);
    updateFanSpeedValue(previousFanSliderValue);
    setFeedback(t('drawer.fanSpeedFailed', { error: err.message ?? t('common.unknownError') }), 'error');
  } finally {
    commandInFlight = false;
    updateDrawerControlsState();
  }
}

/* ── Helpers ────────────────────────────────────────────────── */


/**
 * Funzione di sicurezza per prevenire attacchi XSS, convertendo caratteri speciali in entità HTML.
 * @param {string} str La stringa da sterilizzare.
 * @returns {string} La stringa sicura.
 */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Aggiorna l'orario nell'elemento 'lastUpdated'.
 */
function updateTimestamp() {
  const now = new Date();
  const time = now.toLocaleTimeString(I18n.lang, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  lastUpdated.textContent = t('dashboard.lastUpdated', { time });
}

/**
 * Gestisce lo stato visivo del pulsante di refresh, rendendolo "spinner" se attivo.
 * @param {boolean} active Indica se il refresh è in corso.
 */
function setSpinning(active) {
  refreshBtn.classList.toggle('spinning', active);
  refreshBtn.disabled = active;
}

/* ── Core fetch ─────────────────────────────────────────────── */

/**
 * Funzione principale asincrona per caricare i dispositivi dalla API e aggiornare l'interfaccia (questo è il cuore della logica applicativa).
 */
async function loadDevices() {
  setSpinning(true);
  grid.innerHTML = skeletonHTML();

  try {
    const res = await apiFetch('/api/devices/summary');
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }

    const devices = await res.json();
    devicesCache = Array.isArray(devices) ? devices : []; // Aggiorna la cache con i dati ricevuti.

    if (!Array.isArray(devices) || devices.length === 0) {
      grid.innerHTML = emptyHTML();
    } else {
      grid.innerHTML = devices.map(deviceCardHTML).join(''); // Genera e inserisce tutte le schede dispositivi.
    }

    if (Number.isInteger(selectedDeviceId)) {
      const selectedDevice = getDeviceById(selectedDeviceId);
      if (selectedDevice) {
        renderDrawer(selectedDeviceId, selectedDevice); // Aggiorna i valori mantenendo il feedback visibile.
      } else {
        closeDrawer(); // Chiudi il drawer se il dispositivo è sparito dalla cache.
      }
    }

    updateTimestamp();
  } catch (err) {
    grid.innerHTML = errorHTML(err.message ?? t('common.unknownError'));
  } finally {
    setSpinning(false);
  }
}

// 🖱️ Event Listener: Click sulla griglia 🖱️
grid.addEventListener('click', (event) => {
  const card = event.target.closest('.control-card'); // Trova la card più vicina se il click è all'interno.
  if (!card) {
    return;
  }

  const id = Number(card.dataset.deviceId);
  if (!Number.isInteger(id) || id <= 0) { // Verifica che l'ID sia valido prima di aprire il drawer.
    return;
  }

  openDrawerForDevice(id);
});

// TODO da valutare se vengono veramente utilizzati, altrimenti da rimuovere
// ⌨️ Event Listener: Tasto premuto sulla griglia ⌨️
grid.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') { // Assicura che venga attivato solo premendo Invio o Spazio.
    return;
  }

  const card = event.target.closest('.control-card');
  if (!card) {
    return;
  }

  event.preventDefault(); // Previene azioni predefinite del browser (es. scroll con lo spazio).

  const id = Number(card.dataset.deviceId);
  if (!Number.isInteger(id) || id <= 0) {
    return;
  }

  openDrawerForDevice(id);
});

/* ── Auto-refresh ──────────────────────────────────────────── */
/**
 * Imposta o resetta l'intervallo di refresh automatico basato sul valore nel selettore.
 * Se l'intervallo è 0, disattiva il refresh automatico.
 */
function scheduleRefresh() {
  clearInterval(autoRefreshTimer);
  autoRefreshTimer = null;

  const seconds = parseInt(intervalSelect.value, 10);
  if (seconds > 0) {
    autoRefreshTimer = setInterval(loadDevices, seconds * 1000);
  }
}

intervalSelect.addEventListener('change', scheduleRefresh); // Aggiorna l'intervallo ogni volta che l'utente cambia il selettore.

refreshBtn.addEventListener('click', () => { // Gestisce il click sul pulsante di refresh manuale.
  scheduleRefresh();
  loadDevices(); // Avvia il caricamento immediato.
});

logoutBtn.addEventListener('click', async () => {
  logoutBtn.disabled = true;
  await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
  window.location.replace('./');
});

fetch('/api/auth/status')
  .then((response) => response.json())
  .then((status) => {
    logoutBtn.hidden = !status.sessionLogin;
  })
  .catch(() => {});

// 🚀 Inizializzazione: attende le traduzioni, poi crea il drawer, avvia il primo
// caricamento dei dati e imposta l'intervallo iniziale.
I18n.ready.then(() => {
  drawerElements = createControlDrawer();
  scheduleRefresh();
  loadDevices();
});
