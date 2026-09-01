import assert from "node:assert/strict";
import test from "node:test";

import { createCubeModel } from "../../public/cube-pattern-transformer/cube-model.mjs";
import { validateEditorState } from "../../public/cube-pattern-transformer/editor-validation.mjs";

test("editor validation rejects exact states with legal color counts but illegal pieces", () => {
  const model = createCubeModel(4);
  const invalid = [...model.solvedColors];
  const corner = model.pieces.find((piece) => piece.kind === "corner");
  const [first, second, third] = corner.stickerIndices;
  [invalid[first], invalid[second], invalid[third]] = [
    invalid[second],
    invalid[third],
    invalid[first],
  ];

  const validation = validateEditorState(model, invalid, "source");
  assert.equal(validation.valid, false);
  assert.equal(validation.reason, "physical-state");
  assert.ok(validation.details.some((error) => error.code === "corner-orientation-sum"));
});

test("editor validation checks whether wildcard constraints admit physical pieces", () => {
  const model = createCubeModel(3);
  const pattern = Array(model.stickers.length).fill(null);
  const corner = model.pieces.find((piece) => piece.kind === "corner");
  for (const index of corner.stickerIndices) pattern[index] = "white";

  const validation = validateEditorState(model, pattern, "target");
  assert.equal(validation.valid, false);
  assert.equal(validation.reason, "physical-pattern");
  assert.equal(validation.details.code, "no-position-candidate");
});

test("editor validation accepts legal exact and completable wildcard states", () => {
  const model = createCubeModel(5);
  assert.equal(validateEditorState(model, model.solvedColors, "source").valid, true);

  const pattern = [...model.solvedColors];
  const wing = model.pieces.find((piece) => piece.kind === "edge"
    && model.pieceOrbits.some((orbit) => (
      orbit.pieceIndices.length === 24 && orbit.pieceIndices.includes(model.pieces.indexOf(piece))
    )));
  for (const index of wing.stickerIndices) pattern[index] = null;
  const validation = validateEditorState(model, pattern, "target");
  assert.equal(validation.valid, true);
  assert.equal(validation.wildcardCount, 2);
});
