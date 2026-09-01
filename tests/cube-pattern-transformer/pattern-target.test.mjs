import assert from "node:assert/strict";
import test from "node:test";

import { createCubeModel } from "../../public/cube-pattern-transformer/cube-model.mjs";
import {
  compileOrbitTarget,
  normalizeTargetPattern,
  PatternTargetError,
} from "../../public/cube-pattern-transformer/pattern-target.mjs";
import { createTwentyFourWingSolver } from "../../public/cube-pattern-transformer/wing-orbit-solver.mjs";

function projectedPattern(model, orbit, algorithm) {
  const moved = model.applyAlgorithm(model.solvedColors, algorithm);
  const pattern = [...model.solvedColors];
  for (const index of orbit.stickerIndices) pattern[index] = moved[index];
  return pattern;
}

test("target patterns normalize question marks without adding a seventh cube color", () => {
  const model = createCubeModel(2);
  const pattern = [...model.solvedColors];
  pattern[0] = "?";
  pattern[1] = null;
  const normalized = normalizeTargetPattern(model, pattern);

  assert.equal(normalized[0], null);
  assert.equal(normalized[1], null);
  assert.deepEqual(model.colors, ["white", "red", "green", "yellow", "orange", "blue"]);
  assert.throws(
    () => normalizeTargetPattern(model, [...pattern.slice(0, -1), "purple"]),
    (error) => error instanceof PatternTargetError && error.code === "unknown-pattern-color",
  );
});

test("an all-wildcard orbit prefers the current physical assignment", () => {
  for (const size of [2, 3, 4, 5]) {
    const model = createCubeModel(size);
    const current = model.applyAlgorithm(model.solvedColors, "R U F");
    const pattern = Array(model.stickers.length).fill(null);
    for (const orbit of model.pieceOrbits.filter((candidate) => (
      candidate.kind !== "center" || candidate.pieceIndices.length === 24
    ))) {
      const requiresEven = orbit.kind === "center"
        || (orbit.kind === "edge" && !(size === 4 && orbit.pieceIndices.length === 24));
      const compiled = compileOrbitTarget(model, orbit.id, current, pattern, {
        permutationParity: requiresEven ? 0 : null,
      });
      assert.equal(compiled.permutationParity, 0);
      assert.equal(compiled.orientationSum, 0);
      assert.ok(orbit.stickerIndices.every((index) => (
        compiled.targetColors[index] === current[index]
      )));
    }
  }
});

test("corners, middle edges, and wings require whole-piece wildcards", () => {
  for (const size of [2, 3, 4, 5]) {
    const model = createCubeModel(size);
    for (const orbit of model.pieceOrbits.filter((candidate) => candidate.kind !== "center")) {
      const pattern = [...model.solvedColors];
      const piece = model.pieces[orbit.pieceIndices[0]];
      pattern[piece.stickerIndices[0]] = null;
      assert.throws(
        () => compileOrbitTarget(model, orbit.id, model.solvedColors, pattern),
        (error) => error instanceof PatternTargetError && error.code === "partial-piece-wildcard",
      );
    }
  }
});

test("two wildcard wings can normalize a known odd 5x5x5 assignment into A24", () => {
  const model = createCubeModel(5);
  const wing = model.pieceOrbits.find((orbit) => (
    orbit.kind === "edge" && orbit.pieceIndices.length === 24
  ));
  const from = projectedPattern(model, wing, "2U R' B2 2F D2 L U' F");
  const exactTarget = projectedPattern(model, wing, "F 2R2 U 2F' B R2 D' L2");

  assert.throws(
    () => compileOrbitTarget(model, wing.id, from, exactTarget, { permutationParity: 0 }),
    (error) => error instanceof PatternTargetError && error.code === "no-physical-assignment",
  );

  const partialTarget = [...exactTarget];
  for (const pieceIndex of wing.pieceIndices.slice(0, 2)) {
    for (const stickerIndex of model.pieces[pieceIndex].stickerIndices) {
      partialTarget[stickerIndex] = null;
    }
  }
  const compiled = compileOrbitTarget(model, wing.id, from, partialTarget, {
    permutationParity: 0,
  });
  assert.equal(compiled.permutationParity, 0);
  assert.ok(wing.stickerIndices.every((index) => (
    partialTarget[index] === null || compiled.targetColors[index] === partialTarget[index]
  )));

  const solution = createTwentyFourWingSolver(model).solve(from, compiled.targetColors);
  const actual = model.applyAlgorithm(from, solution.tokens);
  assert.ok(wing.stickerIndices.every((index) => actual[index] === compiled.targetColors[index]));
});

test("individual center stickers may be wildcard constraints", () => {
  const model = createCubeModel(4);
  const center = model.pieceOrbits.find((orbit) => orbit.kind === "center");
  const exact = projectedPattern(model, center, "F' 2L' 2F' 2L F 2L' 2F 2L");
  const partial = [...exact];
  partial[center.stickerIndices[0]] = null;
  const compiled = compileOrbitTarget(model, center.id, model.solvedColors, partial, {
    permutationParity: 0,
  });

  assert.equal(compiled.permutationParity, 0);
  assert.ok(center.stickerIndices.every((index) => (
    partial[index] === null || compiled.targetColors[index] === partial[index]
  )));
});
