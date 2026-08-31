import assert from "node:assert/strict";
import test from "node:test";

import { createCubeModel } from "../../public/cube-pattern-transformer/cube-model.mjs";

const SIZES = [2, 3, 4, 5];
const FACES = ["U", "R", "F", "D", "L", "B"];

function labeledState(model) {
  return model.stickers.map((_sticker, index) => index);
}

test("models 2x2x2 through 5x5x5 surface geometry", () => {
  for (const size of SIZES) {
    const model = createCubeModel(size);
    const expectedPieces = (size ** 3) - ((size - 2) ** 3);
    const kinds = Object.groupBy(model.pieces, (piece) => piece.kind);

    assert.equal(model.stickers.length, 6 * size * size);
    assert.equal(model.solvedColors.length, model.stickers.length);
    assert.equal(model.pieces.length, expectedPieces);
    assert.equal(kinds.corner.length, 8);
    assert.equal(kinds.edge?.length ?? 0, 12 * (size - 2));
    assert.equal(kinds.center?.length ?? 0, 6 * ((size - 2) ** 2));
  }
});

test("every supported single-layer move is a sticker bijection", () => {
  for (const size of SIZES) {
    const model = createCubeModel(size);
    for (const face of FACES) {
      for (let depth = 1; depth <= size; depth += 1) {
        const prefix = depth === 1 ? "" : depth;
        for (const suffix of ["", "'", "2"]) {
          const permutation = model.movePermutation(`${prefix}${face}${suffix}`);
          assert.equal(new Set(permutation).size, model.stickers.length);
          assert.ok(permutation.every((destination) => (
            Number.isInteger(destination)
            && destination >= 0
            && destination < model.stickers.length
          )));
        }
      }
    }
  }
});

test("algorithms followed by their inverses restore every sticker", () => {
  for (const size of SIZES) {
    const model = createCubeModel(size);
    const deepest = size === 2 ? 2 : size - 1;
    const algorithm = ["R", "U'", "F2", `${deepest}L`, "D", `${deepest}B'`];
    const inverse = model.invertAlgorithm(algorithm);
    const initial = labeledState(model);
    const moved = model.applyAlgorithm(initial, algorithm);

    assert.deepEqual(model.applyAlgorithm(moved, inverse), initial);
  }
});

test("four quarter turns restore every layer on every size", () => {
  for (const size of SIZES) {
    const model = createCubeModel(size);
    const initial = labeledState(model);
    for (const face of FACES) {
      for (let depth = 1; depth <= size; depth += 1) {
        const token = `${depth === 1 ? "" : depth}${face}`;
        assert.deepEqual(model.applyAlgorithm(initial, [token, token, token, token]), initial);
      }
    }
  }
});

test("model rejects unsupported sizes, notation, and state lengths", () => {
  assert.throws(() => createCubeModel(1), /2 到 5/);
  assert.throws(() => createCubeModel(6), /2 到 5/);
  assert.throws(() => createCubeModel(3.5), /2 到 5/);

  const model = createCubeModel(3);
  assert.throws(() => model.movePermutation("4R"), /不支持的转动/);
  assert.throws(() => model.movePermutation("Rw"), /不支持的转动/);
  assert.throws(() => model.applyAlgorithm([0], "R"), /54 个贴纸/);
});
