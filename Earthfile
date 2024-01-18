VERSION 0.6

FROM denoland/deno:alpine-1.23.1

compile:
  COPY index.ts config.ts createSecrets.ts .
  COPY fly fly
  ARG TARGET_PLATFORM=x86_64-unknown-linux-gnu
  RUN deno compile --target ${TARGET_PLATFORM} -o fly-buildkite-plugin-${TARGET_PLATFORM}  --allow-env --allow-run --allow-net index.ts
  SAVE ARTIFACT fly-buildkite-plugin-${TARGET_PLATFORM} AS LOCAL out/fly-buildkite-plugin-${TARGET_PLATFORM}

compile-all:
  BUILD --build-arg TARGET_PLATFORM=x86_64-unknown-linux-gnu +compile
  BUILD --build-arg TARGET_PLATFORM=x86_64-apple-darwin +compile
  BUILD --build-arg TARGET_PLATFORM=aarch64-apple-darwin +compile

test:
  COPY index.ts config.ts createSecrets.ts createSecrets.test.ts .
  COPY fly fly
  RUN deno test --allow-env

# TODO(dmiller): try to imitate https://github.com/earthly/earthly/blob/main/release/Earthfile#L66 to release on GitHub
# for now let's just do it by hand
