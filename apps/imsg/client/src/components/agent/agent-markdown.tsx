import { Lexer, type Token, type Tokens } from "marked";
import { memo, useMemo, type ReactNode } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { Fonts } from "@/constants/theme";
import { Radius, Space, Weight } from "@/constants/tokens";
import { useTheme } from "@/hooks/use-theme";
import { useTypeRamp } from "@/hooks/use-type";
import { openExternalUrl } from "@/lib/external-link";
import { showToast } from "@/lib/toast";

import { CopyButton } from "./copy-button";

type Theme = ReturnType<typeof useTheme>;

const OPENABLE = /^(https?:|mailto:)/i;

function openLink(href: string): void {
  void openExternalUrl(href).catch(() => showToast("Couldn't open this link."));
}

function inline(tokens: readonly Token[] | undefined, theme: Theme): ReactNode[] {
  return (tokens ?? []).map((token, index) => {
    switch (token.type) {
      case "strong":
        return <Text key={index} style={styles.bold}>{inline(token.tokens, theme)}</Text>;
      case "em":
        return <Text key={index} style={styles.italic}>{inline(token.tokens, theme)}</Text>;
      case "del":
        return <Text key={index} style={styles.deleted}>{inline(token.tokens, theme)}</Text>;
      case "codespan":
        return <Text key={index} style={[styles.code, { backgroundColor: theme.field }]}>{token.text}</Text>;
      case "br":
        return "\n";
      case "link": {
        const href = (token as Tokens.Link).href;
        return (
          <Text
            key={index}
            accessibilityRole="link"
            style={{ color: theme.accent }}
            onPress={OPENABLE.test(href) ? () => openLink(href) : undefined}
          >
            {inline(token.tokens, theme)}
          </Text>
        );
      }
      case "image":
        return <Text key={index} style={{ color: theme.textSecondary }}>{token.text || "Image"}</Text>;
      case "escape":
      case "text":
        return "tokens" in token && token.tokens ? <Text key={index}>{inline(token.tokens, theme)}</Text> : token.text;
      default:
        return token.raw;
    }
  });
}

function blocks(tokens: readonly Token[], theme: Theme, body: number): ReactNode[] {
  const paragraph = { color: theme.text, fontSize: body, lineHeight: Math.round(body * 1.5) };
  return tokens.map((token, index) => {
    switch (token.type) {
      case "space":
        return null;
      case "heading":
        return (
          <Text key={index} accessibilityRole="header" selectable style={[paragraph, styles.bold, { fontSize: body + (token.depth <= 2 ? 2 : 0) }]}>
            {inline(token.tokens, theme)}
          </Text>
        );
      case "code":
        return (
          <View key={index} testID="agent-code-block" style={[styles.codeBlock, { backgroundColor: theme.field }]}>
            <ScrollView horizontal contentContainerStyle={styles.codeScroll}>
              <Text selectable style={[styles.code, { color: theme.text }]}>{token.text}</Text>
            </ScrollView>
            <View style={styles.codeCopy}><CopyButton text={token.text} label="Copy code" /></View>
          </View>
        );
      case "blockquote":
        return (
          <View key={index} style={[styles.quote, { borderLeftColor: theme.dividerStrong }]}>
            {blocks(token.tokens ?? [], theme, body)}
          </View>
        );
      case "list": {
        const list = token as Tokens.List;
        const start = typeof list.start === "number" ? list.start : 1;
        return (
          <View key={index} style={styles.list}>
            {list.items.map((entry, row) => (
              <View key={row} style={styles.listRow}>
                <Text style={[paragraph, { color: theme.textSecondary }]}>
                  {entry.task ? (entry.checked ? "☑" : "☐") : list.ordered ? `${start + row}.` : "•"}
                </Text>
                <View style={styles.listBody}>{blocks(entry.tokens, theme, body)}</View>
              </View>
            ))}
          </View>
        );
      }
      case "table": {
        const table = token as Tokens.Table;
        return (
          <ScrollView key={index} horizontal>
            <View style={[styles.table, { borderColor: theme.divider }]}>
              {[table.header, ...table.rows].map((cells, row) => (
                <View key={row} style={styles.tableRow}>
                  {cells.map((cell, column) => (
                    <Text
                      key={column}
                      selectable
                      style={[styles.cell, { borderColor: theme.divider, color: theme.text, textAlign: table.align[column] ?? "left" }, row === 0 && styles.bold]}
                    >
                      {inline(cell.tokens, theme)}
                    </Text>
                  ))}
                </View>
              ))}
            </View>
          </ScrollView>
        );
      }
      case "hr":
        return <View key={index} style={[styles.rule, { backgroundColor: theme.divider }]} />;
      case "paragraph":
      case "text":
        return <Text key={index} selectable style={paragraph}>{inline("tokens" in token ? token.tokens : undefined, theme)}</Text>;
      default:
        return <Text key={index} selectable style={paragraph}>{token.raw}</Text>;
    }
  });
}

/** Assistant paragraphs. marked only lexes; every token becomes a plain RN Text or View, so web and native share it. */
export const AgentMarkdown = memo(function AgentMarkdown({ text }: { readonly text: string }) {
  const theme = useTheme();
  const { body } = useTypeRamp();
  const tokens = useMemo(() => Lexer.lex(text, { gfm: true }), [text]);
  return <View style={styles.root}>{blocks(tokens, theme, body)}</View>;
});

const styles = StyleSheet.create({
  root: { gap: Space.md, minWidth: 0 },
  bold: { fontWeight: Weight.semibold },
  italic: { fontStyle: "italic" },
  deleted: { textDecorationLine: "line-through" },
  code: { borderRadius: 4, fontFamily: Fonts.mono, fontSize: 12, lineHeight: 18 },
  codeBlock: { borderRadius: Radius.sm },
  // The right inset clears the copy button, so the first line never runs under it.
  codeScroll: { padding: Space.lg, paddingRight: Space.lg + 28 },
  codeCopy: { position: "absolute", right: Space.xs, top: Space.xs },
  quote: { borderLeftWidth: 2, gap: Space.md, paddingLeft: Space.lg },
  list: { gap: Space.xs },
  listRow: { flexDirection: "row", gap: Space.md },
  listBody: { flex: 1, gap: Space.xs, minWidth: 0 },
  table: { borderRadius: Radius.sm, borderWidth: StyleSheet.hairlineWidth },
  tableRow: { flexDirection: "row" },
  cell: { borderBottomWidth: StyleSheet.hairlineWidth, fontSize: 12.5, padding: Space.md, width: 150 },
  rule: { height: StyleSheet.hairlineWidth, marginVertical: Space.xs },
});
