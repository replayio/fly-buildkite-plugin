import { delay } from "https://deno.land/std@0.144.0/async/delay.ts";
import { writeAll } from "https://deno.land/std@0.145.0/streams/conversion.ts";

import { applicationNameFromPipelineName } from "./fly/app.ts";
import { Config, configFromEnv } from "./config.ts";
import { FlyProxy } from "./fly/proxy.ts";

async function createSecrets(
  appName: string,
  accessToken: string,
  secrets: Array<string>
) {
  const query = `mutation MyMutation($appId: ID!, $secrets: [SecretInput!]!) {
  setSecrets(
    input: {
      appId: $appId
      secrets: $secrets
      replaceAll: false
    }
  ) {
    app {
      name
      secrets {
        name,
        createdAt
      }
    }
  }
}`;

  const variables = {
    appId: appName,
    secrets: secrets.map((key) => {
      const value = Deno.env.get(key);
      if (!value) {
        throw new Error(`Secret ${key} is not set in environment`);
      }

      return {
        key,
        value,
      };
    }),
  };

  const result = await fetch("https://api.fly.io/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!result.ok) {
    throw new Error(`Failed to create secrets: ${await result.text()}`);
  }
}

type AppList = Array<{
  Name: string;
}>;

async function createApplicationIfNotExists(
  flyApiToken: string,
  organization: string,
  applicationName: string
) {
  const cmd = ["fly", "--json", "--access-token", flyApiToken, "apps", "list"];
  console.error(`Checking list of apps`, cmd.join(" "));
  const p = Deno.run({
    cmd,
    stdout: "piped",
    stderr: "inherit",
  });

  console.error("Getting status and output");
  const [status, listOutput] = await Promise.all([p.status(), p.output()]);
  p.close();
  if (!status.success) {
    console.error("Failed to get list of fly apps");
    throw new Error("Failed to get list of fly apps");
  }
  console.error("Got status and output");
  const listOutputString = new TextDecoder().decode(listOutput);
  const listOutputJson: AppList = JSON.parse(listOutputString);
  const applicationNames = listOutputJson.map((app) => app.Name);
  // If the application doesn't exist, create it
  if (!applicationNames.includes(applicationName)) {
    console.error(`Creating application ${applicationName}`);
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

// deno-lint-ignore no-explicit-any
type Plugin = Record<string, any>;

export type CommandStep = {
  command: string;
  plugins?: Plugin[];
};

async function createMachine(
  flyProxy: FlyProxy,
  applicationName: string,
  command: CommandStep,
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

  return { ...command, agents: [`${agentName}=true`] };
}

async function main() {
  const config = configFromEnv();

  const pipelineName = Deno.env.get("BUILDKITE_PIPELINE_SLUG");
  if (!pipelineName) {
    throw new Error("BUILDKITE_PIPELINE_SLUG is not set");
  }
  const applicationName = applicationNameFromPipelineName(pipelineName);

  // create application if it doesn't exist
  console.error("Checking if application exists");
  await createApplicationIfNotExists(
    config.api_token,
    config.organization,
    applicationName
  );

  console.error("Creating secrets");
  await createSecrets(applicationName, config.api_token, config.secrets);

  // start fly proxy
  console.error("Starting fly proxy");
  const flyProxy = new FlyProxy(
    config.api_token,
    config.organization,
    applicationName
  );

  await delay(1000);
  await flyProxy.waitForFlyProxyToStart();
  console.error("Fly proxy started");

  try {
    let pipeline;
    if (config.matrix) {
      const commandPromises = config.matrix.map((m) => {
        const command = config.command.replace("{{matrix}}", m);
        const commandConfig = {
          command,
        };
        return createMachine(flyProxy, applicationName, commandConfig, config);
      });
      const commands = await Promise.all(commandPromises);
      pipeline = { steps: commands };
    } else {
      const command = config.command;
      const commandConfig = {
        command,
      };
      const step = await createMachine(
        flyProxy,
        applicationName,
        commandConfig,
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
  } catch (e) {
    console.error(e);
    Deno.exit(1);
  } finally {
    flyProxy.stop();
  }
}

await main().catch((e) => {
  console.error(`Error in main`, e);
  throw e;
});
