const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// Let Metro bundle files from ../shared (outside the client project root).
config.watchFolders = [path.resolve(__dirname, "..")];

module.exports = config;
