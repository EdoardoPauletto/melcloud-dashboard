import { readFileSync } from "fs";
import type { Request } from "express";
import path from "path";
import { fileURLToPath } from "url";

// Il server legge lo stesso catalogo usato dal browser, così tutti i testi
// visibili all'utente restano centralizzati in public/i18n/strings.json.

type StringsCatalog = {
  defaultLanguage: string;
  languages: string[];
  strings: Record<string, Record<string, string>>;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Il percorso vale sia per src/ (tsx) sia per dist/ (build), entrambi accanto a public/.
const catalogPath = path.join(__dirname, "../public/i18n/strings.json");
const catalog = JSON.parse(readFileSync(catalogPath, "utf8")) as StringsCatalog;

// La lingua predefinita va per prima: senza Accept-Language, Express sceglie la prima offerta.
const offeredLanguages = [
  catalog.defaultLanguage,
  ...catalog.languages.filter((language) => language !== catalog.defaultLanguage)
];

/**
 * Traduce una chiave nella lingua richiesta dal client tramite Accept-Language.
 */
export function translate(req: Request, key: string): string {
  const language = req.acceptsLanguages(...offeredLanguages) || catalog.defaultLanguage;
  const entry = catalog.strings[key];
  return entry?.[language] ?? entry?.[catalog.defaultLanguage] ?? key;
}
