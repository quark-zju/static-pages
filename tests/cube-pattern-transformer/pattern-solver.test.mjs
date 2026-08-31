import assert from "node:assert/strict";
import test from "node:test";

import { createCubeModel } from "../../public/cube-pattern-transformer/cube-model.mjs";
import {
  createRestrictedPatternSolver,
  RestrictedPatternSolveError,
} from "../../public/cube-pattern-transformer/pattern-solver.mjs";

const EDGE_CYCLE = "R U' R U R U R U' R' U' R2";
const WING_CYCLE = "U R U' 2R U R' U' 2R'";
const CENTER_FIRST = "F' 2L 2F' 2L' F 2L 2F 2L'";
const CENTER_SECOND = "F' 2L 3F' 2L' F 2L 3F 2L'";
const TARGET_ALGORITHMS = {
  2: "L D B",
  3: EDGE_CYCLE,
  4: `${WING_CYCLE} ${CENTER_FIRST}`,
  5: `${EDGE_CYCLE} ${WING_CYCLE} ${CENTER_FIRST} ${CENTER_SECOND}`,
};

function projectedPattern(model, orbit, algorithm) {
  const moved = model.applyAlgorithm(model.solvedColors, algorithm);
  const pattern = [...model.solvedColors];
  for (const index of orbit.stickerIndices) pattern[index] = moved[index];
  return pattern;
}

test("restricted capabilities expose the exact 2x2x2 through 5x5x5 stage order", () => {
  const expected = {
    2: ["corners"],
    3: ["corners", "middle-edges"],
    4: ["corners", "wings", "centers:center-0"],
    5: [
      "corners",
      "middle-edges",
      "wings",
      "centers:center-1",
      "centers:center-2",
    ],
  };
  for (const size of [2, 3, 4, 5]) {
    const capabilities = createRestrictedPatternSolver(createCubeModel(size)).capabilities;
    assert.equal(capabilities.mode, "restricted-orbit-local-v1");
    assert.equal(capabilities.size, size);
    assert.deepEqual(capabilities.stages.map((stage) => stage.id), expected[size]);
    assert.deepEqual(
      capabilities.fixedVisualOrbits,
      size % 2 === 1 ? ["center-0"] : [],
    );
  }
});

test("the restricted pipeline solves nontrivial arbitrary source-target patterns on every size", () => {
  for (const size of [2, 3, 4, 5]) {
    const model = createCubeModel(size);
    const solver = createRestrictedPatternSolver(model);
    const from = model.applyAlgorithm(model.solvedColors, "R U F");
    const to = model.applyAlgorithm(model.solvedColors, TARGET_ALGORITHMS[size]);
    const solution = solver.solve(from, to);

    assert.deepEqual(model.applyAlgorithm(from, solution.tokens), to);
    assert.equal(solution.formula, solution.tokens.join(" "));
    assert.deepEqual(
      solution.stages.map((stage) => stage.id),
      solver.capabilities.stages.map((stage) => stage.id),
    );
    assert.ok(solution.stages.some((stage) => stage.tokens.length > 0));
  }
});

test("odd 5x5x5 wing targets return a scoped subgroup limitation", () => {
  const model = createCubeModel(5);
  const wing = model.pieceOrbits.find((orbit) => (
    orbit.kind === "edge" && orbit.pieceIndices.length === 24
  ));
  const from = projectedPattern(model, wing, "2U' R B2 2F D2 L' U F");
  const to = projectedPattern(model, wing, "F 2R2 U' 2F' B R2 D L2");

  assert.throws(
    () => createRestrictedPatternSolver(model).solve(from, to),
    (error) => (
      error instanceof RestrictedPatternSolveError
      && error.code === "unsupported-orbit-subgroup"
      && error.stage === "wings"
      && error.cause?.message.includes("不表示目标不可达")
    ),
  );
});

test("odd-cube fixed-center visual changes are an explicit first-version boundary", () => {
  for (const size of [3, 5]) {
    const model = createCubeModel(size);
    const fixedCenters = model.pieceOrbits.find((orbit) => (
      orbit.kind === "center" && orbit.pieceIndices.length === 6
    ));
    const target = [...model.solvedColors];
    const [first, second] = fixedCenters.stickerIndices;
    [target[first], target[second]] = [target[second], target[first]];

    assert.throws(
      () => createRestrictedPatternSolver(model).solve(model.solvedColors, target),
      (error) => (
        error instanceof RestrictedPatternSolveError
        && error.code === "unsupported-fixed-center-target"
        && error.details.orbitId === fixedCenters.id
      ),
    );
  }
});

test("invalid endpoints fail before any stage solver runs", () => {
  const model = createCubeModel(4);
  const source = [...model.solvedColors];
  const corner = model.pieces.find((piece) => piece.kind === "corner");
  const [first, second, third] = corner.stickerIndices;
  [source[first], source[second], source[third]] = [
    source[second],
    source[third],
    source[first],
  ];

  assert.throws(
    () => createRestrictedPatternSolver(model).solve(source, model.solvedColors),
    (error) => (
      error instanceof RestrictedPatternSolveError
      && error.code === "invalid-source-state"
      && error.details.some((detail) => detail.code === "corner-orientation-sum")
    ),
  );
});
