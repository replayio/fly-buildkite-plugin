// TODO(dmiller): add organization flag to config
// TODO(dmiller): add app name to config

import { configFromEnv } from "./config.ts";
import { FlyProxy } from "./fly/proxy.ts";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function setupFlyMachine(flyApiToken: string, organization: string) {
  // start fly proxy
  const flyProxy = new FlyProxy(flyApiToken, organization);

  // create a machine in that application
  // wait for machine to start
  // start buildkite on the machine with the appropriate agent tag set

  // sleep for 60 seconds
  await delay(60 * 1000);
}

function main() {
  // create config from BUILDKITE_PLUGIN_CONFIGURATION
  const config = configFromEnv();

  // run `flyctl machines api-proxy` in background

  setupFlyMachine(config.api_token, config.organization);

  // build pipeline
}

main();
