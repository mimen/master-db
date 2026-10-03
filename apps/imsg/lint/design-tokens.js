// Bans raw design values where the token scale exists: a numeric fontSize or
// borderRadius, and any hex color literal. Scoped in .oxlintrc.json.
const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const NUMERIC_KEYS = new Set(["fontSize", "borderRadius"]);

function keyName(property) {
  if (property.key.type === "Identifier") return property.key.name;
  if (property.key.type === "Literal") return String(property.key.value);
  return null;
}

const noRawTokens = {
  meta: { type: "problem", messages: {
    numeric: "Use a token for {{key}} (TypeRamp / Radius in constants/tokens.ts), not {{value}}.",
    hex: "Use a Palette or Colors token, not the hex literal {{value}}.",
  } },
  create(context) {
    return {
      Property(node) {
        const key = keyName(node);
        if (key && NUMERIC_KEYS.has(key) && node.value.type === "Literal" && typeof node.value.value === "number") {
          context.report({ node: node.value, messageId: "numeric", data: { key, value: String(node.value.value) } });
        }
      },
      Literal(node) {
        if (typeof node.value === "string" && HEX.test(node.value)) {
          context.report({ node, messageId: "hex", data: { value: node.value } });
        }
      },
    };
  },
};

export default { meta: { name: "design-tokens" }, rules: { "no-raw-tokens": noRawTokens } };
