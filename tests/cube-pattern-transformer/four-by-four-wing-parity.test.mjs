import assert from "node:assert/strict";
import test from "node:test";

import { createCubeModel } from "../../public/cube-pattern-transformer/cube-model.mjs";
import {
  createFourByFourOddWingPrimitive,
} from "../../public/cube-pattern-transformer/four-by-four-wing-parity.mjs";

function permutationParity(permutation) {
  const visited = new Set();
  let parity = 0;
  for (let start = 0; start < permutation.length; start += 1) {
    if (visited.has(start)) continue;
    let length = 0;
    let current = start;
    while (!visited.has(current)) {
      visited.add(current);
      length += 1;
      current = permutation[current];
    }
    parity ^= (length - 1) & 1;
  }
  return parity;
}

test("the odd primitive is certified against every full-cube sticker", () => {
  const model = createCubeModel(4);
  const primitive = createFourByFourOddWingPrimitive(model);
  const wing = model.pieceOrbits.find((orbit) => orbit.id === primitive.orbitId);
  const center = model.pieceOrbits.find((orbit) => (
    orbit.kind === "center" && orbit.pieceIndices.length === 24
  ));
  const wingStickers = new Set(wing.stickerIndices);
  const fullAction = model.algorithmPermutation(primitive.tokens);

  assert.equal(primitive.parity, 1);
  assert.equal(permutationParity(primitive.physicalPermutation), 1);
  assert.equal(new Set(primitive.physicalPermutation).size, 24);
  assert.equal(primitive.movedPieceCount, 7);
  assert.equal(primitive.centerRepairMoveCount, 108);
  assert.deepEqual(primitive.effects, [{
    orbitId: wing.id,
    kind: "edge",
    movedStickerCount: 14,
  }]);
  assert.ok(fullAction.every((destination, source) => (
    wingStickers.has(source) || destination === source
  )));
  assert.ok(model.orbitPermutation(center.id, primitive.tokens)
    .every((destination, source) => destination === source));
});

test("the inverse odd primitive remains exactly wing-local", () => {
  const model = createCubeModel(4);
  const primitive = createFourByFourOddWingPrimitive(model);
  const inverse = model.invertAlgorithm(primitive.tokens);

  assert.deepEqual(model.algorithmOrbitEffects(inverse), primitive.effects);
  const combined = [...primitive.tokens, ...inverse];
  assert.ok(model.algorithmPermutation(combined)
    .every((destination, source) => destination === source));
});

test("the odd primitive refuses uncertified puzzle sizes", () => {
  for (const size of [2, 3, 5]) {
    assert.throws(
      () => createFourByFourOddWingPrimitive(createCubeModel(size)),
      /当前只为 4x4x4 建立证书/,
    );
  }
});
