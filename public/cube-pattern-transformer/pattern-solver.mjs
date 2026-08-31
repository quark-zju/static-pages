import { createTwentyFourCenterSolver } from "./center-orbit-solver.mjs";
import { createCornerOrbitSolver } from "./corner-solver.mjs";
import { createTwelveEdgePermutationSolver } from "./edge-permutation-solver.mjs";
import { analyzePieceState } from "./piece-state.mjs";
import { createTwentyFourWingSolver } from "./wing-orbit-solver.mjs";

export class RestrictedPatternSolveError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = "RestrictedPatternSolveError";
    this.code = code;
    this.stage = options.stage ?? null;
    this.details = options.details ?? null;
  }
}

function orbitEqual(orbit, actual, expected) {
  return orbit.stickerIndices.every((index) => actual[index] === expected[index]);
}

function validateEndpoint(model, state, label) {
  const analysis = analyzePieceState(model, state);
  if (!analysis.valid) {
    throw new RestrictedPatternSolveError(
      `invalid-${label}-state`,
      `${label} sticker state 没有合法的逐 orbit physical assignment`,
      { details: analysis.errors },
    );
  }
  return analysis;
}

function isRestrictedSubgroupFailure(error) {
  return error instanceof Error && (
    error.message.includes("超出当前 A12 primitive 限制")
    || error.message.includes("超出第一版 A24 local solver 限制")
  );
}

function solverStages(model) {
  const stages = [];
  const corner = model.pieceOrbits.find((orbit) => orbit.kind === "corner");
  stages.push({
    id: "corners",
    kind: "stage",
    orbit: corner,
    solver: createCornerOrbitSolver(model),
  });

  const middleEdge = model.pieceOrbits.find((orbit) => (
    orbit.kind === "edge" && orbit.pieceIndices.length === 12
  ));
  if (middleEdge) {
    stages.push({
      id: "middle-edges",
      kind: "stage",
      orbit: middleEdge,
      solver: createTwelveEdgePermutationSolver(model),
    });
  }

  const wing = model.pieceOrbits.find((orbit) => (
    orbit.kind === "edge" && orbit.pieceIndices.length === 24
  ));
  if (wing) {
    stages.push({
      id: "wings",
      kind: "orbit-local",
      orbit: wing,
      solver: createTwentyFourWingSolver(model),
    });
  }

  for (const center of model.pieceOrbits.filter((orbit) => (
    orbit.kind === "center" && orbit.pieceIndices.length === 24
  ))) {
    stages.push({
      id: `centers:${center.id}`,
      kind: "orbit-local",
      orbit: center,
      solver: createTwentyFourCenterSolver(model, center.id),
    });
  }
  return stages;
}

function capabilitySummary(model, stages, fixedVisualOrbits) {
  return Object.freeze({
    mode: "restricted-orbit-local-v1",
    size: model.size,
    stages: Object.freeze(stages.map((stage) => Object.freeze({
      id: stage.id,
      kind: stage.kind,
      orbitId: stage.orbit.id,
      physicalPermutationGroup: stage.solver.physicalPermutationGroup ?? null,
    }))),
    fixedVisualOrbits: Object.freeze(fixedVisualOrbits.map((orbit) => orbit.id)),
    limitations: Object.freeze([
      ...(model.size === 5 ? [
        "5x5x5 middle-edge permutation is restricted to A12",
        "5x5x5 wing permutation is restricted to A24",
      ] : []),
      ...(fixedVisualOrbits.length > 0 ? [
        "six fixed-center stickers must already match the target",
      ] : []),
    ]),
  });
}

export function createRestrictedPatternSolver(model) {
  const stages = solverStages(model);
  const orbitById = new Map(model.pieceOrbits.map((orbit) => [orbit.id, orbit]));
  const solvedOrbitIds = new Set(stages.map((stage) => stage.orbit.id));
  const fixedVisualOrbits = model.pieceOrbits.filter((orbit) => (
    !solvedOrbitIds.has(orbit.id) && orbit.kind === "center"
  ));
  const capabilities = capabilitySummary(model, stages, fixedVisualOrbits);

  return Object.freeze({
    capabilities,
    solve(fromColors, toColors) {
      validateEndpoint(model, fromColors, "source");
      validateEndpoint(model, toColors, "target");
      for (const orbit of fixedVisualOrbits) {
        if (!orbitEqual(orbit, fromColors, toColors)) {
          throw new RestrictedPatternSolveError(
            "unsupported-fixed-center-target",
            `${orbit.id} 超出第一版 fixed-center visual target 限制`,
            { details: { orbitId: orbit.id } },
          );
        }
      }

      let current = [...fromColors];
      const tokens = [];
      const reports = [];
      const lockedOrbitIds = new Set();
      for (const stage of stages) {
        let result;
        try {
          result = stage.solver.solve(current, toColors);
        } catch (error) {
          if (!isRestrictedSubgroupFailure(error)) throw error;
          throw new RestrictedPatternSolveError(
            "unsupported-orbit-subgroup",
            `${stage.id} 超出第一版已认证 subgroup`,
            {
              stage: stage.id,
              details: { orbitId: stage.orbit.id },
              cause: error,
            },
          );
        }
        current = model.applyAlgorithm(current, result.tokens);
        tokens.push(...result.tokens);
        lockedOrbitIds.add(stage.orbit.id);
        for (const orbitId of lockedOrbitIds) {
          const orbit = orbitById.get(orbitId);
          if (!orbitEqual(orbit, current, toColors)) {
            throw new RestrictedPatternSolveError(
              "solved-orbit-regression",
              `${stage.id} 扰乱了已经完成的 ${orbit.id}`,
              { stage: stage.id, details: { orbitId: orbit.id } },
            );
          }
        }
        reports.push(Object.freeze({
          id: stage.id,
          kind: stage.kind,
          orbitId: stage.orbit.id,
          tokens: result.tokens,
          formula: result.formula,
          effects: result.effects,
        }));
      }

      if (!current.every((color, index) => color === toColors[index])) {
        throw new RestrictedPatternSolveError(
          "final-sticker-verification",
          "受限 stage pipeline 完成后仍有未解决贴纸",
        );
      }
      const verified = model.applyAlgorithm(fromColors, tokens);
      if (!verified.every((color, index) => color === toColors[index])) {
        throw new RestrictedPatternSolveError(
          "full-cube-replay-mismatch",
          "完整公式从 source 重放后没有达到 target",
        );
      }

      return Object.freeze({
        tokens: Object.freeze(tokens),
        formula: tokens.join(" "),
        stages: Object.freeze(reports),
        effects: Object.freeze(model.algorithmOrbitEffects(tokens)),
        capabilities,
      });
    },
  });
}
