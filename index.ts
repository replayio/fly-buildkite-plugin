import { delay } from "https://deno.land/std@0.144.0/async/delay.ts";
import { writeAll } from "https://deno.land/std@0.145.0/streams/conversion.ts";

import { applicationNameFromPipelineName } from "./fly/app.ts";
import { Config, configFromEnv } from "./config.ts";
import { FlyProxy } from "./fly/proxy.ts";

function createSecrets(
  appName: string,
  accessToken: string,
  secrets: Array<string>
) {
  const stuff = secrets.map(async (key) => {
    const value = Deno.env.get(key);
    if (!value) {
      throw new Error(`Secret ${key} is not set in environment`);
    }
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

async function createMachine(
  flyProxy: FlyProxy,
  applicationName: string,
  command: string,
  config: Config
) {
  const machineNamePrefix = applicationName + "-";
  const agentName = await flyProxy.startMachine(
    machineNamePrefix,
    config.image,
    config.cpus,
    config.memory,
    config.environment
  );

  return { command: command, agents: [`${agentName}=true`] };
}

async function main() {
  const config = configFromEnv();

  const pipelineName = Deno.env.get("BUILDKITE_PIPELINE_SLUG");
  if (!pipelineName) {
    throw new Error("BUILDKITE_PIPELINE_SLUG is not set");
  }
  const applicationName = applicationNameFromPipelineName(pipelineName);

  // create application if it doesn't exist
  await createApplicationIfNotExists(
    config.api_token,
    config.organization,
    applicationName
  );

  await createSecrets(applicationName, config.api_token, config.secrets);

  // start fly proxy
  const flyProxy = new FlyProxy(
    config.api_token,
    config.organization,
    applicationName
  );

  await delay(1000);

  let pipeline;
  if (config.matrix) {
    const commandPromises = config.matrix.map((m) => {
      const command = config.command.replace("{{matrix}}", m);
      return createMachine(flyProxy, applicationName, command, config);
    });
    const commands = await Promise.all(commandPromises);
    pipeline = { steps: commands };
  } else {
    const command = config.command;
    const step = await createMachine(
      flyProxy,
      applicationName,
      command,
      config
    );
    pipeline = { steps: [step] };
  }

  const pipelineString = JSON.stringify(pipeline);
  const pipelineBytes = new TextEncoder().encode(pipelineString);
  await writeAll(Deno.stderr, pipelineBytes);
  await writeAll(Deno.stdout, pipelineBytes);

  // pass pipelineString to build-agent pipeline upload stdin
  const p = Deno.run({
    cmd: ["buildkite-agent", "pipeline", "upload"],
    stdin: "piped",
  });
  await p.stdin.write(pipelineBytes);
  p.stdin.close();
  const pipelineUploadResult = await p.status();
  if (!pipelineUploadResult.success) {
    throw new Error(
      `Failed to upload pipeline: failed with ${pipelineUploadResult.code}`
    );
  }
}

await main();
