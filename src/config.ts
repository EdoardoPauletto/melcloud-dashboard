import "dotenv/config";

// Centralized runtime configuration loaded from environment variables.

type AppConfig = {
  melcloudCredentials: MelcloudCredentials | null;
  port: number;
  trustProxy: boolean;
};

export type MelcloudCredentials = {
  email: string;
  password: string;
};

function parseMelcloudCredentials(): MelcloudCredentials | null {
  const email = process.env.MELCLOUD_EMAIL?.trim();
  const password = process.env.MELCLOUD_PASSWORD;

  // Entrambi vuoti attivano il login per singola sessione web.
  // Le credenziali verranno quindi richieste dalla pagina di accesso.
  if (!email && !password) {
    return null;
  }

  // Una configurazione parziale sarebbe ambigua: meglio bloccare subito
  // l'avvio invece di tentare richieste MELCloud destinate a fallire.
  if (!email || !password) {
    throw new Error("MELCLOUD_EMAIL and MELCLOUD_PASSWORD must both be set or both be omitted");
  }

  // Entrambi compilati mantengono la modalita storica: un solo account
  // MELCloud condiviso da tutti i browser che raggiungono la dashboard.
  return { email, password };
}

function parsePort(value: string | undefined): number {
  if (!value) {
    // Default port for local development.
    return 3000;
  }

  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be a valid integer between 1 and 65535");
  }

  return port;
}

function parseBoolean(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

export const config: AppConfig = {
  melcloudCredentials: parseMelcloudCredentials(),
  // Optional override from environment.
  port: parsePort(process.env.PORT),
  trustProxy: parseBoolean(process.env.TRUST_PROXY)
};
