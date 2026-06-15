import { describe, expect, it } from "vitest";
import { Text } from "@codemirror/state";
import { findParagraphLines } from "../src/focus-mode";

describe("focus-mode paragraph detection", () => {
  it("test_findParagraphLines_cursorInMiddle_returnsWholeBlock", () => {
    const doc = Text.of(["first", "second", "third", "", "other"]);
    // "first\nsecond\n..." → line 2 ("second") starts at pos 6
    const lines = findParagraphLines(doc, 6);
    expect(lines).toEqual([
      doc.line(1).from, // "first"
      doc.line(2).from, // "second"
      doc.line(3).from, // "third"
    ]);
  });

  it("test_findParagraphLines_cursorAtStart_returnsFirstBlock", () => {
    const doc = Text.of(["alpha", "beta", "", "gamma"]);
    const lines = findParagraphLines(doc, 0);
    expect(lines).toEqual([doc.line(1).from, doc.line(2).from]);
  });

  it("test_findParagraphLines_cursorAtEnd_returnsLastBlock", () => {
    const doc = Text.of(["alpha", "", "gamma", "delta"]);
    const lines = findParagraphLines(doc, doc.line(3).from);
    expect(lines).toEqual([doc.line(3).from, doc.line(4).from]);
  });

  it("test_findParagraphLines_singleLine_returnsThatLine", () => {
    const doc = Text.of(["", "alone", ""]);
    const lines = findParagraphLines(doc, doc.line(2).from);
    expect(lines).toEqual([doc.line(2).from]);
  });

  it("test_findParagraphLines_blankLine_returnsOnlyBlankLine", () => {
    const doc = Text.of(["above", "", "below"]);
    const lines = findParagraphLines(doc, doc.line(2).from);
    expect(lines).toEqual([doc.line(2).from]);
  });

  it("test_findParagraphLines_emptyDoc_returnsSingleLine", () => {
    const doc = Text.of([""]);
    const lines = findParagraphLines(doc, 0);
    expect(lines).toEqual([0]);
  });

  it("test_findParagraphLines_noBlankLines_returnsAllLines", () => {
    const doc = Text.of(["one", "two", "three"]);
    const lines = findParagraphLines(doc, doc.line(2).from);
    expect(lines).toEqual([doc.line(1).from, doc.line(2).from, doc.line(3).from]);
  });
});
