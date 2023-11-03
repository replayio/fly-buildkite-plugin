export async function createSecrets(
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
