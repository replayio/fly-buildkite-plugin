import { getLogger } from "https://deno.land/std@0.144.0/log/mod.ts";

import { configFromEnv } from "./config.ts";
import { FlyProxy } from "./fly/proxy.ts";

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

type AppList = Array<{
  Name: string;
}>;

async function createApplicationIfNotExists(
  flyApiToken: string,
  organization: string,
  applicationName: string
) {
  const p = Deno.run({
    cmd: ["fly", "--json", "--access-token", flyApiToken, "apps", "list"],
    stdout: "piped",
    stderr: "piped",
  });
  const status = await p.status();
  if (!status.success) {
    throw new Error("Failed to get list of fly apps");
  }
  const listOutput = await p.output();
  const listOutputString = new TextDecoder().decode(listOutput);
  const listOutputJson: AppList = JSON.parse(listOutputString);
  const applicationNames = listOutputJson.map((app) => app.Name);
  // If the application doesn't exist, create it
  if (!applicationNames.includes(applicationName)) {
    const p = Deno.run({
      cmd: [
        "fly",
        "--json",
        "--access-token",
        flyApiToken,
        "apps",
        "create",
        "--name",
        applicationName,
        "--org",
        organization,
      ],
    });

    const status = await p.status();
    if (!status.success) {
      throw new Error(`Failed to create fly app ${applicationName}`);
    }
  }
}

function applicationNameFromPipelineName(): string {
  const pipelineName = Deno.env.get("BUILDKITE_PIPELINE_NAME");
  if (!pipelineName) {
    throw new Error("BUILDKITE_PIPELINE_NAME is not set");
  }
  return `buildkite-${pipelineName}`;
}

async function main() {
  const config = configFromEnv();
  const applicationName = applicationNameFromPipelineName();

  // create application if it doesn't exist
  await createApplicationIfNotExists(
    config.api_token,
    config.organization,
    applicationName
  );

  await createSecrets(applicationName, config.api_token, config.secrets);

  const agentName = await setupFlyMachine(
    config.api_token,
    config.organization,
    applicationName,
    config.image
  );

  // build pipeline
  const pipeline = {
    steps: [{ command: config.command, agents: [`${agentName}=true`] }],
  };

  console.log(pipeline);
}

await main();
