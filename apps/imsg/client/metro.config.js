const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// Let Metro bundle files from ../shared (outside the client project root).
config.watchFolders = [path.resolve(__dirname, "..")];

// Visual fixtures replace the Convex-backed identity module at bundle time.
// Production never enters this branch, and the fixture module contains no
// Convex client calls, so screenshots cannot touch live identity state.
if (process.env.IMSG_VISUAL_FIXTURE === "1") {
  const fixtureIdentity = path.resolve(__dirname, "src/lib/identity.fixture.ts");
  config.resolver.resolveRequest = (context, moduleName, platform) => {
    if (moduleName === "@/lib/identity") {
      return context.resolveRequest(context, fixtureIdentity, platform);
    }
    return context.resolveRequest(context, moduleName, platform);
  };
}

module.exports = config;
