import assert from "node:assert/strict";
import test from "node:test";

import { createCornerOrbitSolver } from "../../public/cube-pattern-transformer/corner-solver.mjs";
import { createCubeModel } from "../../public/cube-pattern-transformer/cube-model.mjs";

const SIZES = [2, 3, 4, 5];
const PATTERNS = [
  "R U F2 L' D",
  "B2 U' R F D2 L",
  "U R2 F' L B D'",
];

function assertCornersEqual(model, actual, expected) {
  const cornerOrbit = model.pieceOrbits.find((orbit) => orbit.kind === "corner");
  assert.ok(cornerOrbit.stickerIndices.every((index) => actual[index] === expected[index]));
}

test("corner coordinate tables cover the complete orbit", () => {
  const solver = createCornerOrbitSolver(createCubeModel(2));
  assert.equal(solver.orbitId, "corner-0");
  assert.equal(solver.moveCount, 18);
  assert.equal(solver.permutationStateCount, 40320);
  assert.equal(solver.orientationStateCount, 2187);
});

test("solved corners require no moves", () => {
  const model = createCubeModel(3);
  const solver = createCornerOrbitSolver(model);
  const solution = solver.solve(model.solvedColors, model.solvedColors);

  assert.equal(solution.formula, "");
  assert.equal(solution.stageDepth, 0);
  assert.deepEqual(solution.effects, []);
});

test("custom corner patterns solve between arbitrary states on every size", () => {
  for (const size of SIZES) {
    const model = createCubeModel(size);
    const solver = createCornerOrbitSolver(model);
    const states = PATTERNS.map((algorithm) => model.applyAlgorithm(model.solvedColors, algorithm));

    for (let index = 0; index < states.length; index += 1) {
      const from = states[index];
      const to = states[(index + 1) % states.length];
      const solution = solver.solve(from, to);
      const actual = model.applyAlgorithm(from, solution.tokens);

      assertCornersEqual(model, actual, to);
      assert.ok(solution.tokens.length > 0);
      assert.ok(solution.searchedNodes > 0);
    }
  }
});

test("the corner stage reports collateral orbit effects explicitly", () => {
  const model2 = createCubeModel(2);
  const solution2 = createCornerOrbitSolver(model2).solve(
    model2.applyAlgorithm(model2.solvedColors, "R U F"),
    model2.solvedColors,
  );
  assert.deepEqual(solution2.effects.map((effect) => effect.orbitId), ["corner-0"]);

  const model5 = createCubeModel(5);
  const solution5 = createCornerOrbitSolver(model5).solve(
    model5.applyAlgorithm(model5.solvedColors, "R U F"),
    model5.solvedColors,
  );
  assert.ok(solution5.effects.some((effect) => effect.orbitId !== "corner-0"));
});

test("impossible corner inputs are rejected before search", () => {
  const model = createCubeModel(4);
  const state = [...model.solvedColors];
  const corner = model.pieces.find((piece) => piece.kind === "corner");
  const [first, second, third] = corner.stickerIndices;
  [state[first], state[second], state[third]] = [state[second], state[third], state[first]];

  const solver = createCornerOrbitSolver(model);
  assert.throws(() => solver.solve(state, model.solvedColors), /corner-orientation-sum/);
});
