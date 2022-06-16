export type Config = {
  api_token: string;
  dockerfile: string;
  command: string;
  secrets: Record<string, string>;
  environment: Record<string, string>;
  cpus: number;
  memory: number;
  storage: number | null;
};

export function ConfigFromEnv() {
  // parse buildkite config
}
