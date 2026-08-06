import express, { type Request, type Response } from "express";
import path from "path";
import { fileURLToPath } from "url";

import { config } from "./config.js";
import { createMelcloudClient } from "./melcloudClient.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
// Parse incoming JSON bodies for POST endpoints.
app.use(express.json());
// Serve the static dashboard from the public/ folder.
app.use(express.static(path.join(__dirname, "../public")));

const melcloudClient = await createMelcloudClient();
console.log(`MELCloud provider selected: ${melcloudClient.provider}`);

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

function toDeviceId(raw: string): number {
  // MELCloud device ids are expected to be positive integers.
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("Invalid device id");
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

// Lightweight liveness check for container/process monitoring.
app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok" });
});

// Returns all devices visible to the MELCloud account in .env.
app.get("/api/devices", async (_req: Request, res: Response) => {
  try {
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
    const devices = await melcloudClient.getDevices();
    const summary = devices.map((device) => summaryDevice(toPublicDevice(device)));
    res.json(summary);
  } catch (error) {
    res.status(502).json({ error: (error as Error).message });
  }
});

app.get("/api/devices/:id", async (req: Request, res: Response) => {
  try {
    // Per-device lookup, useful while debugging a specific unit.
    const deviceId = toDeviceId(getParamAsString(req.params.id));
    const device = await melcloudClient.getDevice(deviceId);
    res.json(device);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

app.post("/api/devices/:id/power", async (req: Request, res: Response) => {
  try {
    const deviceId = toDeviceId(getParamAsString(req.params.id));
    const on = req.body?.on;

    if (typeof on !== "boolean") {
      res.status(400).json({ error: "Body must contain boolean field: on" });
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
    const deviceId = toDeviceId(getParamAsString(req.params.id));
    // Forward raw control parameters to melcloud-api setDevice.
    const params = req.body as JsonRecord;

    if (!params || Object.keys(params).length === 0) {
      res.status(400).json({ error: "Request body cannot be empty" });
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
