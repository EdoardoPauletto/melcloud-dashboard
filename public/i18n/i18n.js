// Traduzioni lato browser. Carica il catalogo centrale i18n/strings.json,
// sceglie la lingua in base alle preferenze del browser e traduce gli elementi
// HTML marcati con data-i18n, data-i18n-title e data-i18n-aria-label.
// Gli script delle pagine usano I18n.t() per i testi generati dinamicamente.
(() => {
  const STRINGS_URL = '/i18n/strings.json';
  const TRANSLATABLE_ATTRIBUTES = ['title', 'aria-label'];

  let catalog = { defaultLanguage: 'en', languages: ['en'], strings: {} };
  let lang = 'en';

  /**
   * Restituisce la prima lingua del browser presente nel catalogo, provando
   * prima il tag completo (es. "pt-br") e poi la lingua base (es. "pt").
   */
  function detectLanguage() {
    const supported = catalog.languages.map((language) => language.toLowerCase());
    const preferred = navigator.languages?.length ? navigator.languages : [navigator.language];

    for (const tag of preferred) {
      if (!tag) {
        continue;
      }
      const full = tag.toLowerCase();
      const base = full.split('-')[0];
      const match = supported.indexOf(full) !== -1 ? supported.indexOf(full) : supported.indexOf(base);
      if (match !== -1) {
        return catalog.languages[match];
      }
    }

    return catalog.defaultLanguage;
  }

  /**
   * Traduce una chiave nella lingua corrente, sostituendo i segnaposto {nome}.
   * Se manca la traduzione usa la lingua predefinita; se manca la chiave la
   * restituisce così com'è, per rendere evidente il testo mancante.
   */
  function t(key, params = {}) {
    const entry = catalog.strings[key];
    const text = entry?.[lang] ?? entry?.[catalog.defaultLanguage] ?? key;
    return text.replace(/\{(\w+)\}/g, (placeholder, name) =>
      Object.hasOwn(params, name) ? String(params[name]) : placeholder);
  }

  /** Applica le traduzioni agli elementi marcati all'interno di root. */
  function apply(root = document) {
    root.querySelectorAll('[data-i18n]').forEach((element) => {
      element.textContent = t(element.dataset.i18n);
    });

    for (const attribute of TRANSLATABLE_ATTRIBUTES) {
      root.querySelectorAll(`[data-i18n-${attribute}]`).forEach((element) => {
        element.setAttribute(attribute, t(element.getAttribute(`data-i18n-${attribute}`)));
      });
    }
  }

  /** Formatta un numero con i separatori decimali della lingua corrente. */
  function formatNumber(value, fractionDigits) {
    return new Intl.NumberFormat(lang, {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits
    }).format(value);
  }

  const ready = fetch(STRINGS_URL, { cache: 'no-cache' })
    .then((response) => {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return response.json();
    })
    .then((data) => {
      catalog = data;
    })
    .catch((error) => {
      console.error('Unable to load translations', error);
    })
    .then(() => {
      lang = detectLanguage();
      document.documentElement.lang = lang;
      apply();
      // Rende visibile la pagina, nascosta via CSS per evitare il cambio di lingua a vista.
      document.documentElement.classList.remove('i18n-loading');
    });

  window.I18n = {
    ready,
    t,
    apply,
    formatNumber,
    get lang() {
      return lang;
    }
  };
})();
