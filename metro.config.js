// Learn more https://docs.expo.dev/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Ensure the entry point is correctly resolved
config.resolver.sourceExts = [...(config.resolver.sourceExts || []), 'jsx', 'js', 'ts', 'tsx', 'json'];

module.exports = config;






