export type Config = {
  api_token: string;
  application: string;
  organization: string;
  image: string;
  command: string;
  secrets: Record<string, string>;
  environment: Record<string, string>;
  cpus: number;
  memory: number;
  storage: number | null;
};

export function configFromEnv(): Config {
  const configString = Deno.env.get("BUILDKITE_PLUGIN_CONFIGURATION");
  if (!configString) {
    throw new Error("BUILDKITE_PLUGIN_CONFIGURATION is not set");
  }
  const pluginConfig = JSON.parse(configString);

  const flyApiToken = Deno.env.get("FLY_API_TOKEN");
  if (!flyApiToken) {
    throw new Error("FLY_API_TOKEN is not set");
  }

  const config: Config = {
    api_token: flyApiToken,
    application: pluginConfig.application,
    organization: pluginConfig.organization,
    image: pluginConfig.image,
    command: pluginConfig.command,
    secrets: pluginConfig.secrets || {},
    environment: pluginConfig.environment || {},
    cpus: pluginConfig.cpus || 1,
    memory: pluginConfig.memory || 1024,
    storage: pluginConfig.storage || null,
  };

  return config;
}
