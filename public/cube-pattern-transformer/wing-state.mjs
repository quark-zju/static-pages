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

function requireWingOrbit(model, orbitId) {
  const orbit = model.pieceOrbits.find((candidate) => (
    candidate.kind === "edge"
    && candidate.pieceIndices.length === 24
    && (!orbitId || candidate.id === orbitId)
  ));
  if (!orbit) throw new Error(orbitId ? `模型没有 24-wing orbit：${orbitId}` : "模型没有 24-wing orbit");
  return orbit;
}

function wingStickerCoordinates(model, orbit) {
  const orbitStickerPosition = new Map(
    orbit.stickerIndices.map((stickerIndex, local) => [stickerIndex, local]),
  );
  const localStickerPiece = Array(orbit.stickerIndices.length);
  const localStickerSlot = Array(orbit.stickerIndices.length);
  orbit.pieceIndices.forEach((pieceIndex, pieceLocal) => {
    model.pieces[pieceIndex].stickerIndices.forEach((stickerIndex, slot) => {
      const stickerLocal = orbitStickerPosition.get(stickerIndex);
      localStickerPiece[stickerLocal] = pieceLocal;
      localStickerSlot[stickerLocal] = slot;
    });
  });
  return { orbitStickerPosition, localStickerPiece, localStickerSlot };
}

export function deriveWingPositionGauge(model, orbitId) {
  const orbit = requireWingOrbit(model, orbitId);
  const {
    orbitStickerPosition,
    localStickerPiece,
    localStickerSlot,
  } = wingStickerCoordinates(model, orbit);
  const adjacency = Array.from({ length: 24 }, () => []);
  const generators = ["U", "R", "F"].flatMap((face) => (
    Array.from({ length: model.size }, (_unused, depthIndex) => (
      `${depthIndex === 0 ? "" : depthIndex + 1}${face}`
    ))
  ));

  for (const token of generators) {
    const action = model.orbitPermutation(orbit.id, token);
    orbit.pieceIndices.forEach((pieceIndex, source) => {
      const [firstSticker, secondSticker] = model.pieces[pieceIndex].stickerIndices;
      const firstDestination = action[orbitStickerPosition.get(firstSticker)];
      const secondDestination = action[orbitStickerPosition.get(secondSticker)];
      const destination = localStickerPiece[firstDestination];
      const delta = localStickerSlot[firstDestination];
      if (localStickerPiece[secondDestination] !== destination
          || localStickerSlot[secondDestination] !== 1 - delta) {
        throw new Error(`转动 ${token} 没有保持完整 wing piece`);
      }
      adjacency[source].push({ destination, delta, token });
      adjacency[destination].push({ destination: source, delta, token });
    });
  }

  const gauge = Array(24).fill(null);
  for (let root = 0; root < gauge.length; root += 1) {
    if (gauge[root] !== null) continue;
    gauge[root] = 0;
    const queue = [root];
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const source = queue[cursor];
      for (const { destination, delta, token } of adjacency[source]) {
        const expected = gauge[source] ^ delta;
        if (gauge[destination] === null) {
          gauge[destination] = expected;
          queue.push(destination);
        } else if (gauge[destination] !== expected) {
          throw new Error(`24-wing orientation 不是 position gauge；冲突来自 ${token}`);
        }
      }
    }
  }
  return Object.freeze(gauge);
}

function positionOrientation(position) {
  const orientations = new Set(position.candidates.map((candidate) => candidate.orientation));
  if (orientations.size !== 1 || orientations.has(null)) {
    throw new Error(`wing position ${position.pieceIndex} 没有唯一 visual orientation`);
  }
  return position.candidates[0].orientation;
}

export function matchWingVisualAssignments(model, orbitId, gauge, fromDecoded, toDecoded) {
  const orbit = requireWingOrbit(model, orbitId);
  if (!Array.isArray(gauge) || gauge.length !== 24) throw new Error("24-wing gauge 必须包含 24 个 bit");
  if (fromDecoded.id !== orbit.id || toDecoded.id !== orbit.id) {
    throw new Error("wing visual assignment 使用了错误的 orbit");
  }
  const localPosition = new Map(orbit.pieceIndices.map((pieceIndex, local) => [pieceIndex, local]));
  const describe = (position) => {
    const local = localPosition.get(position.pieceIndex);
    return {
      local,
      handedness: positionOrientation(position) ^ gauge[local],
    };
  };
  const fromGroups = Map.groupBy(fromDecoded.positions, (position) => position.signature);
  const toGroups = Map.groupBy(toDecoded.positions, (position) => position.signature);
  if (fromGroups.size !== toGroups.size) throw new Error("wing 起点与目标 piece 库存不同");

  const relative = Array(24);
  const freeGroups = [];
  let forcedPairCount = 0;
  for (const [signature, fromPositions] of fromGroups) {
    const toPositions = toGroups.get(signature);
    if (!toPositions || fromPositions.length !== 2 || toPositions.length !== 2) {
      throw new Error(`wing signature ${signature} 不是一对 physical pieces`);
    }
    const sources = fromPositions.map(describe);
    const targets = toPositions.map(describe);
    const validOptions = [0, 1].filter((swap) => (
      sources[0].handedness === targets[swap].handedness
      && sources[1].handedness === targets[1 - swap].handedness
    ));
    if (validOptions.length === 0) {
      throw new Error(`wing signature ${signature} 没有 handedness-compatible assignment`);
    }
    const selected = validOptions[0];
    relative[sources[0].local] = targets[selected].local;
    relative[sources[1].local] = targets[1 - selected].local;
    if (validOptions.length === 2) {
      freeGroups.push({ sources, targets, selected });
    } else {
      forcedPairCount += 1;
    }
  }

  if (permutationParity(relative) === 1 && freeGroups.length > 0) {
    const { sources, targets, selected } = freeGroups[0];
    relative[sources[0].local] = targets[1 - selected].local;
    relative[sources[1].local] = targets[selected].local;
  }
  return Object.freeze({
    relative: Object.freeze(relative),
    parity: permutationParity(relative),
    forcedPairCount,
    freePairCount: freeGroups.length,
  });
}
