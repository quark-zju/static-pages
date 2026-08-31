import assert from "node:assert/strict";
import test from "node:test";

import { createCubeModel } from "../../public/cube-pattern-transformer/cube-model.mjs";
import {
  analyzePieceState,
  assertValidPieceState,
} from "../../public/cube-pattern-transformer/piece-state.mjs";

const SIZES = [2, 3, 4, 5];

test("legal move sequences decode into valid piece states at every size", () => {
  const algorithms = [
    "R U F2 L D B'",
    "F' R2 U B L2 D'",
    "U2 R' F D2 L B2",
  ];

  for (const size of SIZES) {
    const model = createCubeModel(size);
    for (const algorithm of algorithms) {
      const state = model.applyAlgorithm(model.solvedColors, algorithm);
      const analysis = analyzePieceState(model, state);

      assert.equal(analysis.valid, true);
      assert.equal(analysis.orbits.length, model.pieceOrbits.length);
      assert.ok(analysis.orbits.flatMap((orbit) => orbit.positions)
        .every((position) => position.candidates.some((candidate) => candidate.orientation !== null)));
      assert.deepEqual(assertValidPieceState(model, state), analysis);
    }
  }
});

test("a single twisted corner violates the orientation sum", () => {
  const model = createCubeModel(3);
  const state = [...model.solvedColors];
  const corner = model.pieces.find((piece) => piece.kind === "corner");
  const [first, second, third] = corner.stickerIndices;
  [state[first], state[second], state[third]] = [state[second], state[third], state[first]];

  const analysis = analyzePieceState(model, state);
  assert.equal(analysis.valid, false);
  assert.ok(analysis.errors.some((error) => error.code === "corner-orientation-sum"));
  assert.throws(() => assertValidPieceState(model, state), /corner-orientation-sum/);
});

test("a mirrored corner sticker order is rejected", () => {
  const model = createCubeModel(4);
  const state = [...model.solvedColors];
  const corner = model.pieces.find((piece) => piece.kind === "corner");
  const [first, second] = corner.stickerIndices;
  [state[first], state[second]] = [state[second], state[first]];

  const analysis = analyzePieceState(model, state);
  assert.equal(analysis.valid, false);
  assert.ok(analysis.errors.some((error) => error.code === "mirrored-piece"));
});

test("a single flipped edge violates its orbit orientation sum", () => {
  for (const size of [3, 4, 5]) {
    const model = createCubeModel(size);
    const state = [...model.solvedColors];
    const edge = model.pieces.find((piece) => piece.kind === "edge");
    const [first, second] = edge.stickerIndices;
    [state[first], state[second]] = [state[second], state[first]];

    const analysis = analyzePieceState(model, state);
    assert.equal(analysis.valid, false);
    assert.ok(analysis.errors.some((error) => error.code === "edge-orientation-sum"));
  }
});

test("unique-piece orbits expose observable permutation parity", () => {
  const model3 = createCubeModel(3);
  const state3 = model3.applyAlgorithm(model3.solvedColors, "R U F");
  const analysis3 = analyzePieceState(model3, state3);
  assert.equal(analysis3.orbits.find((orbit) => orbit.kind === "corner").permutationParity, 1);
  assert.equal(analysis3.orbits.find((orbit) => orbit.kind === "edge").permutationParity, 1);

  const model5 = createCubeModel(5);
  const analysis5 = analyzePieceState(model5, model5.solvedColors);
  const edgeOrbits = analysis5.orbits.filter((orbit) => orbit.kind === "edge");
  assert.equal(edgeOrbits.find((orbit) => orbit.positions.length === 12).permutationParity, 0);
  assert.equal(edgeOrbits.find((orbit) => orbit.positions.length === 24).permutationParity, null);
});

test("missing pieces and unknown colors produce structured errors", () => {
  const model = createCubeModel(5);
  const missingPiece = [...model.solvedColors];
  const [first, second] = model.pieces.find((piece) => piece.kind === "edge").stickerIndices;
  missingPiece[second] = missingPiece[first];
  const inventoryAnalysis = analyzePieceState(model, missingPiece);

  assert.equal(inventoryAnalysis.valid, false);
  assert.ok(inventoryAnalysis.errors.some((error) => error.code === "piece-inventory"));

  const unknownColor = [...model.solvedColors];
  unknownColor[0] = "purple";
  assert.deepEqual(analyzePieceState(model, unknownColor).errors, [
    { code: "unknown-color", colors: ["purple"] },
  ]);
  assert.deepEqual(analyzePieceState(model, ["white"]).errors, [
    { code: "sticker-count", expectedCount: 150, actualCount: 1 },
  ]);
});
