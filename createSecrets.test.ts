import {
  assertEquals,
  assertExists,
  assertRejects,
} from "https://deno.land/std@0.145.0/testing/asserts.ts";
import * as mf from "https://deno.land/x/mock_fetch@0.3.0/mod.ts";
import { createSecrets } from "./createSecrets.ts";

Deno.test("createSecrets", async (t) => {
  await t.step("install mf", () => mf.install());

  await t.step(
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

  await t.step(
    "createSecrets should throw an error if the fetch request fails",
    async () => {
      Deno.env.set("SECRET_KEY", "SECRET_VALUE");
      mf.mock("POST@/graphql", () => {
        return new Response("Fetch error", {
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

  await t.step(
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

  await t.step(
    "createSecrets should handle secrets represented as a Record",
    async () => {
      Deno.env.set("SECRET_KEY_ON_BOX", "SECRET_VALUE");
      mf.mock("POST@/graphql", async (req) => {
        assertExists(req.body);
        const text = await req.text();
        const body = JSON.parse(text);
        assertEquals(body.variables.appId, "testApp");
        assertEquals(body.variables.secrets, [
          {
            key: "SECRET_KEY_IN_FLY",
            value: "SECRET_VALUE",
          },
        ]);

        return new Response("OK", {
          status: 200,
        });
      });

      await createSecrets("testApp", "testToken", {
        SECRET_KEY_IN_FLY: "SECRET_KEY_ON_BOX",
      });

      Deno.env.delete("SECRET_KEY_ON_BOX");
      mf.reset();
    }
  );

  await t.step("uninstall mf", () => mf.uninstall());
});
