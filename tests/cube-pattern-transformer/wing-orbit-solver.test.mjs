import assert from "node:assert/strict";
import test from "node:test";

import { createCubeModel } from "../../public/cube-pattern-transformer/cube-model.mjs";
import { createTwentyFourWingSolver } from "../../public/cube-pattern-transformer/wing-orbit-solver.mjs";

const WING_CYCLE = "U R U' 2R U R' U' 2R'";
const PATTERNS = [
  WING_CYCLE,
  `F ${WING_CYCLE} F' R ${WING_CYCLE} R'`,
  `U2 ${WING_CYCLE} U2 B' ${WING_CYCLE} B`,
];
const OTHER_COSET_PATTERNS = [
  "2U' R B2 2F D2 L' U F",
  "F 2R2 U' 2F' B R2 D L2",
];

function wingOrbit(model) {
  return model.pieceOrbits.find((orbit) => (
    orbit.kind === "edge" && orbit.pieceIndices.length === 24
  ));
}

function projectedPattern(model, orbit, algorithm) {
  const moved = model.applyAlgorithm(model.solvedColors, algorithm);
  const pattern = [...model.solvedColors];
  for (const index of orbit.stickerIndices) pattern[index] = moved[index];
  return pattern;
}

const fixtures = [4, 5].map((size) => {
  const model = createCubeModel(size);
  return {
    size,
    model,
    orbit: wingOrbit(model),
    solver: createTwentyFourWingSolver(model),
  };
});

test("24-wing databases expose their certified physical permutation groups", () => {
  for (const { size, orbit, solver } of fixtures) {
    assert.equal(solver.orbitId, orbit.id);
    assert.equal(solver.databaseSize, 4048);
    assert.equal(solver.assignmentMethod, "handedness-matching");
    assert.equal(solver.physicalPermutationGroup, size === 4 ? "S24" : "A24");
    assert.equal(solver.oddAssignmentsSupported, size === 4);
    assert.equal(solver.positionGauge.length, 24);
    assert.equal(solver.localToFullCube, true);
  }
});

test("models without a 24-piece wing orbit are rejected", () => {
  assert.throws(() => createTwentyFourWingSolver(createCubeModel(2)), /没有 24-piece wing orbit/);
  assert.throws(() => createTwentyFourWingSolver(createCubeModel(3)), /没有 24-piece wing orbit/);
});

test("solved wing patterns require no moves", () => {
  for (const { model, solver } of fixtures) {
    const solution = solver.solve(model.solvedColors, model.solvedColors);
    assert.equal(solution.formula, "");
    assert.deepEqual(solution.triples, []);
    assert.deepEqual(solution.effects, []);
  }
});

test("source-target patterns in the local wing subgroup solve on 4x4x4 and 5x5x5", () => {
  for (const { model, orbit, solver } of fixtures) {
    const states = PATTERNS.map((algorithm) => projectedPattern(model, orbit, algorithm));
    for (let index = 0; index < states.length; index += 1) {
      const from = states[index];
      const to = states[(index + 1) % states.length];
      const solution = solver.solve(from, to);
      const actual = model.applyAlgorithm(from, solution.tokens);

      assert.deepEqual(actual, to);
      assert.ok(solution.triples.length > 0);
      assert.equal(solution.assignmentParity, 0);
      assert.equal(solution.normalizedAssignmentParity, 0);
      assert.equal(solution.usedOddPrimitive, false);
      assert.equal(solution.forcedPairCount + solution.freePairCount, 12);
      assert.deepEqual(solution.effects.map((effect) => effect.orbitId), [orbit.id]);
    }
  }
});

test("an impossible single flipped wing is rejected before decomposition", () => {
  const { model, orbit, solver } = fixtures[0];
  const state = [...model.solvedColors];
  const piece = model.pieces[orbit.pieceIndices[0]];
  const [first, second] = piece.stickerIndices;
  [state[first], state[second]] = [state[second], state[first]];

  assert.throws(
    () => solver.solve(state, model.solvedColors),
    /wing-handedness-inventory/,
  );
});

test("4x4x4 odd assignments solve through the certified wing-local primitive", () => {
  const { model, orbit, solver } = fixtures[0];
  const [from, to] = OTHER_COSET_PATTERNS
    .map((algorithm) => projectedPattern(model, orbit, algorithm));
  const solution = solver.solve(from, to);

  assert.deepEqual(model.applyAlgorithm(from, solution.tokens), to);
  assert.equal(solution.assignmentParity, 1);
  assert.equal(solution.normalizedAssignmentParity, 0);
  assert.equal(solution.usedOddPrimitive, true);
  assert.deepEqual(solution.effects.map((effect) => effect.orbitId), [orbit.id]);
});

test("5x5x5 odd assignments remain an explicit first-version limitation", () => {
  const { model, orbit, solver } = fixtures[1];
  const [from, to] = OTHER_COSET_PATTERNS
    .map((algorithm) => projectedPattern(model, orbit, algorithm));

  assert.throws(
    () => solver.solve(from, to),
    /超出第一版 A24 local solver 限制.*不表示目标不可达/,
  );
});
