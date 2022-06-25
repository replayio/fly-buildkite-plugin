import { assertEquals } from "https://deno.land/std@0.145.0/testing/asserts.ts";
import { applicationNameFromPipelineName } from "./app.ts";

Deno.test("applicationNameFromPipelineName", () => {
  assertEquals(applicationNameFromPipelineName("test"), "buildkite-test");
  assertEquals(applicationNameFromPipelineName("test123"), "buildkite-test123");
  assertEquals(
    applicationNameFromPipelineName("test-123"),
    "buildkite-test-123"
  );
  assertEquals(
    applicationNameFromPipelineName("test-123-456"),
    "buildkite-test-123-456"
  );
  assertEquals(applicationNameFromPipelineName("TEST"), "buildkite-test");
  assertEquals(applicationNameFromPipelineName("TEST123"), "buildkite-test123");
  assertEquals(
    applicationNameFromPipelineName("I'm just a regular pipeline name"),
    "buildkite-i-m-just-a-regular-pipeline-name"
  );
});
