export function applicationNameFromPipelineName(pipelineName: string): string {
  // Name may only contain numbers, lowercase letters and dashes
  // first downcase everything
  const pipelineNameLower = pipelineName.toLowerCase();
  // then replace all spaces with dashes
  const pipelineNameNoSpaces = pipelineNameLower.replace(/ /g, "-");
  // then replace all non-alphanumeric characters with dashes
  const pipelineNameNoSpecialChars = pipelineNameNoSpaces.replace(
    /[^a-z0-9-]/g,
    "-"
  );

  return `buildkite-${pipelineNameNoSpecialChars}`;
}
