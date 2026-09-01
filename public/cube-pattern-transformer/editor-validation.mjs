import { compileOrbitTarget, PatternTargetError } from "./pattern-target.mjs";
import { analyzePieceState } from "./piece-state.mjs";

export function validateEditorState(model, colors, stateName) {
  if (!model || colors.length !== model.stickers.length) {
    return { valid: false, invalid: [], reason: "shape" };
  }
  const counts = Object.fromEntries(model.colors.map((color) => [color, 0]));
  let wildcardCount = 0;
  for (const color of colors) {
    if (color === null) {
      wildcardCount += 1;
      continue;
    }
    if (!(color in counts)) return { valid: false, invalid: [color], reason: "color" };
    counts[color] += 1;
  }
  const expected = model.size ** 2;
  if (stateName === "source" && wildcardCount > 0) {
    return { valid: false, invalid: [], wildcardCount, reason: "source-wildcard" };
  }
  const partialPiece = model.pieces.find((piece) => {
    if (piece.stickerIndices.length === 1) return false;
    const pieceWildcards = piece.stickerIndices.filter((index) => colors[index] === null).length;
    return pieceWildcards > 0 && pieceWildcards < piece.stickerIndices.length;
  });
  if (partialPiece) {
    return { valid: false, invalid: [], wildcardCount, reason: "partial-piece" };
  }
  const invalid = model.colors.filter((color) => (
    wildcardCount > 0 ? counts[color] > expected : counts[color] !== expected
  ));
  if (invalid.length > 0) return { valid: false, invalid, wildcardCount, reason: "count" };

  if (wildcardCount === 0) {
    const analysis = analyzePieceState(model, colors);
    if (!analysis.valid) {
      return {
        valid: false,
        invalid: [],
        wildcardCount,
        reason: "physical-state",
        details: analysis.errors,
      };
    }
  } else {
    try {
      for (const orbit of model.pieceOrbits) {
        compileOrbitTarget(model, orbit.id, model.solvedColors, colors);
      }
    } catch (error) {
      if (!(error instanceof PatternTargetError)) throw error;
      return {
        valid: false,
        invalid: [],
        wildcardCount,
        reason: "physical-pattern",
        details: { code: error.code, ...error.details },
      };
    }
  }

  return { valid: true, invalid: [], wildcardCount };
}
