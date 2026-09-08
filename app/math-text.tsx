import { memo } from "react";
import katex from "katex";
const MATH_DELIMITER = /(\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\))/g;

export const MathText = memo(function MathText({ text }: { text: string }) {
  return text.split(MATH_DELIMITER).map((part, index) => {
    const displayMode = part.startsWith("\\[") && part.endsWith("\\]");
    const inlineMode = part.startsWith("\\(") && part.endsWith("\\)");

    if (!displayMode && !inlineMode) {
      return part;
    }

    const expression = part.slice(2, -2);
    const html = katex.renderToString(expression, {
      displayMode,
      output: "htmlAndMathml",
      strict: "warn",
      throwOnError: false,
      trust: false,
    });

    return (
      <span
        className={displayMode ? "math-display" : "math-inline"}
        // KaTeX escapes untrusted commands and emits accessible MathML alongside HTML.
        dangerouslySetInnerHTML={{ __html: html }}
        key={`${index}-${expression}`}
      />
    );
  });
});
