import { writeAll } from "https://deno.land/std@0.145.0/streams/conversion.ts";

import { applicationNameFromPipelineName } from "./fly/app.ts";
import { Config, configFromEnv } from "./config.ts";

import { Machines } from "./fly/machines.ts";
import { assert } from "https://deno.land/std@0.145.0/_util/assert.ts";
import { createSecrets } from "./createSecrets.ts";

type AppList = Array<{
  Name: string;
}>;

async function runWithRetry(
  cmd: string[],
  retryCount: number
): Promise<[Deno.ProcessStatus, Uint8Array]> {
  let attempt = 0;
  while (attempt < retryCount) {
    try {
      const p = Deno.run({
        cmd,
        stdout: "piped",
        stderr: "inherit",
      });

      const [status, output] = await Promise.all([p.status(), p.output()]);
      p.close();
      if (status.success) {
        return [status, output];
      }
    } catch (error) {
      console.error(`Failed to run command: ${cmd.join(" ")}`);
      throw error;
    }

    attempt++;
    // sleep for 1 second
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  console.error(
    `Failed to run command after ${retryCount} attempts: ${cmd.join(" ")}`
  );
  throw new Error(
    `Failed to run command after ${retryCount} attempts: ${cmd.join(" ")}`
  );
}

async function createApplicationIfNotExists(
  flyApiToken: string,
  organization: string,
  applicationName: string
) {
  const cmd = ["fly", "apps", "list", "--json", "--access-token", flyApiToken];
  console.error(`Checking list of apps`, cmd.join(" "));

  const [status, listOutput] = await runWithRetry(cmd, 3);

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
        "apps",
        "create",
        "--name",
        applicationName,
        "--org",
        organization,
        "--json",
        "--access-token",
        flyApiToken,
      ],
    });

    const status = await p.status();
    if (!status.success) {
      throw new Error(`Failed to create fly app ${applicationName}`);
    }
  }
}

// The Record<string,any> form here isn't as strict as I'd like - it should be an object
// with a single key, with a value also an object of any number of k/v.  I have no idea how
// to express that in typescript.
// deno-lint-ignore no-explicit-any
type Plugin = string | Record<string, Record<string, any>>;

export type CommandStep = {
  label?: string;
  command: string | string[];
  depends_on?: string | string[];
  allow_dependency_failure?: boolean;
  plugins?: Plugin[];
  agents?: string[];
  key?: string;
  soft_fail?: boolean;
};

async function createMachine(
  machinesApi: Machines,
  applicationName: string,
  command: CommandStep,
  config: Config
): Promise<[CommandStep & { key: string }, string, string[]]> {
  const machineNamePrefix = applicationName + "-";
  const [agentName, machineID, volumesCreated] = await machinesApi.startMachine(
    machineNamePrefix,
    config.image,
    config.cpus,
    config.memory,
    config.storage,
    config.environment
  );

  return [
    {
      ...command,
      agents: [`${agentName}=true`],
      key: agentName,
      plugins: [
        {
          "seek-oss/aws-sm#v2.3.1": {
            region: "us-east-2",
            env: {
              BUILDEVENT_APIKEY: "honeycomb-api-key",
            },
          },
        },
        "replayio/buildevents#2810143",
      ],
    },
    machineID,
    volumesCreated,
  ];
}

function cleanupStep(
  applicationName: string,
  machines: string[],
  dependencies: string[],
  volumes: string[]
): CommandStep {
  const volumeDeletes = volumes.map((v) => `fly volumes delete ${v} -y`);
  const wait2Mins = `sleep 120`;
  const machineDeletes = machines.map(
    (id) => `fly machine remove -a ${applicationName} ${id} --force`
  );
  const commands = machineDeletes.concat(wait2Mins).concat(volumeDeletes);
  return {
    label: ":broom: Clean up fly resources",
    command: commands,
    // TODO(dmiller): instead of hardcoding this, maybe grab the buildkite agent tags from
    // [BUILDKITE_AGENT_META_DATA_*](https://buildkite.com/docs/pipelines/environment-variables#BUILDKITE_AGENT_META_DATA_)
    agents: ["deploy=true"],
    depends_on: dependencies,
    allow_dependency_failure: true,
    soft_fail: true,
    plugins: [
      "thedyrt/skip-checkout#v0.1.1",
      {
        "seek-oss/aws-sm#v2.3.1": {
          region: "us-east-2",
          env: {
            FLY_API_TOKEN: "prod/fly-api-token",
            BUILDEVENT_APIKEY: "honeycomb-api-key",
          },
        },
      },
      "replayio/buildevents#2810143",
    ],
  };
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

  const machinesApi = new Machines(config.api_token, applicationName);

  const machines: string[] = [];
  const stepKeys: string[] = [];
  const volumes: string[] = [];
  try {
    let pipeline;
    if (config.matrix) {
      const commandPromises = config.matrix.map(async (m) => {
        const command = config.command.replace("{{matrix}}", m);
        const commandConfig = {
          command,
        };
        const [step, machineID, volumesCreated] = await createMachine(
          machinesApi,
          applicationName,
          commandConfig,
          config
        );
        machines.push(machineID);
        assert(step.key);
        stepKeys.push(step.key);
        volumes.push(...volumesCreated);

        return step;
      });
      const commandSteps = await Promise.all(commandPromises);
      const steps = [
        ...commandSteps,
        cleanupStep(applicationName, machines, stepKeys, volumes),
      ];
      pipeline = { steps };
    } else {
      const command = config.command;
      const commandConfig = {
        command,
        key: "command-step",
      };
      const [step, machineID, volumesCreated] = await createMachine(
        machinesApi,
        applicationName,
        commandConfig,
        config
      );
      machines.push(machineID);
      assert(step.key);
      stepKeys.push(step.key);
      volumes.push(...volumesCreated);
      const steps = [
        step,
        cleanupStep(applicationName, machines, stepKeys, volumesCreated),
      ];
      pipeline = { steps };
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
  }
}

await main().catch((e) => {
  console.error(`Error in main`, e);
  throw e;
});
