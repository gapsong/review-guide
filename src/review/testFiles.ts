const testFilePatterns = [
  /(^|\/)(tests?|__tests__|spec|specs)\//,
  /(^|\/)test_[^/]*\.py$/,
  /_test\.(py|go|rs)$/,
  /\.(test|spec)\.[cm]?[jt]sx?$/,
  /(^|\/)conftest\.py$/,
];

export function isTestFile(path: string): boolean {
  return testFilePatterns.some((pattern) => pattern.test(path));
}
