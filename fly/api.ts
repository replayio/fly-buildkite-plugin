type MachineConfig = {
  image: string;
  cpus: number;
  memory: number;
  storage: number | null;
};

export class FlyApi {
  private readonly apiToken: string;
  private readonly appName: string;

  constructor(apiToken: string, appName: string) {
    this.apiToken = apiToken;
    this.appName = appName;
  }

  public setSecret() {}

  public createAndStartMachine(name: string, config: MachineConfig) {}

  public stopMachine(name: string) {}
}
