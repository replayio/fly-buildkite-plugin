import { assertRejects } from "https://deno.land/std@0.145.0/testing/asserts.ts";
import * as mf from "https://deno.land/x/mock_fetch@0.3.0/mod.ts";
import { createSecrets } from "./createSecrets.ts";

Deno.test("createSecrets", () => {
  mf.install();

  Deno.test(
    "createSecrets should throw an error if a secret is not set in environment",
    async () => {
      const originalEnvGet = Deno.env.get;
      Deno.env.get = () => undefined;

      await assertRejects(
        () => createSecrets("testApp", "testToken", ["SECRET_KEY"]),
        Error,
        "Secret SECRET_KEY is not set in environment"
      );

      Deno.env.get = originalEnvGet; // Restore original function
    }
  );

  Deno.test(
    "createSecrets should throw an error if the fetch request fails",
    async () => {
      Deno.env.set("SECRET_KEY", "SECRET_VALUE");
      mf.mock("POST@/graphql", () => {
        return new Response("Error", {
          status: 500,
        });
      });

      await assertRejects(
        () => createSecrets("testApp", "testToken", ["SECRET_KEY"]),
        Error,
        "Failed to create secrets: Fetch error"
      );

      Deno.env.delete("SECRET_KEY");
      mf.reset();
    }
  );

  Deno.test(
    "createSecrets should not throw an error if the fetch request succeeds",
    async () => {
      Deno.env.set("SECRET_KEY", "SECRET_VALUE");
      mf.mock("POST@/graphql", () => {
        return new Response("OK", {
          status: 200,
        });
      });

      await createSecrets("testApp", "testToken", ["SECRET_KEY"]);

      Deno.env.delete("SECRET_KEY");
      mf.reset();
    }
  );

  mf.uninstall();
});
