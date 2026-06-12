const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// Enable package.json `exports` field resolution so that ESM-first packages
// like isomorphic-git (which exposes `isomorphic-git/http/web` via exports)
// can be resolved by Metro.
config.resolver = {
  ...config.resolver,
  unstable_enablePackageExports: true,
};

module.exports = config;