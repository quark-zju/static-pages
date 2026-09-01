import assert from "node:assert/strict";
import test from "node:test";

import { createCubeModel } from "../../public/cube-pattern-transformer/cube-model.mjs";
import {
  createRestrictedPatternSolver,
  RestrictedPatternSolveError,
} from "../../public/cube-pattern-transformer/pattern-solver.mjs";

const EDGE_CYCLE = "R' U R' U' R' U' R' U R U R2";
const WING_CYCLE = "U' R' U 2R' U' R U 2R";
const CENTER_FIRST = "F' 2L' 2F' 2L F 2L' 2F 2L";
const CENTER_SECOND = "F' 2L' 3F' 2L F 2L' 3F 2L";
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
    assert.ok(capabilities.stages.every((stage) => (
      typeof stage.localToFullCube === "boolean"
    )));
  }
  const five = createRestrictedPatternSolver(createCubeModel(5)).capabilities;
  assert.equal(five.stages.find((stage) => stage.id === "middle-edges").localToFullCube, false);
  assert.equal(five.stages.find((stage) => stage.id === "wings").localToFullCube, true);
  assert.ok(five.limitations.some((limitation) => limitation.includes("stage solver")));
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
    assert.ok(solution.stages.every((stage) => stage.collateralEffects.every((effect) => (
      effect.orbitId !== stage.orbitId
    ))));
  }
});

test("partial target patterns resolve wildcards and replay from the exact source", () => {
  for (const size of [2, 3, 4, 5]) {
    const model = createCubeModel(size);
    const solver = createRestrictedPatternSolver(model);
    const from = model.applyAlgorithm(model.solvedColors, "R U F");
    const exactTarget = model.applyAlgorithm(model.solvedColors, TARGET_ALGORITHMS[size]);
    const pattern = [...exactTarget];
    for (const orbit of model.pieceOrbits) {
      if (solver.capabilities.fixedVisualOrbits.includes(orbit.id)) continue;
      const piece = model.pieces[orbit.pieceIndices[0]];
      for (const stickerIndex of piece.stickerIndices) pattern[stickerIndex] = null;
    }
    const solution = solver.solvePattern(from, pattern);
    const actual = model.applyAlgorithm(from, solution.tokens);

    assert.deepEqual(actual, solution.resolvedTarget);
    assert.ok(pattern.every((constraint, index) => (
      constraint === null || actual[index] === constraint
    )));
    assert.equal(solution.wildcardCount, pattern.filter((value) => value === null).length);
    assert.ok(solution.stages.every((stage) => stage.targetAssignment !== null));
  }
});

test("an all-wildcard pattern keeps the source unchanged", () => {
  const model = createCubeModel(4);
  const solver = createRestrictedPatternSolver(model);
  const from = model.applyAlgorithm(model.solvedColors, "R U 2F L' B");
  const solution = solver.solvePattern(from, Array(model.stickers.length).fill("?"));

  assert.deepEqual(solution.resolvedTarget, from);
  assert.deepEqual(solution.tokens, []);
  assert.equal(solution.wildcardCount, model.stickers.length);
});

test("certified 2x2x2 through 4x4x4 domains solve deterministic legal properties", () => {
  let seed = 0x51a9e;
  const random = () => {
    seed = ((1664525 * seed) + 1013904223) >>> 0;
    return seed;
  };

  for (const size of [2, 3, 4]) {
    const model = createCubeModel(size);
    const solver = createRestrictedPatternSolver(model);
    const depths = size === 3
      ? [1, 3]
      : Array.from({ length: size }, (_unused, index) => index + 1);
    const moves = ["U", "R", "F", "D", "L", "B"].flatMap((face) => (
      depths.flatMap((depth) => ["", "'", "2"].map((suffix) => (
        `${depth === 1 ? "" : depth}${face}${suffix}`
      )))
    ));
    const randomAlgorithm = () => (
      Array.from({ length: 8 }, () => moves[random() % moves.length])
    );

    for (let sample = 0; sample < 8; sample += 1) {
      const from = model.applyAlgorithm(model.solvedColors, randomAlgorithm());
      const to = model.applyAlgorithm(model.solvedColors, randomAlgorithm());
      const solution = solver.solve(from, to);
      assert.deepEqual(model.applyAlgorithm(from, solution.tokens), to);
    }
  }
});

test("the end-to-end 4x4x4 pipeline crosses the odd wing coset locally", () => {
  const model = createCubeModel(4);
  const wing = model.pieceOrbits.find((orbit) => (
    orbit.kind === "edge" && orbit.pieceIndices.length === 24
  ));
  const from = projectedPattern(model, wing, "2U R' B2 2F D2 L U' F");
  const to = projectedPattern(model, wing, "F 2R2 U 2F' B R2 D' L2");
  const solution = createRestrictedPatternSolver(model).solve(from, to);

  assert.deepEqual(model.applyAlgorithm(from, solution.tokens), to);
  const wingStage = solution.stages.find((stage) => stage.id === "wings");
  assert.ok(wingStage.tokens.length > 100);
  assert.deepEqual(wingStage.effects.map((effect) => effect.orbitId), [wing.id]);
});

test("odd 5x5x5 wing targets return a scoped subgroup limitation", () => {
  const model = createCubeModel(5);
  const wing = model.pieceOrbits.find((orbit) => (
    orbit.kind === "edge" && orbit.pieceIndices.length === 24
  ));
  const from = projectedPattern(model, wing, "2U R' B2 2F D2 L U' F");
  const to = projectedPattern(model, wing, "F 2R2 U 2F' B R2 D' L2");

  assert.throws(
    () => createRestrictedPatternSolver(model).solve(from, to),
    (error) => (
      error instanceof RestrictedPatternSolveError
      && error.code === "unsupported-orbit-subgroup"
      && error.stage === "wings"
      && error.cause?.message.includes("不表示目标不可达")
    ),
  );

  const partialTarget = [...to];
  for (const pieceIndex of wing.pieceIndices.slice(0, 2)) {
    for (const stickerIndex of model.pieces[pieceIndex].stickerIndices) {
      partialTarget[stickerIndex] = "?";
    }
  }
  const wildcardSolution = createRestrictedPatternSolver(model)
    .solvePattern(from, partialTarget);
  const actual = model.applyAlgorithm(from, wildcardSolution.tokens);
  assert.deepEqual(actual, wildcardSolution.resolvedTarget);
  assert.ok(partialTarget.every((constraint, index) => (
    constraint === "?" || actual[index] === constraint
  )));
  assert.equal(
    wildcardSolution.stages.find((stage) => stage.id === "wings")
      .targetAssignment.permutationParity,
    0,
  );
});

test("a partial wildcard on a multi-sticker piece is rejected structurally", () => {
  const model = createCubeModel(4);
  const pattern = [...model.solvedColors];
  const corner = model.pieces.find((piece) => piece.kind === "corner");
  pattern[corner.stickerIndices[0]] = null;

  assert.throws(
    () => createRestrictedPatternSolver(model).solvePattern(model.solvedColors, pattern),
    (error) => (
      error instanceof RestrictedPatternSolveError
      && error.code === "invalid-pattern-wildcard"
      && error.stage === "corners"
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
