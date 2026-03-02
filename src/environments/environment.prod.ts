export const environment = {
  production: true,
  otaServerUrl: 'https://server-ota.vercel.app',
  versionCheckIntervalMs: 5 * 60 * 1000,
  maxCachedBundles: 3,
  bundleHealthCheckTimeoutMs: 15_000,
  maxRetries: 3,
};
