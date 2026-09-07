import assert from "node:assert/strict";
import test from "node:test";

import { createCubeModel } from "../../public/cube-pattern-transformer/cube-model.mjs";
import { validateEditorState } from "../../public/cube-pattern-transformer/editor-validation.mjs";
import {
  describePatternTargetError,
  describePieceStateError,
  describePieceStateErrors,
} from "../../public/cube-pattern-transformer/error-explanation.mjs";
import { analyzePieceState } from "../../public/cube-pattern-transformer/piece-state.mjs";

test("in-place corner twist explains the orientation-sum violation", () => {
  const model = createCubeModel(4);
  const state = [...model.solvedColors];
  const corner = model.pieces.find((piece) => piece.kind === "corner");
  const [first, second, third] = corner.stickerIndices;
  [state[first], state[second], state[third]] = [
    state[second],
    state[third],
    state[first],
  ];

  const analysis = analyzePieceState(model, state);
  assert.equal(analysis.valid, false);
  const text = describePieceStateErrors(model, analysis.errors);
  assert.match(text, /角块扭转总和不是 3 的倍数/);
});

test("duplicated corner colors are reported as missing plus extra pieces", () => {
  const model = createCubeModel(3);
  const state = [...model.solvedColors];
  const [victim, donor] = model.pieces.filter((piece) => piece.kind === "corner");
  donor.stickerIndices.forEach(
    (index, slot) => { state[index] = state[victim.stickerIndices[slot]]; },
  );

  const analysis = analyzePieceState(model, state);
  const text = describePieceStateErrors(model, analysis.errors);
  assert.match(text, /多出 1 个 .+ 角块/);
  assert.match(text, /缺少 1 个 .+ 角块/);
  assert.match(text, /[白红绿黄橙蓝]/);
});

test("swapped stickers inside one corner are explained as a mirrored piece", () => {
  const model = createCubeModel(3);
  const state = [...model.solvedColors];
  const corner = model.pieces.find((piece) => piece.kind === "corner");
  const [first, second] = corner.stickerIndices;
  [state[first], state[second]] = [state[second], state[first]];

  const analysis = analyzePieceState(model, state);
  const mirrored = analysis.errors.find((error) => error.code === "mirrored-piece");
  assert.ok(mirrored, "expected a mirrored-piece finding");
  const text = describePieceStateError(model, mirrored);
  assert.match(text, /镜像/);
  assert.match(text, /[URFDLB][123]-[123]/);
});

test("wing handedness findings use the wing label and count pairing", () => {
  const model = createCubeModel(4);
  const wingOrbit = model.pieceOrbits.find((orbit) => (
    orbit.kind === "edge" && orbit.pieceIndices.length === 24
  ));
  const text = describePieceStateError(model, {
    code: "wing-handedness-inventory",
    orbitId: wingOrbit.id,
    signature: "green|white",
    expected: [12, 12],
    actual: [13, 11],
  });
  assert.match(text, /翼块手性不配平：应 12\+12，实为 13\+11/);
});

test("long finding lists are capped with a remainder count", () => {
  const model = createCubeModel(3);
  const signatures = [
    "green|red|white", "blue|red|white", "blue|orange|white",
    "green|red|yellow", "orange|red|yellow",
  ];
  const errors = signatures.map((signature) => ({
    code: "piece-inventory",
    orbitId: "corner-0",
    signature,
    expectedCount: 1,
    actualCount: 2,
  }));
  const text = describePieceStateErrors(model, errors, { max: 2 });
  assert.match(text, /另有 3 处问题/);
});

test("wildcard target findings name the failing orbit constraint", () => {
  const model = createCubeModel(3);
  const pattern = Array(model.stickers.length).fill(null);
  const corner = model.pieces.find((piece) => piece.kind === "corner");
  for (const index of corner.stickerIndices) pattern[index] = "white";

  const validation = validateEditorState(model, pattern, "target");
  assert.equal(validation.valid, false);
  assert.equal(validation.reason, "physical-pattern");
  const text = describePatternTargetError(model, validation.details);
  assert.match(text, /没有任何合法块能满足该处颜色/);
});

test("unrecognized or empty findings degrade gracefully", () => {
  const model = createCubeModel(3);
  assert.equal(describePieceStateErrors(model, []), "");
  assert.equal(describePieceStateErrors(model, undefined), "");
  assert.equal(describePatternTargetError(model, null), "");
  assert.equal(describePatternTargetError(model, { code: "something-new" }), "");
  assert.equal(describePieceStateError(model, { code: "something-new" }), null);
});
