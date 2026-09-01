import assert from "node:assert/strict";
import test from "node:test";

import { createCubeModel } from "../../public/cube-pattern-transformer/cube-model.mjs";

const SIZES = [2, 3, 4, 5];
const FACES = ["U", "R", "F", "D", "L", "B"];
const CLOCKWISE_ADJACENT_FACE = Object.freeze({
  U: ["F", "L"],
  D: ["F", "R"],
  R: ["U", "B"],
  L: ["U", "F"],
  F: ["U", "R"],
  B: ["U", "L"],
});

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

test("piece orbits match the 2x2x2 through 5x5x5 decomposition", () => {
  const expected = {
    2: { corner: [8] },
    3: { center: [6], corner: [8], edge: [12] },
    4: { center: [24], corner: [8], edge: [24] },
    5: { center: [6, 24, 24], corner: [8], edge: [12, 24] },
  };

  for (const size of SIZES) {
    const model = createCubeModel(size);
    const actual = Object.groupBy(model.pieceOrbits, (orbit) => orbit.kind);
    const actualSizes = Object.fromEntries(
      Object.entries(actual).map(([kind, orbits]) => [
        kind,
        orbits.map((orbit) => orbit.pieceIndices.length).sort((a, b) => a - b),
      ]),
    );
    const memberships = model.pieceOrbits.flatMap((orbit) => orbit.pieceIndices);

    assert.deepEqual(actualSizes, expected[size]);
    assert.deepEqual([...memberships].sort((a, b) => a - b), model.pieces.map((_piece, index) => index));
    assert.equal(new Set(memberships).size, model.pieces.length);
  }
});

test("every move keeps each piece inside its derived orbit", () => {
  for (const size of SIZES) {
    const model = createCubeModel(size);
    const pieceIndex = new Map(model.pieces.map((piece, index) => [piece.key, index]));
    for (const face of FACES) {
      for (let depth = 1; depth <= size; depth += 1) {
        const token = `${depth === 1 ? "" : depth}${face}`;
        const permutation = model.movePermutation(token);
        model.pieces.forEach((piece, sourceIndex) => {
          const destinationSticker = model.stickers[permutation[piece.stickerIndices[0]]];
          const destinationIndex = pieceIndex.get(destinationSticker.position.join(","));
          assert.equal(model.orbitByPieceIndex[destinationIndex], model.orbitByPieceIndex[sourceIndex]);
        });
      }
    }
  }
});

test("face turns follow the standard clockwise Singmaster convention", () => {
  const model = createCubeModel(5);
  for (const [face, [sourceFace, destinationFace]] of Object.entries(CLOCKWISE_ADJACENT_FACE)) {
    for (const depth of [1, 2]) {
      const token = `${depth === 1 ? "" : depth}${face}`;
      const permutation = model.movePermutation(token);
      const axis = face === "U" || face === "D" ? 1 : face === "R" || face === "L" ? 0 : 2;
      const layer = ["D", "L", "B"].includes(face) ? depth - 1 : model.size - depth;
      const source = model.stickers.findIndex((sticker) => (
        sticker.face === sourceFace && sticker.position[axis] === layer
      ));
      assert.notEqual(source, -1, `${token} 缺少 ${sourceFace} strip 测试贴纸`);
      assert.equal(
        model.stickers[permutation[source]].face,
        destinationFace,
        `${token} 应把 ${sourceFace} strip 转到 ${destinationFace}`,
      );
    }
  }
});

test("orbit projections retain orientation and remain bijective", () => {
  for (const size of SIZES) {
    const model = createCubeModel(size);
    const algorithm = size === 2 ? "R U F2" : `R U 2F' ${size}L2 D`;
    for (const orbit of model.pieceOrbits) {
      const permutation = model.orbitPermutation(orbit.id, algorithm);
      assert.equal(permutation.length, orbit.stickerIndices.length);
      assert.equal(new Set(permutation).size, permutation.length);
    }
  }
});

test("the 4x4 center commutator is proven local against the full cube", () => {
  const model = createCubeModel(4);
  const commutator = "F' 2L' 2F' 2L F 2L' 2F 2L";

  assert.deepEqual(model.algorithmOrbitEffects(commutator), [
    { orbitId: "center-0", kind: "center", movedStickerCount: 3 },
  ]);
  assert.equal(model.isOrbitLocalAlgorithm("center-0", commutator), true);
  assert.equal(model.isOrbitLocalAlgorithm("edge-0", commutator), false);
  assert.throws(() => model.orbitPermutation("missing", "R"), /未知的块 orbit/);
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
