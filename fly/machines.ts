/*
 * In order to interact with the Fly machines API you need to start
 * a proxy server. This file starts that proxy server, waits for it to start
 * and then implements functions that interact with the Fly API via the proxy.
 */

import { delay } from "https://deno.land/std@0.144.0/async/delay.ts";

const REGIONS = ["dfw", "iad", "lax", "mia", "ord", "sea", "sjc"];
const MAX_ATTEMPTS = 3;

type MachineStartResponse = {
  id: string;
};

type VolumeCreateResponse = {
  id: string;
};

type CreateMachinePayload = {
  region: string;
  config: {
    image: string;
    env: Record<string, string>;
    guest: {
      cpu_kind: "shared";
      cpus: number;
      memory_mb: number;
    };
    mounts: {
      volume: string;
      path: string;
    }[];
  };
};

export class Machines {
  private readonly apiToken: string;
  private readonly applicationName: string;
  private readonly address = "https://api.machines.dev";

  constructor(apiToken: string, applicationName: string) {
    this.apiToken = apiToken;
    this.applicationName = applicationName;
  }

  private async createVolume(region: string, sizeInGB: number) {
    const cmd = [
      "fly",
      "-a",
      this.applicationName,
      "volumes",
      "create",
      "buildkite_data",
      "--region",
      region,
      "--size",
      sizeInGB.toString(),
      "--no-encryption",
      "--require-unique-zone=false",
      "--json",
      "--access-token",
      this.apiToken,
      "--yes",
    ];
    const p = Deno.run({ cmd, stdout: "piped", stderr: "inherit" });
    const [status, createVolumeOutput] = await Promise.all([
      p.status(),
      p.output(),
    ]);
    p.close();
    if (!status.success) {
      console.error("Failed to create volume");
      throw new Error("Failed to create volume");
    }

    const volumeOutputString = new TextDecoder().decode(createVolumeOutput);
    const volumeOutputJson: VolumeCreateResponse =
      JSON.parse(volumeOutputString);

    return volumeOutputJson.id;
  }

  // TODO(dmiller): I guess this needs to try to create a volume too?
  private async startMachineInner(
    namePrefix: string,
    image: string,
    cpus: number,
    memory: number,
    storageInGB: number | null,
    env: Record<string, string>,
    attempts = 0,
    regionsToTry: string[] = REGIONS,
    volumesCreated: string[] = []
  ): Promise<[string, string, string[]]> {
    if (attempts > MAX_ATTEMPTS) {
      throw new Error(`Failed to start machine after ${attempts} attempts`);
    }

    const agentName = `${namePrefix}-${crypto.randomUUID()}`;

    // pick a random region to try
    const region =
      regionsToTry[Math.floor(Math.random() * regionsToTry.length)];

    let volumeId;
    if (storageInGB) {
      try {
        volumeId = await this.createVolume(region, storageInGB);
      } catch (e) {
        console.error("Failed to create volume", e);
        return this.startMachineInner(
          namePrefix,
          image,
          cpus,
          memory,
          storageInGB,
          env,
          attempts + 1,
          // remove the region we just tried from the list
          regionsToTry.filter((r) => r !== region),
          volumesCreated
        );
      }
      volumesCreated.push(volumeId);
    }
    const createMachinePayload: CreateMachinePayload = {
      region,
      config: {
        image,
        env: {
          BUILDKITE_AGENT_TAGS: agentName,
          BUILDKITE_AGENT_DISCONNECT_AFTER_JOB: "true",
          // If no job is received in 5 minutes then the agent will be disconnected and the machine will shut down
          BUILDKITE_AGENT_DISCONNECT_AFTER_IDLE_TIMEOUT: "300", // 5 minutes
          ...env,
        },
        guest: {
          // As of 22-06-22 machines created via the API can only used shared CPUs, not dedicated ones
          cpu_kind: "shared",
          cpus,
          memory_mb: memory,
        },
        mounts: [],
      },
    };
    if (volumeId) {
      createMachinePayload.config.mounts.push({
        volume: volumeId,
        path: "/mnt/data",
      });
    }
    console.error(
      `Creating machine ${this.applicationName}/${agentName} in region ${region}`
    );
    console.error(JSON.stringify(createMachinePayload, null, 2));
    const response = await fetch(
      `${this.address}/v1/apps/${this.applicationName}/machines`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiToken}`,
        },
        body: JSON.stringify(createMachinePayload),
      }
    );
    if (response.status !== 200) {
      console.error(
        `Failed to start machine for agent ${agentName}: ${response.status} ${
          response.statusText
        } ${await response.text()}`
      );
      return this.startMachineInner(
        namePrefix,
        image,
        cpus,
        memory,
        storageInGB,
        env,
        attempts + 1,
        // remove the region we just tried from the list
        regionsToTry.filter((r) => r !== region),
        volumesCreated
      );
    }
    const json: MachineStartResponse = await response.json();
    console.error("Started machine", json);

    // wait for machine to start
    const machineID = json.id;
    try {
      await this.waitForMachine(machineID);
    } catch (e) {
      console.error(`Failed to start machine: ${e}`);
      return this.startMachineInner(
        namePrefix,
        image,
        cpus,
        memory,
        storageInGB,
        env,
        attempts + 1,
        // remove the region we just tried from the list
        regionsToTry.filter((r) => r !== region),
        volumesCreated
      );
    }

    return [agentName, machineID, volumesCreated];
  }

  public startMachine(
    namePrefix: string,
    image: string,
    cpus: number,
    memory: number,
    storageInGB: number | null,
    env: Record<string, string>
  ) {
    return this.startMachineInner(
      namePrefix,
      image,
      cpus,
      memory,
      storageInGB,
      env,
      0,
      REGIONS
    );
  }

  private async waitForMachine(machineID: string) {
    // Each API call times out after 60 seconds. If the machine is not ready in
    // 180 seconds, or three calls to this API, throw an exception
    const maxAttempts = 3;
    let attempts = 0;
    while (attempts < maxAttempts) {
      attempts++;
      console.error(
        `Waiting for machine to start attempt ${attempts}/${maxAttempts}`
      );
      try {
        const url = `${this.address}/v1/apps/${this.applicationName}/machines/${machineID}/wait`;
        const response = await fetch(url, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiToken}`,
          },
        });
        if (response.ok) {
          console.error(`Machine ${machineID} started`);
          return;
        }
      } catch (e) {
        console.error(`Failed to wait for machine: ${e}`);
      }
      await delay(3000);
    }

    throw new Error(`Timed out waiting for machine ${machineID} to start`);
  }
}
