# Fly Buildkite Plugin

## How to do a release?
- Make change and merge to main
- Make a new tag on main
- earthly +compile-all
- Create a new release for the tag you created in step 2. Name it the name of the tag
- Take the linux binary in out/ and upload it as the release asset
- Update the buildkite invocations to point to the new plugin version
