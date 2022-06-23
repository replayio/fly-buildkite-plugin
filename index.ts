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

  // TODO(dmiller): in the future this should use BUILDKITE_PIPELINE_NAME
  const machineNamePrefix = "fly-agent-test";
  const name = await flyProxy.startMachine(machineNamePrefix, image, 1, 1024);

  return name;
}

async function main() {
  const config = configFromEnv();

  await createSecrets("buildkite-agents", config.api_token, config.secrets);

  const agentName = await setupFlyMachine(
    config.api_token,
    config.organization,
    config.application,
    config.image
  );

  // build pipeline

  const pipeline = {
    steps: [{ command: config.command, agents: [`${agentName}=true`] }],
  };

  console.log(pipeline);
}

await main();
