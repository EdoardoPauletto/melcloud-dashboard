import "dotenv/config";

// Centralized runtime configuration loaded from environment variables.

type AppConfig = {
  melcloudEmail: string;
  melcloudPassword: string;
  port: number;
};

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    // Fail fast at startup so misconfiguration is visible immediately.
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
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

export const config: AppConfig = {
  melcloudEmail: required("MELCLOUD_EMAIL"),
  melcloudPassword: required("MELCLOUD_PASSWORD"),
  // Optional override from environment.
  port: parsePort(process.env.PORT)
};
