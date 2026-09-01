import assert from "node:assert/strict";
import test from "node:test";

import { createCubeModel } from "../../public/cube-pattern-transformer/cube-model.mjs";
import { createTwelveEdgePermutationSolver } from "../../public/cube-pattern-transformer/edge-permutation-solver.mjs";
import {
  OrbitSolverError,
  UNSUPPORTED_ORBIT_SUBGROUP,
} from "../../public/cube-pattern-transformer/orbit-solver-error.mjs";

const UA = "R' U R' U' R' U' R' U R U R2";
const PATTERNS = [
  UA,
  `F ${UA} F' R ${UA} R'`,
  `U2 ${UA} U2 B' ${UA} B`,
];

function twelveEdgeOrbit(model) {
  return model.pieceOrbits.find((orbit) => orbit.kind === "edge" && orbit.pieceIndices.length === 12);
}

function assertOrbitEqual(model, actual, expected) {
  const orbit = twelveEdgeOrbit(model);
  assert.ok(orbit.stickerIndices.every((index) => actual[index] === expected[index]));
}

test("12-edge permutation database covers every directed 3-cycle", () => {
  const solver3 = createTwelveEdgePermutationSolver(createCubeModel(3));
  const solver5 = createTwelveEdgePermutationSolver(createCubeModel(5));

  assert.equal(solver3.databaseSize, 440);
  assert.equal(solver3.actionDatabaseSize, 1760);
  assert.equal(solver3.flipBasisRank, 11);
  assert.equal(solver3.supportsOrientationChanges, true);
  assert.equal(solver3.physicalPermutationGroup, "A12");
  assert.equal(solver3.oddAssignmentsSupported, false);
  assert.equal(solver3.localToFullCube, true);
  assert.equal(solver5.databaseSize, 440);
  assert.equal(solver5.localToFullCube, false);
});

test("models without a 12-piece edge orbit are rejected", () => {
  assert.throws(() => createTwelveEdgePermutationSolver(createCubeModel(2)), /没有 12-piece edge orbit/);
  assert.throws(() => createTwelveEdgePermutationSolver(createCubeModel(4)), /没有 12-piece edge orbit/);
});

test("solved 12-edge patterns require no moves", () => {
  for (const size of [3, 5]) {
    const model = createCubeModel(size);
    const solution = createTwelveEdgePermutationSolver(model)
      .solve(model.solvedColors, model.solvedColors);
    assert.equal(solution.formula, "");
    assert.deepEqual(solution.triples, []);
    assert.deepEqual(solution.effects, []);
  }
});

test("even custom 12-edge permutations solve on 3x3x3 and 5x5x5", () => {
  for (const size of [3, 5]) {
    const model = createCubeModel(size);
    const solver = createTwelveEdgePermutationSolver(model);
    const states = PATTERNS.map((algorithm) => model.applyAlgorithm(model.solvedColors, algorithm));

    for (let index = 0; index < states.length; index += 1) {
      const from = states[index];
      const to = states[(index + 1) % states.length];
      const solution = solver.solve(from, to);
      const actual = model.applyAlgorithm(from, solution.tokens);

      assertOrbitEqual(model, actual, to);
      assert.ok(solution.triples.length > 0);
      if (size === 3) {
        assert.deepEqual(solution.effects.map((effect) => effect.orbitId), ["edge-0"]);
      } else {
        assert.ok(solution.effects.some((effect) => effect.orbitId !== solver.orbitId));
      }
    }
  }
});

test("even edge flips solve while odd permutations report the A12 boundary", () => {
  const model = createCubeModel(3);
  const solver = createTwelveEdgePermutationSolver(model);
  const orbit = twelveEdgeOrbit(model);
  const pieces = orbit.pieceIndices.map((index) => model.pieces[index]);

  const flipped = [...model.solvedColors];
  for (const piece of pieces.slice(0, 2)) {
    const [first, second] = piece.stickerIndices;
    [flipped[first], flipped[second]] = [flipped[second], flipped[first]];
  }
  const flipSolution = solver.solve(flipped, model.solvedColors);
  assertOrbitEqual(
    model,
    model.applyAlgorithm(flipped, flipSolution.tokens),
    model.solvedColors,
  );

  const odd = [...model.solvedColors];
  const [firstPiece, secondPiece] = pieces;
  for (let sticker = 0; sticker < 2; sticker += 1) {
    const first = firstPiece.stickerIndices[sticker];
    const second = secondPiece.stickerIndices[sticker];
    [odd[first], odd[second]] = [odd[second], odd[first]];
  }
  assert.throws(
    () => solver.solve(odd, model.solvedColors),
    (error) => (
      error instanceof OrbitSolverError
      && error.code === UNSUPPORTED_ORBIT_SUBGROUP
      && error.details.implementedGroup === "A12"
      && error.details.requestedParity === 1
    ),
  );
});
