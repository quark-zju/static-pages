function signature(values) {
  return [...values].sort().join("|");
}

function determinant([a, b, c]) {
  return (
    a[0] * ((b[1] * c[2]) - (b[2] * c[1]))
    - a[1] * ((b[0] * c[2]) - (b[2] * c[0]))
    + a[2] * ((b[0] * c[1]) - (b[1] * c[0]))
  );
}

function permutationsOfThree(values) {
  const [a, b, c] = values;
  return [
    [a, b, c],
    [a, c, b],
    [b, a, c],
    [b, c, a],
    [c, a, b],
    [c, b, a],
  ];
}

function orderedStickerIndices(model, piece) {
  if (piece.kind !== "corner") return [...piece.stickerIndices];
  return permutationsOfThree(piece.stickerIndices)
    .find((indices) => determinant(indices.map((index) => model.stickers[index].normal)) === 1);
}

function orientationOf(expected, actual) {
  for (let orientation = 0; orientation < expected.length; orientation += 1) {
    if (actual.every((value, index) => value === expected[(index + orientation) % expected.length])) {
      return orientation;
    }
  }
  return null;
}

function countBySignature(entries) {
  const counts = new Map();
  for (const entry of entries) counts.set(entry.signature, (counts.get(entry.signature) ?? 0) + 1);
  return counts;
}

function permutationParity(permutation) {
  const visited = new Set();
  let transpositions = 0;
  for (let start = 0; start < permutation.length; start += 1) {
    if (visited.has(start)) continue;
    let length = 0;
    let current = start;
    while (!visited.has(current)) {
      visited.add(current);
      length += 1;
      current = permutation[current];
    }
    transpositions += Math.max(0, length - 1);
  }
  return transpositions % 2;
}

function inventoryErrors(orbitId, expectedEntries, actualEntries) {
  const expected = countBySignature(expectedEntries);
  const actual = countBySignature(actualEntries);
  const signatures = new Set([...expected.keys(), ...actual.keys()]);
  return [...signatures].flatMap((pieceSignature) => {
    const expectedCount = expected.get(pieceSignature) ?? 0;
    const actualCount = actual.get(pieceSignature) ?? 0;
    return expectedCount === actualCount
      ? []
      : [{
        code: "piece-inventory",
        orbitId,
        signature: pieceSignature,
        expectedCount,
        actualCount,
      }];
  });
}

function validateStateShape(model, state) {
  if (!Array.isArray(state) || state.length !== model.stickers.length) {
    return [{
      code: "sticker-count",
      expectedCount: model.stickers.length,
      actualCount: Array.isArray(state) ? state.length : null,
    }];
  }
  const allowed = new Set(model.colors);
  const invalid = [...new Set(state.filter((color) => !allowed.has(color)))];
  return invalid.length === 0 ? [] : [{ code: "unknown-color", colors: invalid }];
}

export function analyzePieceState(model, state) {
  const shapeErrors = validateStateShape(model, state);
  if (shapeErrors.length > 0) {
    return Object.freeze({ valid: false, errors: Object.freeze(shapeErrors), orbits: Object.freeze([]) });
  }

  const errors = [];
  const orbits = model.pieceOrbits.map((orbit) => {
    const expectedEntries = orbit.pieceIndices.map((pieceIndex) => {
      const piece = model.pieces[pieceIndex];
      const stickerIndices = orderedStickerIndices(model, piece);
      const colors = stickerIndices.map((index) => model.solvedColors[index]);
      return { pieceIndex, stickerIndices, colors, signature: signature(colors) };
    });
    const candidatesBySignature = Map.groupBy(expectedEntries, (entry) => entry.signature);
    const positions = orbit.pieceIndices.map((pieceIndex) => {
      const piece = model.pieces[pieceIndex];
      const stickerIndices = orderedStickerIndices(model, piece);
      const colors = stickerIndices.map((index) => state[index]);
      const pieceSignature = signature(colors);
      const candidates = candidatesBySignature.get(pieceSignature) ?? [];
      const orientations = candidates.map((candidate) => ({
        pieceIndex: candidate.pieceIndex,
        orientation: orientationOf(candidate.colors, colors),
      }));
      return Object.freeze({
        pieceIndex,
        stickerIndices: Object.freeze(stickerIndices),
        colors: Object.freeze(colors),
        signature: pieceSignature,
        candidates: Object.freeze(orientations),
      });
    });

    const orbitErrors = inventoryErrors(orbit.id, expectedEntries, positions);
    for (const position of positions) {
      if (position.candidates.length > 0 && position.candidates.every((entry) => entry.orientation === null)) {
        orbitErrors.push({
          code: "mirrored-piece",
          orbitId: orbit.id,
          pieceIndex: position.pieceIndex,
          signature: position.signature,
        });
      }
    }
    if (orbit.kind === "corner" && orbitErrors.length === 0) {
      const orientationSum = positions.reduce(
        (sum, position) => sum + position.candidates[0].orientation,
        0,
      );
      if (orientationSum % 3 !== 0) {
        orbitErrors.push({
          code: "corner-orientation-sum",
          orbitId: orbit.id,
          remainder: orientationSum % 3,
        });
      }
    }
    if (orbit.kind === "edge" && orbitErrors.length === 0) {
      const orientationSum = positions.reduce(
        (sum, position) => sum + position.candidates[0].orientation,
        0,
      );
      if (orientationSum % 2 !== 0) {
        orbitErrors.push({
          code: "edge-orientation-sum",
          orbitId: orbit.id,
          remainder: orientationSum % 2,
        });
      }
    }
    const localPieceIndex = new Map(
      orbit.pieceIndices.map((pieceIndex, local) => [pieceIndex, local]),
    );
    const uniquePermutation = positions.every((position) => position.candidates.length === 1)
      ? positions.map((position) => localPieceIndex.get(position.candidates[0].pieceIndex))
      : null;
    errors.push(...orbitErrors);
    return Object.freeze({
      id: orbit.id,
      kind: orbit.kind,
      valid: orbitErrors.length === 0,
      permutationParity: uniquePermutation ? permutationParity(uniquePermutation) : null,
      positions: Object.freeze(positions),
      errors: Object.freeze(orbitErrors),
    });
  });

  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze(errors),
    orbits: Object.freeze(orbits),
  });
}

export function assertValidPieceState(model, state) {
  const analysis = analyzePieceState(model, state);
  if (!analysis.valid) {
    const codes = [...new Set(analysis.errors.map((error) => error.code))].join(", ");
    throw new Error(`贴纸状态不是合法的块库存或 orientation：${codes}`);
  }
  return analysis;
}
