export async function createSecrets(
  appName: string,
  accessToken: string,
  secrets: Array<string> | Record<string, string>
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

  // if secrets is an array then convert it in to a map of the environment variable and its value
  let secretsMap: Record<string, string> = {};
  if (Array.isArray(secrets)) {
    secretsMap = secrets.reduce((acc, key) => {
      const value = Deno.env.get(key);
      if (!value) {
        throw new Error(`Secret ${key} is not set in environment`);
      }

      return {
        ...acc,
        [key]: value,
      };
    }, {});
  } else {
    secretsMap = Object.entries(secrets).reduce(
      (acc, [secretName, envVarName]) => {
        const envValue = Deno.env.get(envVarName);
        if (!envValue) {
          throw new Error(`Environment variable ${envVarName} is not set`);
        }

        return {
          ...acc,
          [secretName]: envValue,
        };
      },
      {}
    );
  }

  const secretsArray = Object.entries(secretsMap).map(([key, value]) => ({
    key,
    value,
  }));

  const variables = {
    appId: appName,
    secrets: secretsArray,
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
