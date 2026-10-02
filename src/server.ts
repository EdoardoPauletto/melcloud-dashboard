import { randomBytes } from "crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import session from "express-session";
import path from "path";
import { fileURLToPath } from "url";

import { config } from "./config.js";
import { translate } from "./i18n.js";
import { createMelcloudClient, type MelcloudClient } from "./melcloudClient.js";

declare module "express-session" {
  interface SessionData {
    // Flag privo di dati sensibili usato per rendere persistente la sessione.
    // Email, password e client MELCloud non vengono mai salvati nel cookie.
    melcloudAuthenticated: boolean;
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
if (config.trustProxy) {
  // Synology terminates HTTPS and forwards the original protocol in
  // X-Forwarded-Proto. One trusted hop lets Express secure the cookie.
  app.set("trust proxy", 1);
}
// Parse incoming JSON bodies for POST endpoints.
app.use(express.json());

const sessionMaxAgeMs = 8 * 60 * 60 * 1000;
const sessionSecret = process.env.SESSION_SECRET ?? randomBytes(32).toString("hex");

// express-session invia al browser soltanto un cookie con un ID firmato.
// httpOnly impedisce a JavaScript nel browser di leggerlo; sameSite riduce
// l'invio del cookie da pagine esterne. Lo stato utile resta lato server.
app.use(session({
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: config.trustProxy ? "auto" : false,
    maxAge: sessionMaxAgeMs
  }
}));

type SessionClient = {
  client: MelcloudClient;
  expiresAt: number;
};

// Associa ogni ID di sessione al relativo client MELCloud autenticato.
// Due browser ricevono ID diversi e quindi usano credenziali/client diversi.
// La mappa vive solo in RAM: un riavvio del processo elimina tutte le sessioni.
const sessionClients = new Map<string, SessionClient>();

// La presenza delle credenziali in .env seleziona la modalita condivisa.
// Se sono assenti, questo valore resta null e diventano obbligatori login e cookie.
const sharedMelcloudClient = config.melcloudCredentials
  ? await createMelcloudClient(config.melcloudCredentials)
  : null;

if (sharedMelcloudClient) {
  console.log(`MELCloud provider selected: ${sharedMelcloudClient.provider} (shared credentials)`);
} else {
  console.log("MELCloud session login enabled");
}

const cleanupTimer = setInterval(() => {
  // Rimuove periodicamente i client scaduti anche se il browser non effettua logout.
  for (const [sessionId, entry] of sessionClients) {
    if (entry.expiresAt <= Date.now()) {
      sessionClients.delete(sessionId);
    }
  }
}, 60 * 60 * 1000);
cleanupTimer.unref();

type JsonRecord = Record<string, unknown>;
type PublicDevice = {
  provider?: string;
  id?: number;
  name?: string;
  type?: number;
  raw?: JsonRecord;
};

type DeviceSummary = {
  id: number | null;
  name: string | null;
  Power: boolean | null;
  SetTemperature: number | null;
  FanSpeed: number | null;
  SetFanSpeed: number | null;
  RoomTemperature: number | null;
  CurrentEnergyConsumed: number | null;
  Offline: boolean | null;
};

function pickDeviceId(device: PublicDevice, raw: JsonRecord): number | null {
  if (typeof device.id === "number" && Number.isInteger(device.id) && device.id > 0) {
    return device.id;
  }

  const fromRaw = raw.DeviceID;
  if (typeof fromRaw === "number" && Number.isInteger(fromRaw) && fromRaw > 0) {
    return fromRaw;
  }

  return null;
}

function toDeviceId(raw: string): number | null {
  // MELCloud device ids are expected to be positive integers.
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    return null;
  }
  return id;
}

function getParamAsString(value: string | string[] | undefined): string {
  // Express params can be arrays depending on router typing; normalize here.
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }
  return value ?? "";
}

function toJsonRecord(value: unknown): JsonRecord {
  if (value !== null && typeof value === "object") {
    return value as JsonRecord;
  }
  return {};
}

function toPublicDevice(value: unknown): PublicDevice {
  return value as PublicDevice;
}

function pickBoolean(raw: JsonRecord, first: string, second?: string): boolean | null {
  const direct = raw[first];
  if (typeof direct === "boolean") {
    return direct;
  }

  if (second) {
    const alt = raw[second];
    if (typeof alt === "boolean") {
      return alt;
    }
  }

  return null;
}

function pickNumber(raw: JsonRecord, first: string, second?: string): number | null {
  const direct = raw[first];
  if (typeof direct === "number" && Number.isFinite(direct)) {
    return direct;
  }

  if (second) {
    const alt = raw[second];
    if (typeof alt === "number" && Number.isFinite(alt)) {
      return alt;
    }
  }

  return null;
}

function summaryDevice(device: PublicDevice): DeviceSummary {
  // Prefer `raw` (Olivier client shape), fallback to top-level fields.
  const rawCandidate = device.raw ?? (device as unknown as JsonRecord);
  const raw = toJsonRecord(rawCandidate);
  return {
    id: pickDeviceId(device, raw),
    name: device.name ?? null,
    Power: pickBoolean(raw, "Power", "power"),
    SetTemperature: pickNumber(raw, "SetTemperature", "setTemperature"),
    FanSpeed: pickNumber(raw, "FanSpeed", "fanSpeed"),
    SetFanSpeed: pickNumber(raw, "SetFanSpeed", "setFanSpeed"),
    RoomTemperature: pickNumber(raw, "RoomTemperature", "roomTemperature"),
    CurrentEnergyConsumed: pickNumber(raw, "CurrentEnergyConsumed", "currentEnergyConsumed"),
    Offline: pickBoolean(raw, "Offline", "offline")
  };
}

function getSessionClient(req: Request): MelcloudClient | null {
  // In modalita .env tutte le richieste condividono lo stesso client e non
  // dipendono da una sessione web.
  if (sharedMelcloudClient) {
    return sharedMelcloudClient;
  }

  // In modalita login, express-session ricava sessionID dal cookie della
  // richiesta. Quell'ID seleziona esclusivamente il client di quel browser.
  const entry = sessionClients.get(req.sessionID);
  if (!entry || entry.expiresAt <= Date.now()) {
    sessionClients.delete(req.sessionID);
    return null;
  }

  return entry.client;
}

function requireMelcloudClient(req: Request, res: Response, next: NextFunction): void {
  const client = getSessionClient(req);
  if (!client) {
    // Interrompe qui la pipeline: la route dispositivo non verra eseguita.
    res.status(401).json({ error: translate(req, "api.authRequired") });
    return;
  }

  // Passa il client gia risolto alla route senza cercarlo una seconda volta.
  // res.locals esiste soltanto per la durata della richiesta corrente.
  res.locals.melcloudClient = client;
  next();
}

function clientFromResponse(res: Response): MelcloudClient {
  return res.locals.melcloudClient as MelcloudClient;
}

// Lightweight liveness check for container/process monitoring.
app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok" });
});

app.get("/", (req: Request, res: Response) => {
  // La stessa URL mostra il login oppure la dashboard in base alla possibilita
  // di risolvere un client MELCloud per la richiesta corrente.
  const page = getSessionClient(req) ? "index.html" : "login.html";
  res.set("Cache-Control", "no-store");
  res.sendFile(path.join(__dirname, "../public", page));
});

app.get("/api/auth/status", (req: Request, res: Response) => {
  res.set("Cache-Control", "no-store");
  res.json({
    authenticated: getSessionClient(req) !== null,
    sessionLogin: sharedMelcloudClient === null
  });
});

app.post("/api/auth/login", async (req: Request, res: Response) => {
  if (sharedMelcloudClient) {
    res.status(409).json({ error: translate(req, "api.sharedCredentials") });
    return;
  }

  const email = typeof req.body?.email === "string" ? req.body.email.trim() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (!email || !password) {
    res.status(400).json({ error: translate(req, "api.credentialsRequired") });
    return;
  }

  try {
    // La factory autentica davvero presso MELCloud. Se le credenziali vengono
    // rifiutate, genera un errore e non viene creata alcuna sessione locale.
    const client = await createMelcloudClient({ email, password });
    await client.getDevices();

    // Rigenerare l'ID dopo il login impedisce attacchi di session fixation.
    // Il vecchio eventuale client viene rimosso e il nuovo viene associato
    // soltanto all'ID appena consegnato a questo browser.
    const previousSessionId = req.sessionID;
    await new Promise<void>((resolve, reject) => {
      req.session.regenerate((error) => error ? reject(error) : resolve());
    });
    sessionClients.delete(previousSessionId);
    req.session.melcloudAuthenticated = true;
    sessionClients.set(req.sessionID, { client, expiresAt: Date.now() + sessionMaxAgeMs });

    // Persist the regenerated ID before the browser navigates to `/`.
    await new Promise<void>((resolve, reject) => {
      req.session.save((error) => error ? reject(error) : resolve());
    });
    res.json({ authenticated: true });
  } catch (error) {
    res.status(401).json({ error: translate(req, "api.loginFailed") });
  }
});

app.post("/api/auth/logout", (req: Request, res: Response) => {
  // Elimina sia il client tenuto in RAM sia la sessione/cookie del browser.
  sessionClients.delete(req.sessionID);
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    res.status(204).end();
  });
});

// Serve dashboard and login assets without automatically serving index.html.
app.use(express.static(path.join(__dirname, "../public"), { index: false }));

// Questo middleware e registrato prima di tutte le route dispositivo.
// Ogni richiesta /api/... successiva deve quindi avere un client condiviso
// oppure una sessione autenticata; in caso contrario termina con HTTP 401.
// Le route /api/auth definite sopra restano intenzionalmente pubbliche.
app.use("/api", requireMelcloudClient);

// Returns all devices visible to the authenticated MELCloud account.
app.get("/api/devices", async (_req: Request, res: Response) => {
  try {
    const melcloudClient = clientFromResponse(res);
    const devices = await melcloudClient.getDevices();
    // Full provider payload for detailed diagnostics/use-cases.
    res.json(devices);
  } catch (error) {
    res.status(502).json({ error: (error as Error).message });
  }
});

// Compact summary with the most relevant values for quick monitoring.
app.get("/api/devices/summary", async (_req: Request, res: Response) => {
  try {
    const melcloudClient = clientFromResponse(res);
    const devices = await melcloudClient.getDevices();
    const summary = devices.map((device) => summaryDevice(toPublicDevice(device)));
    res.json(summary);
  } catch (error) {
    res.status(502).json({ error: (error as Error).message });
  }
});

app.get("/api/devices/:id", async (req: Request, res: Response) => {
  try {
    const melcloudClient = clientFromResponse(res);
    // Per-device lookup, useful while debugging a specific unit.
    const deviceId = toDeviceId(getParamAsString(req.params.id));
    if (deviceId === null) {
      res.status(400).json({ error: translate(req, "api.invalidDeviceId") });
      return;
    }
    const device = await melcloudClient.getDevice(deviceId);
    res.json(device);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

app.post("/api/devices/:id/power", async (req: Request, res: Response) => {
  try {
    const melcloudClient = clientFromResponse(res);
    const deviceId = toDeviceId(getParamAsString(req.params.id));
    if (deviceId === null) {
      res.status(400).json({ error: translate(req, "api.invalidDeviceId") });
      return;
    }
    const on = req.body?.on;

    if (typeof on !== "boolean") {
      res.status(400).json({ error: translate(req, "api.powerBodyInvalid") });
      return;
    }

    // Convenience endpoint for simple on/off without full set payload.
    const updated = on
      ? await melcloudClient.turnOn(deviceId)
      : await melcloudClient.turnOff(deviceId);

    res.json(updated);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

app.post("/api/devices/:id/set", async (req: Request, res: Response) => {
  try {
    const melcloudClient = clientFromResponse(res);
    const deviceId = toDeviceId(getParamAsString(req.params.id));
    if (deviceId === null) {
      res.status(400).json({ error: translate(req, "api.invalidDeviceId") });
      return;
    }
    // Forward raw control parameters to melcloud-api setDevice.
    const params = req.body as JsonRecord;

    if (!params || Object.keys(params).length === 0) {
      res.status(400).json({ error: translate(req, "api.emptyBody") });
      return;
    }

    const updated = await melcloudClient.setDevice(deviceId, params);
    res.json(updated);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

app.listen(config.port, () => {
  console.log(`MELCloud API server running on port ${config.port}`);
});
