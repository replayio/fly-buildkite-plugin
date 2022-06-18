export class FlyProxy {
  private readonly apiToken: string;
  private readonly organization: string;
  private readonly flyProxy: Deno.Process;

  constructor(apiToken: string, organization: string) {
    this.apiToken = apiToken;
    this.organization = organization;
    this.flyProxy = this.startFlyProxy();
  }

  private startFlyProxy(): Deno.Process {
    const flyProxy = Deno.run({
      cmd: [
        "flyctl",
        "--access-token",
        this.apiToken,
        "--org",
        this.organization,
        "machine",
        "api-proxy",
      ],
    });

    return flyProxy;
  }

  public stop() {
    this.flyProxy.kill("SIGINT");
  }
}
