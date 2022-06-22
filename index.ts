import { getLogger } from "https://deno.land/std@0.144.0/log/mod.ts";

import { configFromEnv } from "./config.ts";
import { FlyProxy } from "./fly/proxy.ts";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function createSecrets(
  appName: string,
  accessToken: string,
  secrets: Record<string, string>
) {
  const stuff = Object.keys(secrets).map(async (key) => {
    const value = secrets[key];
    try {
      const p = Deno.run({
        cmd: [
          "fly",
          "--json",
          "--access-token",
          accessToken,
          "secrets",
          "set",
          "--app",
          appName,
          `${key}=${value}`,
        ],
      });
      await p.status();
    } catch (e) {
      console.error(e);
    }
  });

  return Promise.all(stuff);
}

async function setupFlyMachine(
  flyApiToken: string,
  organization: string,
  applicationName: string,
  image: string
) {
  const logger = getLogger();
  // start fly proxy
  const flyProxy = new FlyProxy(
    logger,
    flyApiToken,
    organization,
    applicationName
  );

  // create a machine in that application
  await flyProxy.startMachine("fly-agent-test", image, 1, 1024);

  // sleep for 60 seconds
  await delay(60 * 1000);
}

async function main() {
  // create config from BUILDKITE_PLUGIN_CONFIGURATION
  const config = configFromEnv();

  const imageTag = "registry.fly.io/flybuildkite-test:deployment-1655936542";

  await createSecrets("buildkite-agents", config.api_token, config.secrets);

  await setupFlyMachine(
    config.api_token,
    config.organization,
    config.application,
    imageTag
  );

  // build pipeline
}

await main();
