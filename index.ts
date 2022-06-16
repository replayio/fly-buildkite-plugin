import * as log from "https://deno.land/std@0.144.0/log/mod.ts";

function ensureEnv() {
  if (Deno.env.get("FLY_API_TOKEN")) {
    log.critical("FLY_API_TOKEN is not set");
    Deno.exit(1);
  }
}

function setupFlyMachine() {
  // create an application if it doesn't exist
  // create a machine in that application
  // wait for machine to start
  // start buildkite on the machine with the appropriate agent tag set
}

function main() {
  // ensure that FLY_API_TOKEN env variable is set
  ensureEnv();

  // create config from BUILDKITE_PLUGIN_CONFIGURATION

  // run `flyctl machines api-proxy` in background

  setupFlyMachine();

  // build pipeline
}

main();
