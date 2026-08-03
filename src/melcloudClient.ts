import {
	ClassicAPI,
	ClassicFacadeManager,
	ClassicFanSpeed,
	ClassicHorizontal,
	ClassicOperationMode,
	ClassicVertical
} from "@olivierzal/melcloud-api";
import MELCloudAPI from "melcloud-api";

import { config } from "./config.js";

export type JsonRecord = Record<string, unknown>;
export type ProviderName = "pigwin" | "olivier";

export type MelcloudClient = {
	provider: ProviderName;
	getDevices: () => Promise<unknown[]>;
	getDevice: (deviceId: number) => Promise<unknown>;
	turnOn: (deviceId: number) => Promise<unknown>;
	turnOff: (deviceId: number) => Promise<unknown>;
	setDevice: (deviceId: number, params: JsonRecord) => Promise<unknown>;
};

class PigwinClient implements MelcloudClient {
	public readonly provider = "pigwin" as const;
	private readonly client = new MELCloudAPI(config.melcloudEmail, config.melcloudPassword);

	public async getDevices(): Promise<unknown[]> {
		return this.client.getDevices();
	}

	public async getDevice(deviceId: number): Promise<unknown> {
		return this.client.getDevice(deviceId);
	}

	public async turnOn(deviceId: number): Promise<unknown> {
		return this.client.turnOn(deviceId);
	}

	public async turnOff(deviceId: number): Promise<unknown> {
		return this.client.turnOff(deviceId);
	}

	public async setDevice(deviceId: number, params: JsonRecord): Promise<unknown> {
		return this.client.setDevice(deviceId, params);
	}
}

class OlivierClient implements MelcloudClient {
	public readonly provider = "olivier" as const;

	private constructor(
		private readonly api: ClassicAPI,
		private readonly facadeManager: ClassicFacadeManager
	) {}

	public static async create(): Promise<OlivierClient> {
		const api = await ClassicAPI.create({
			username: config.melcloudEmail,
			password: config.melcloudPassword
		});

		// Ensure the Classic registry is synced before the first request.
		await api.fetch();
		const facadeManager = new ClassicFacadeManager(api, api.registry);
		return new OlivierClient(api, facadeManager);
	}

	public async getDevices(): Promise<unknown[]> {
		await this.api.fetch();
		return this.api.registry.getDevices().map((device) => this.toPublicDevice(device));
	}

	public async getDevice(deviceId: number): Promise<unknown> {
		await this.api.fetch();
		const device = this.getDeviceModel(deviceId);
		return this.toPublicDevice(device);
	}

	public async turnOn(deviceId: number): Promise<unknown> {
		const facade = this.getFacade(deviceId);
		await facade.updatePower(true);
		return this.getDevice(deviceId);
	}

	public async turnOff(deviceId: number): Promise<unknown> {
		const facade = this.getFacade(deviceId);
		await facade.updatePower(false);
		return this.getDevice(deviceId);
	}

	public async setDevice(deviceId: number, params: JsonRecord): Promise<unknown> {
		const facade = this.getFacade(deviceId);
		const normalized = normalizeClassicSetParams(params);

		if (normalized.Power !== undefined) {
			await facade.updatePower(Boolean(normalized.Power));
			delete normalized.Power;
		}

		if (Object.keys(normalized).length > 0) {
			await facade.updateValues(normalized);
		}

		return this.getDevice(deviceId);
	}

	private getDeviceModel(deviceId: number): { id: number; name: string; type: number; data: unknown } {
		const device = this.api.registry.devices.getById(deviceId);
		if (!device) {
			throw new Error(`Device ${deviceId} not found in Classic registry`);
		}

		return {
			id: device.id,
			name: device.name,
			type: device.type,
			data: device.data
		};
	}

	private getFacade(deviceId: number): {
		updatePower: (isOn?: boolean) => Promise<boolean>;
		updateValues: (data: JsonRecord) => Promise<unknown>;
	} {
		const model = this.api.registry.devices.getById(deviceId);
		if (!model) {
			throw new Error(`Device ${deviceId} not found in Classic registry`);
		}

		const facade = this.facadeManager.get(model);
		if (!facade) {
			throw new Error(`Unable to build facade for device ${deviceId}`);
		}

		return facade as {
			updatePower: (isOn?: boolean) => Promise<boolean>;
			updateValues: (data: JsonRecord) => Promise<unknown>;
		};
	}

	private toPublicDevice(device: { id: number; name: string; type: number; data: unknown }): unknown {
		return {
			provider: this.provider,
			id: device.id,
			name: device.name,
			type: device.type,
			raw: device.data
		};
	}
}

function normalizeProvider(value: string | undefined): ProviderName | undefined {
	if (!value) {
		return undefined;
	}

	const normalized = value.trim().toLowerCase();
	if (normalized === "1" || normalized === "pigwin" || normalized === "legacy") {
		return "pigwin";
	}

	if (normalized === "2" || normalized === "olivier" || normalized === "new") {
		return "olivier";
	}

	return undefined;
}

async function resolveProvider(): Promise<ProviderName> {
	const fromEnv = normalizeProvider(process.env.MELCLOUD_PROVIDER);
	if (fromEnv) {
		return fromEnv;
	}

	// Default provider when env is not specified.
	return "olivier";
}

function toJsonRecord(value: unknown): JsonRecord {
	if (value !== null && typeof value === "object") {
		return value as JsonRecord;
	}
	return {};
}

function firstString(...values: unknown[]): string | undefined {
	for (const value of values) {
		if (typeof value === "string" && value.length > 0) {
			return value;
		}
	}
	return undefined;
}

function firstNumber(...values: unknown[]): number | undefined {
	for (const value of values) {
		if (typeof value === "number" && Number.isFinite(value)) {
			return value;
		}
	}
	return undefined;
}

function asNumber(value: unknown): number | undefined {
	if (typeof value !== "number" || Number.isNaN(value)) {
		return undefined;
	}
	return value;
}

function asBoolean(value: unknown): boolean | undefined {
	if (typeof value !== "boolean") {
		return undefined;
	}
	return value;
}

function toClassicOperationMode(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isInteger(value)) {
		return value;
	}

	if (typeof value !== "string") {
		return undefined;
	}

	const mode = value.trim().toLowerCase();
	switch (mode) {
		case "heat":
		case "hot":
		case "h":
			return ClassicOperationMode.heat;
		case "cool":
		case "cold":
		case "c":
			return ClassicOperationMode.cool;
		case "dry":
		case "d":
			return ClassicOperationMode.dry;
		case "fan":
		case "air":
		case "f":
			return ClassicOperationMode.fan;
		case "auto":
		case "a":
			return ClassicOperationMode.auto;
		default:
			return undefined;
	}
}

function toClassicFanSpeed(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isInteger(value)) {
		return value;
	}

	if (typeof value !== "string") {
		return undefined;
	}

	const fan = value.trim().toLowerCase();
	switch (fan) {
		case "auto":
			return ClassicFanSpeed.auto;
		case "1":
		case "very_slow":
		case "very-slow":
			return ClassicFanSpeed.very_slow;
		case "2":
		case "slow":
			return ClassicFanSpeed.slow;
		case "3":
		case "moderate":
		case "medium":
			return ClassicFanSpeed.moderate;
		case "4":
		case "fast":
			return ClassicFanSpeed.fast;
		case "5":
		case "very_fast":
		case "very-fast":
			return ClassicFanSpeed.very_fast;
		default:
			return undefined;
	}
}

function toClassicHorizontal(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isInteger(value)) {
		return value;
	}

	if (typeof value !== "string") {
		return undefined;
	}

	const direction = value.trim().toLowerCase();
	if (direction === "auto") {
		return ClassicHorizontal.auto;
	}

	if (direction === "swing") {
		return ClassicHorizontal.swing;
	}

	return undefined;
}

function toClassicVertical(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isInteger(value)) {
		return value;
	}

	if (typeof value !== "string") {
		return undefined;
	}

	const direction = value.trim().toLowerCase();
	if (direction === "auto") {
		return ClassicVertical.auto;
	}

	if (direction === "swing") {
		return ClassicVertical.swing;
	}

	return undefined;
}

function normalizeClassicSetParams(params: JsonRecord): JsonRecord {
	const normalized: JsonRecord = {};

	const temperature = asNumber(params.temperature) ?? asNumber(params.SetTemperature);
	if (temperature !== undefined) {
		normalized.SetTemperature = temperature;
	}

	const power = asBoolean(params.power) ?? asBoolean(params.Power);
	if (power !== undefined) {
		normalized.Power = power;
	}

	const mode = toClassicOperationMode(params.mode) ?? toClassicOperationMode(params.OperationMode);
	if (mode !== undefined) {
		normalized.OperationMode = mode;
	}

	const fan = toClassicFanSpeed(params.fanSpeed) ?? toClassicFanSpeed(params.SetFanSpeed);
	if (fan !== undefined) {
		normalized.SetFanSpeed = fan;
	}

	const horizontal =
		toClassicHorizontal(params.vaneHorizontal) ?? toClassicHorizontal(params.VaneHorizontal);
	if (horizontal !== undefined) {
		normalized.VaneHorizontal = horizontal;
	}

	const vertical = toClassicVertical(params.vaneVertical) ?? toClassicVertical(params.VaneVertical);
	if (vertical !== undefined) {
		normalized.VaneVertical = vertical;
	}

	// Pass through common ATW keys when already provided in the expected Classic shape.
	const passthroughKeys = [
		"ForcedHotWaterMode",
		"SetTankWaterTemperature",
		"SetTemperatureZone1",
		"SetTemperatureZone2",
		"SetHeatFlowTemperatureZone1",
		"SetHeatFlowTemperatureZone2",
		"SetCoolFlowTemperatureZone1",
		"SetCoolFlowTemperatureZone2",
		"OperationModeZone1",
		"OperationModeZone2"
	];

	for (const key of passthroughKeys) {
		const value = params[key];
		if (value !== undefined) {
			normalized[key] = value;
		}
	}

	return normalized;
}

export async function createMelcloudClient(): Promise<MelcloudClient> {
	const provider = await resolveProvider();

	if (provider === "pigwin") {
		return new PigwinClient();
	}

	return OlivierClient.create();
}
