import { describe, expect, test } from "bun:test";

import { staticCacheControl } from "./static-cache";

describe("staticCacheControl", () => {
  test("HTML and the SPA entry are never cached", () => {
    expect(staticCacheControl("/")).toBe("no-store");
    expect(staticCacheControl("/index.html")).toBe("no-store");
    expect(staticCacheControl("/chat/abc.html")).toBe("no-store");
    expect(staticCacheControl("/manifest.webmanifest")).toBe("no-store");
  });

  test("hashed Expo assets are immutable", () => {
    expect(staticCacheControl("/_expo/static/js/web/entry-abc.js")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(staticCacheControl("/_expo/static/css/global-abc.css")).toBe(
      "public, max-age=31536000, immutable",
    );
  });

  test("content-hashed exported assets are immutable", () => {
    expect(staticCacheControl("/assets/node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/Ionicons.b4eb097d35f44ed943676fd56f6bdc51.ttf")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(staticCacheControl("/assets/node_modules/expo-router/assets/react-navigation/elements/close-icon.808e1b1b9b53114ec2838071a7e6daa7@3x.png")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(staticCacheControl("/assets/fonts/unhashed.ttf")).toBe("no-cache");
  });

  test("everything else revalidates", () => {
    expect(staticCacheControl("/icon-512.png")).toBe("no-cache");
    expect(staticCacheControl("/favicon.ico")).toBe("no-cache");
  });
});
