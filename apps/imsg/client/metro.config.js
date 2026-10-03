const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");
const { createDevRealDataMiddleware } = require("./scripts/dev-real-data-proxy");

const config = getDefaultConfig(__dirname);

// Let Metro bundle files from ../shared (outside the client project root).
config.watchFolders = [path.resolve(__dirname, "..")];

if (process.env.IMSG_VISUAL_FIXTURE === "1") {
  const fixtures = {
    [path.resolve(__dirname, "src/lib/identity.ts")]: path.resolve(__dirname, "src/lib/identity.fixture.ts"),
    [path.resolve(__dirname, "src/lib/convex-auth.tsx")]: path.resolve(__dirname, "src/lib/convex-auth.fixture.tsx"),
  };
  config.resolver.resolveRequest = (context, moduleName, platform) => {
    const resolved = context.resolveRequest(context, moduleName, platform);
    if (resolved.type === "sourceFile" && Object.hasOwn(fixtures, resolved.filePath)) {
      return context.resolveRequest(context, fixtures[resolved.filePath], platform);
    }
    return resolved;
  };
}

if (process.env.IMSG_DEV_DATA) {
  if (process.env.IMSG_DEV_DATA !== "real") {
    throw new Error(`Unsupported IMSG_DEV_DATA mode: ${process.env.IMSG_DEV_DATA}`);
  }
  const upstreamUrl = process.env.IMSG_DEV_UPSTREAM_URL;
  if (!upstreamUrl) throw new Error("IMSG_DEV_UPSTREAM_URL is required for real-data development");
  const enhanceMiddleware = config.server.enhanceMiddleware;
  config.server.enhanceMiddleware = (middleware, metroServer) => {
    const enhanced = enhanceMiddleware(middleware, metroServer);
    if (typeof enhanced !== "function") {
      throw new Error("Metro enhanceMiddleware returned a non-callable server");
    }
    return createDevRealDataMiddleware(enhanced, upstreamUrl);
  };
}

module.exports = config;
