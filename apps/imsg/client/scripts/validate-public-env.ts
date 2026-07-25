import { validateConvexUrl, validateIdentityKey } from "../src/lib/public-env";

const results = [
  validateConvexUrl(process.env.EXPO_PUBLIC_CONVEX_URL),
  validateIdentityKey(process.env.EXPO_PUBLIC_IMSG_IDENTITY_KEY),
];
const errors = results.flatMap((result) => result.ok ? [] : [result.error]);
if (errors.length > 0) {
  for (const error of errors) console.error(`Client build aborted: ${error}`);
  process.exit(1);
}

console.log("Client public environment validated");
