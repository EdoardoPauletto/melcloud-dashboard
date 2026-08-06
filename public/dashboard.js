// ⚙️ VARIABILI GLOBALI E INIZIALIZZAZIONE ⚙️
// Definisce gli elementi DOM chiave che saranno utilizzati nel codice.
const grid            = document.getElementById('devicesGrid');       // La griglia dove verranno visualizzati i dispositivi.
const refreshBtn      = document.getElementById('refreshBtn');        // Il pulsante per aggiornare manualmente i dati.
const lastUpdated     = document.getElementById('lastUpdated');       // L'elemento che mostra l'orario dell'ultimo aggiornamento.
const intervalSelect  = document.getElementById('refreshInterval');   // Il selettore per l'intervallo di refresh automatico.
const bodyEl          = document.body;                                // Il corpo della pagina, usato per gestire lo stato di apertura del drawer.

// Stati globali e cache dei dati.
let autoRefreshTimer = null;                                          // Timer per il refresh automatico.
let devicesCache = [];                                                // Array che memorizza lo stato corrente di tutti i dispositivi.
let selectedDeviceId = null;                                          // ID del dispositivo attualmente selezionato per il controllo.
let commandInFlight = false;                                          // Flag che indica se un comando (es. accensione/spegnimento) è in fase di trasmissione.

// Creazione del pannello di controllo (drawer) e memorizzazione dei suoi elementi DOM.
const drawerElements = createControlDrawer();

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
      <h2>Impossibile caricare i dispositivi</h2>
      <p>${escapeHtml(message)}</p>
      <button class="btn-filled" onclick="loadDevices()">
        <span class="material-symbols-rounded">refresh</span>
        Riprova
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
      <p>Nessun dispositivo trovato.</p>
    </div>`;
}

/**
 * Formatta il valore della temperatura, aggiungendo il simbolo di gradi.
 * @param {number | null} value Il valore numerico della temperatura.
 * @returns {string | null} La stringa formattata (es. "20.5 °C") o null se non disponibile.
 */
function formatTemp(value) {
  return value !== null ? `${value.toFixed(1)} °C` : null;
}

/**
 * Formatta il valore dell'energia, convertendolo in kWh e arrotondando.
 * @param {number | null} value Il valore numerico di consumo energetico (presumibilmente in milliwatt-ora).
 * @returns {string | null} La stringa formattata (es. "1.23 kWh") o null se non disponibile.
 */
function formatEnergy(value) {
  return value !== null ? `${(value / 1000).toFixed(2)} kWh` : null;
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
      <span class="stat-label">${label}</span>
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
  const name      = device.name ?? 'Dispositivo sconosciuto';
  const deviceId  = Number.isInteger(device.id) ? String(device.id) : ''; // Assicura che l'ID sia una stringa per l'uso nell'attributo data.

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

/**
 * Recupera un dispositivo specifico dalla cache basandosi sul suo ID.
 * @param {string | number} deviceId L'ID del dispositivo da cercare.
 * @returns {object | null} L'oggetto dispositivo trovato o null se non esiste.
 */
function getDeviceById(deviceId) {
  return devicesCache.find((device) => Number(device.id) === deviceId) ?? null; // Trova il dispositivo nella cache, assicurandosi che i tipi di ID coincidano.
}

/**
 * Apre il pannello di controllo (drawer) per un dispositivo specificato.
 * Popola il drawer con i dati dello stato del dispositivo selezionato.
 * @param {string | number} deviceId L'ID del dispositivo da visualizzare nel drawer.
 */
function openDrawerForDevice(deviceId) {
  const device = getDeviceById(deviceId);
  if (!device) {
    return; // Abbandona se il dispositivo non è trovato nella cache.
  }

  selectedDeviceId = deviceId;
  drawerElements.title.textContent = device.name ?? 'Dispositivo sconosciuto';
  drawerElements.meta.textContent = `ID dispositivo: ${deviceId}`;

  // Configura l'input dello switch.
  const isPowerKnown = typeof device.Power === 'boolean';
  drawerElements.powerSwitch.checked = device.Power === true;
  drawerElements.powerSwitch.disabled = !isPowerKnown || commandInFlight;
  // Aggiorna la caption per riflettere lo stato attuale.
  drawerElements.switchCaption.textContent = isPowerKnown
    ? (device.Power ? 'Il condizionatore è acceso' : 'Il condizionatore è spento')
    : 'Stato non disponibile';
  drawerElements.feedback.textContent = '';

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

    await loadDevices(); // Ricarica tutti i dispositivi per sincronizzare completamente lo stato con il server.
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
  lastUpdated.textContent =
    `Aggiornato alle ${now.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
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
    const res = await fetch('/api/devices/summary');
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
        openDrawerForDevice(selectedDeviceId);
      } else {
        closeDrawer(); // Chiudi il drawer se il dispositivo è sparito dalla cache.
      }
    }

    updateTimestamp();
  } catch (err) {
    grid.innerHTML = errorHTML(err.message ?? 'Errore sconosciuto');
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

// 🚀 Inizializzazione: Avvia il primo caricamento dei dati e imposta l'intervallo iniziale.
scheduleRefresh();
loadDevices();
