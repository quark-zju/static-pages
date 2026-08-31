import {
  analyzePieceState,
  orderedPieceStickerIndices,
} from "./piece-state.mjs";
import { deriveWingPositionGauge } from "./wing-state.mjs";

export class PatternTargetError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = "PatternTargetError";
    this.code = code;
    this.details = details;
  }
}

export function normalizeTargetPattern(model, pattern) {
  if (!Array.isArray(pattern) || pattern.length !== model.stickers.length) {
    throw new PatternTargetError(
      "invalid-pattern-shape",
      `target pattern 必须包含 ${model.stickers.length} 个贴纸约束`,
    );
  }
  const allowed = new Set(model.colors);
  return Object.freeze(pattern.map((value, index) => {
    if (value === null || value === "?") return null;
    if (!allowed.has(value)) {
      throw new PatternTargetError(
        "unknown-pattern-color",
        `target pattern 的第 ${index} 枚贴纸颜色无效：${value}`,
        { index, value },
      );
    }
    return value;
  }));
}

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

function rotated(values, orientation) {
  return values.map((_value, index) => values[(index + orientation) % values.length]);
}

function matchesConstraints(colors, stickerIndices, pattern) {
  return stickerIndices.every((stickerIndex, slot) => (
    pattern[stickerIndex] === null || pattern[stickerIndex] === colors[slot]
  ));
}

function requireWholePieceWildcards(model, orbit, pattern) {
  for (const pieceIndex of orbit.pieceIndices) {
    const piece = model.pieces[pieceIndex];
    if (piece.stickerIndices.length === 1) continue;
    const wildcardCount = piece.stickerIndices
      .filter((stickerIndex) => pattern[stickerIndex] === null)
      .length;
    if (wildcardCount !== 0 && wildcardCount !== piece.stickerIndices.length) {
      throw new PatternTargetError(
        "partial-piece-wildcard",
        `${orbit.id} 的 corner/edge/wing 必须整块设为 wildcard`,
        { orbitId: orbit.id, pieceIndex },
      );
    }
  }
}

function sourceIdentityPieceIndices(model, orbit, currentColors, decoded) {
  if (orbit.kind === "center") return orbit.pieceIndices.map((_pieceIndex, local) => local);
  if (orbit.kind !== "edge" || orbit.pieceIndices.length !== 24) {
    return decoded.positions.map((position) => {
      if (position.candidates.length !== 1) {
        throw new PatternTargetError(
          "ambiguous-source-identity",
          `${orbit.id} 无法从 current state 确定 physical identity`,
        );
      }
      return position.candidates[0].pieceIndex;
    });
  }

  const gauge = deriveWingPositionGauge(model, orbit.id);
  const identityLocal = new Map(
    orbit.pieceIndices.map((pieceIndex, local) => [pieceIndex, local]),
  );
  return decoded.positions.map((position, source) => {
    const orientations = new Set(
      position.candidates.map((candidate) => candidate.orientation),
    );
    if (orientations.size !== 1 || orientations.has(null)) {
      throw new PatternTargetError(
        "ambiguous-wing-orientation",
        `${orbit.id} source wing 没有唯一 visual orientation`,
      );
    }
    const handedness = [...orientations][0] ^ gauge[source];
    const identities = position.candidates.filter((candidate) => (
      gauge[identityLocal.get(candidate.pieceIndex)] === handedness
    ));
    if (identities.length !== 1) {
      throw new PatternTargetError(
        "ambiguous-source-identity",
        `${orbit.id} 无法用 handedness 确定 source wing identity`,
      );
    }
    return identities[0].pieceIndex;
  });
}

function variantsFor(model, orbit, currentColors, sourceIdentity, source, target, gauge) {
  const targetPiece = model.pieces[orbit.pieceIndices[target]];
  const targetStickers = orderedPieceStickerIndices(model, targetPiece);
  if (orbit.kind === "center") {
    const sourcePiece = model.pieces[orbit.pieceIndices[source]];
    return [{
      source,
      colors: [currentColors[sourcePiece.stickerIndices[0]]],
      orientation: 0,
      targetStickers,
    }];
  }

  const identityPiece = model.pieces[sourceIdentity];
  const homeStickers = orderedPieceStickerIndices(model, identityPiece);
  const homeColors = homeStickers.map((stickerIndex) => model.solvedColors[stickerIndex]);
  let orientations;
  if (orbit.kind === "edge" && orbit.pieceIndices.length === 24) {
    const identityLocal = orbit.pieceIndices.indexOf(sourceIdentity);
    orientations = [gauge[identityLocal] ^ gauge[target]];
  } else {
    orientations = Array.from({ length: homeColors.length }, (_unused, index) => index);
  }
  return orientations.map((orientation) => ({
    source,
    colors: rotated(homeColors, orientation),
    orientation,
    targetStickers,
  }));
}

export function compileOrbitTarget(model, orbitId, currentColors, rawPattern, options = {}) {
  const orbit = model.pieceOrbits.find((candidate) => candidate.id === orbitId);
  if (!orbit) throw new PatternTargetError("unknown-orbit", `未知 target orbit：${orbitId}`);
  const pattern = normalizeTargetPattern(model, rawPattern);
  requireWholePieceWildcards(model, orbit, pattern);
  const analysis = analyzePieceState(model, currentColors);
  const decoded = analysis.orbits.find((candidate) => candidate.id === orbit.id);
  if (!decoded?.valid) {
    throw new PatternTargetError(
      "invalid-current-orbit",
      `${orbit.id} current state 没有合法 physical assignment`,
      decoded?.errors ?? [],
    );
  }

  const size = orbit.pieceIndices.length;
  const sourceIdentities = sourceIdentityPieceIndices(model, orbit, currentColors, decoded);
  const gauge = orbit.kind === "edge" && size === 24
    ? deriveWingPositionGauge(model, orbit.id)
    : null;
  const candidatesByTarget = Array.from({ length: size }, (_unused, target) => {
    const currentPiece = model.pieces[orbit.pieceIndices[target]];
    const currentStickers = orderedPieceStickerIndices(model, currentPiece);
    const currentPositionColors = currentStickers.map((index) => currentColors[index]);
    const candidates = [];
    for (let source = 0; source < size; source += 1) {
      for (const candidate of variantsFor(
        model,
        orbit,
        currentColors,
        sourceIdentities[source],
        source,
        target,
        gauge,
      )) {
        if (matchesConstraints(candidate.colors, candidate.targetStickers, pattern)) {
          const keepsCurrent = candidate.colors.every((color, slot) => (
            color === currentPositionColors[slot]
          ));
          candidates.push({ ...candidate, keepsCurrent });
        }
      }
    }
    candidates.sort((first, second) => (
      Number(second.source === target) - Number(first.source === target)
      || Number(second.keepsCurrent) - Number(first.keepsCurrent)
      || first.source - second.source
      || first.orientation - second.orientation
    ));
    if (candidates.length === 0) {
      throw new PatternTargetError(
        "no-position-candidate",
        `${orbit.id} position ${target} 没有满足颜色约束的 physical piece`,
        { orbitId: orbit.id, target },
      );
    }
    return candidates;
  });

  const targetOrder = Array.from({ length: size }, (_unused, index) => index)
    .sort((first, second) => (
      candidatesByTarget[first].length - candidatesByTarget[second].length
      || first - second
    ));
  const orientationModulus = orbit.kind === "corner"
    ? 3
    : orbit.kind === "edge" && size === 12 ? 2 : 1;
  const desiredParity = options.permutationParity ?? null;
  const usedSources = Array(size).fill(false);
  const assignmentByTarget = Array(size);
  let assignmentNodes = 0;
  let solution = null;

  function search(depth, orientationSum) {
    assignmentNodes += 1;
    if (depth === targetOrder.length) {
      if (orientationSum % orientationModulus !== 0) return false;
      const sourceToTarget = Array(size);
      assignmentByTarget.forEach((candidate, target) => {
        sourceToTarget[candidate.source] = target;
      });
      const parity = permutationParity(sourceToTarget);
      if (desiredParity !== null && parity !== desiredParity) return false;
      solution = {
        assignmentByTarget: [...assignmentByTarget],
        sourceToTarget,
        parity,
        orientationSum: orientationSum % orientationModulus,
      };
      return true;
    }
    const target = targetOrder[depth];
    for (const candidate of candidatesByTarget[target]) {
      if (usedSources[candidate.source]) continue;
      usedSources[candidate.source] = true;
      assignmentByTarget[target] = candidate;
      if (search(
        depth + 1,
        (orientationSum + candidate.orientation) % orientationModulus,
      )) return true;
      usedSources[candidate.source] = false;
    }
    assignmentByTarget[target] = undefined;
    return false;
  }

  if (!search(0, 0)) {
    throw new PatternTargetError(
      "no-physical-assignment",
      `${orbit.id} 不存在满足 wildcard、orientation 与 parity 约束的 physical assignment`,
      { orbitId: orbit.id, desiredParity, assignmentNodes },
    );
  }

  const targetColors = [...currentColors];
  solution.assignmentByTarget.forEach((candidate) => {
    candidate.targetStickers.forEach((stickerIndex, slot) => {
      targetColors[stickerIndex] = candidate.colors[slot];
    });
  });
  return Object.freeze({
    orbitId: orbit.id,
    targetColors: Object.freeze(targetColors),
    sourceToTarget: Object.freeze(solution.sourceToTarget),
    permutationParity: solution.parity,
    orientationSum: solution.orientationSum,
    assignmentNodes,
  });
}
