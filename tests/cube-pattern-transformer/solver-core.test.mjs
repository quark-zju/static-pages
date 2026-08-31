import assert from "node:assert/strict";
import test from "node:test";

import {
  createCenterOrbitSolver,
  cube4x4CenterModel,
  validateCenterColors,
} from "../../public/cube-pattern-transformer/solver-core.mjs";

const solver = createCenterOrbitSolver();
const { editableIndices, solvedColors } = cube4x4CenterModel;

test("the local generator database covers every directed center 3-cycle", () => {
  assert.equal(solver.databaseSize, 4048);
});

test("the solved pattern requires no moves", () => {
  const solution = solver.solve(solvedColors, solvedColors);
  assert.equal(solution.formula, "");
  assert.equal(solution.triples.length, 0);
  assert.equal(solution.fixedNonCenterCount, 72);
});

test("the bundled example solves to the requested full sticker state", () => {
  const target = solver.centerPatternAfterAlgorithm("R U 2F D' 2R F2");
  const solution = solver.solve(solvedColors, target);
  const actual = solver.applyAlgorithm(solvedColors, solution.formula);

  assert.deepEqual(actual, target);
  assert.ok(solution.triples.length > 0);
});

test("multiple start and target patterns solve through the public API", () => {
  const algorithms = [
    "U 2R F2 D' 2F",
    "2U' R B2 2F D2 L'",
    "F 2R2 U' 2F' B R2",
    "D 2U R' 2R F2 U2",
    "L2 2F U B' 2R' D",
  ];
  const patterns = algorithms.map((algorithm) => solver.centerPatternAfterAlgorithm(algorithm));

  for (let index = 0; index < patterns.length; index += 1) {
    const from = patterns[index];
    const to = patterns[(index + 1) % patterns.length];
    const solution = solver.solve(from, to);
    assert.deepEqual(solver.applyAlgorithm(from, solution.formula), to);
  }
});

test("invalid sticker input is rejected before solving", () => {
  const invalid = [...solvedColors];
  invalid[editableIndices[0]] = invalid[editableIndices[4]];

  assert.equal(validateCenterColors(invalid).valid, false);
  assert.throws(() => solver.solve(solvedColors, invalid), /每种颜色必须各有 4 个中心贴纸/);
  assert.equal(validateCenterColors(["white"]).valid, false);
});
