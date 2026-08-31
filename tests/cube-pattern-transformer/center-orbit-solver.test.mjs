import assert from "node:assert/strict";
import test from "node:test";

import { createTwentyFourCenterSolver } from "../../public/cube-pattern-transformer/center-orbit-solver.mjs";
import { createCubeModel } from "../../public/cube-pattern-transformer/cube-model.mjs";

const PATTERNS = [
  "R U 2F D' 2R F2",
  "2U' R B2 2F D2 L'",
  "F 2R2 U' 2F' B R2",
];

function centerOrbits(model) {
  return model.pieceOrbits.filter((orbit) => (
    orbit.kind === "center" && orbit.pieceIndices.length === 24
  ));
}

function projectedPattern(model, orbit, algorithm) {
  const moved = model.applyAlgorithm(model.solvedColors, algorithm);
  const pattern = [...model.solvedColors];
  for (const index of orbit.stickerIndices) pattern[index] = moved[index];
  return pattern;
}

test("each 24-center orbit has every directed local 3-cycle", () => {
  for (const size of [4, 5]) {
    const model = createCubeModel(size);
    for (const orbit of centerOrbits(model)) {
      const solver = createTwentyFourCenterSolver(model, orbit.id);
      assert.equal(solver.orbitId, orbit.id);
      assert.equal(solver.databaseSize, 4048);
      assert.equal(solver.localToFullCube, true);
    }
  }
});

test("ambiguous or missing center orbit selection is rejected", () => {
  assert.throws(
    () => createTwentyFourCenterSolver(createCubeModel(3)),
    /必须恰好有一个 24-center orbit/,
  );
  assert.throws(
    () => createTwentyFourCenterSolver(createCubeModel(5)),
    /显式提供 orbitId/,
  );
  assert.throws(
    () => createTwentyFourCenterSolver(createCubeModel(4), "missing"),
    /没有指定的 24-center orbit/,
  );
});

test("solved center patterns require no moves", () => {
  const model = createCubeModel(4);
  const solution = createTwentyFourCenterSolver(model)
    .solve(model.solvedColors, model.solvedColors);
  assert.equal(solution.formula, "");
  assert.deepEqual(solution.triples, []);
  assert.deepEqual(solution.effects, []);
});

test("distinct physical center permutations solve exactly and locally", () => {
  const permutation = Array.from({ length: 24 }, (_unused, index) => index);
  for (const [first, second, third] of [
    [0, 1, 2],
    [3, 4, 5],
    [6, 7, 8],
    [9, 10, 11],
  ]) {
    permutation[first] = second;
    permutation[second] = third;
    permutation[third] = first;
  }

  for (const size of [4, 5]) {
    const model = createCubeModel(size);
    for (const orbit of centerOrbits(model)) {
      const solver = createTwentyFourCenterSolver(model, orbit.id);
      const solution = solver.solvePhysicalPermutation(permutation);

      assert.deepEqual(model.orbitPermutation(orbit.id, solution.tokens), permutation);
      assert.deepEqual(solution.permutation, permutation);
      assert.deepEqual(solution.effects.map((effect) => effect.orbitId), [orbit.id]);
    }
  }
});

test("invalid and odd physical center permutations are rejected", () => {
  const model = createCubeModel(4);
  const solver = createTwentyFourCenterSolver(model);
  assert.throws(() => solver.solvePhysicalPermutation([0]), /必须是 0..23 的双射/);

  const odd = Array.from({ length: 24 }, (_unused, index) => index);
  [odd[0], odd[1]] = [odd[1], odd[0]];
  assert.throws(() => solver.solvePhysicalPermutation(odd), /奇置换/);
});

test("arbitrary source-target center colors solve independently on 4x4x4 and 5x5x5", () => {
  for (const size of [4, 5]) {
    const model = createCubeModel(size);
    for (const orbit of centerOrbits(model)) {
      const solver = createTwentyFourCenterSolver(model, orbit.id);
      const states = PATTERNS.map((algorithm) => projectedPattern(model, orbit, algorithm));
      for (let index = 0; index < states.length; index += 1) {
        const from = states[index];
        const to = states[(index + 1) % states.length];
        const solution = solver.solve(from, to);
        const actual = model.applyAlgorithm(from, solution.tokens);

        assert.deepEqual(actual, to);
        assert.ok(solution.triples.length > 0);
        assert.deepEqual(
          solution.effects.map((effect) => effect.orbitId),
          [orbit.id],
        );
      }
    }
  }
});

test("different source and target center inventories are rejected", () => {
  const model = createCubeModel(5);
  const orbit = centerOrbits(model)[0];
  const target = [...model.solvedColors];
  const index = orbit.stickerIndices[0];
  target[index] = model.colors.find((color) => color !== target[index]);

  assert.throws(
    () => createTwentyFourCenterSolver(model, orbit.id).solve(model.solvedColors, target),
    /颜色库存不同/,
  );
});
