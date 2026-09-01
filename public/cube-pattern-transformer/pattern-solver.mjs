import { createTwentyFourCenterSolver } from "./center-orbit-solver.mjs";
import { createCornerOrbitSolver } from "./corner-solver.mjs";
import { createTwelveEdgePermutationSolver } from "./edge-permutation-solver.mjs";
import { analyzePieceState } from "./piece-state.mjs";
import {
  compileOrbitTarget,
  normalizeTargetPattern,
  PatternTargetError,
} from "./pattern-target.mjs";
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
      localToFullCube: stage.solver.localToFullCube,
    }))),
    fixedVisualOrbits: Object.freeze(fixedVisualOrbits.map((orbit) => orbit.id)),
    limitations: Object.freeze([
      ...(model.size === 5 ? [
        "5x5x5 middle-edge permutation is restricted to A12",
        "5x5x5 middle-edge is a stage solver that may disturb later wing and center orbits",
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

  function executePipeline(fromColors, resolvedTarget, resolveStageTarget, extras = {}) {
    let current = [...fromColors];
    const tokens = [];
    const reports = [];
    const lockedOrbitIds = new Set();
    for (const stage of stages) {
      let targetInfo;
      try {
        targetInfo = resolveStageTarget(stage, current);
      } catch (error) {
        if (!(error instanceof PatternTargetError)) throw error;
        throw new RestrictedPatternSolveError(
          error.code === "partial-piece-wildcard"
            ? "invalid-pattern-wildcard"
            : "no-pattern-assignment",
          `${stage.id} 无法把 wildcard constraints 编译为 physical target`,
          {
            stage: stage.id,
            details: error.details,
            cause: error,
          },
        );
      }
      const stageTarget = targetInfo.targetColors;
      for (const index of stage.orbit.stickerIndices) {
        resolvedTarget[index] = stageTarget[index];
      }
      let result;
      try {
        result = stage.solver.solve(current, stageTarget);
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
        if (!orbitEqual(orbit, current, resolvedTarget)) {
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
        collateralEffects: Object.freeze(result.effects.filter((effect) => (
          effect.orbitId !== stage.orbit.id
        ))),
        targetAssignment: targetInfo.assignment ?? null,
      }));
    }

    if (!current.every((color, index) => color === resolvedTarget[index])) {
      throw new RestrictedPatternSolveError(
        "final-sticker-verification",
        "受限 stage pipeline 完成后仍有未解决贴纸",
      );
    }
    const verified = model.applyAlgorithm(fromColors, tokens);
    if (!verified.every((color, index) => color === resolvedTarget[index])) {
      throw new RestrictedPatternSolveError(
        "full-cube-replay-mismatch",
        "完整公式从 source 重放后没有达到 resolved target",
      );
    }

    return Object.freeze({
      tokens: Object.freeze(tokens),
      formula: tokens.join(" "),
      stages: Object.freeze(reports),
      effects: Object.freeze(model.algorithmOrbitEffects(tokens)),
      resolvedTarget: Object.freeze([...resolvedTarget]),
      capabilities,
      ...extras,
    });
  }

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
      return executePipeline(
        fromColors,
        [...toColors],
        () => ({ targetColors: toColors }),
      );
    },
    solvePattern(fromColors, rawPattern) {
      validateEndpoint(model, fromColors, "source");
      let pattern;
      try {
        pattern = normalizeTargetPattern(model, rawPattern);
      } catch (error) {
        if (!(error instanceof PatternTargetError)) throw error;
        throw new RestrictedPatternSolveError(
          "invalid-target-pattern",
          error.message,
          { details: error.details, cause: error },
        );
      }
      const resolvedTarget = [...fromColors];
      for (const orbit of fixedVisualOrbits) {
        for (const index of orbit.stickerIndices) {
          if (pattern[index] !== null && pattern[index] !== fromColors[index]) {
            throw new RestrictedPatternSolveError(
              "unsupported-fixed-center-target",
              `${orbit.id} 超出第一版 fixed-center visual target 限制`,
              { details: { orbitId: orbit.id, stickerIndex: index } },
            );
          }
        }
      }
      const wildcardCount = pattern.filter((value) => value === null).length;
      const result = executePipeline(
        fromColors,
        resolvedTarget,
        (stage, current) => {
          const requiresEvenPermutation = ["A12", "A24"]
            .includes(stage.solver.physicalPermutationGroup);
          const assignment = compileOrbitTarget(
            model,
            stage.orbit.id,
            current,
            pattern,
            { permutationParity: requiresEvenPermutation ? 0 : null },
          );
          return { targetColors: assignment.targetColors, assignment };
        },
        { wildcardCount },
      );
      if (!pattern.every((constraint, index) => (
        constraint === null || result.resolvedTarget[index] === constraint
      ))) {
        throw new RestrictedPatternSolveError(
          "resolved-target-constraint-mismatch",
          "resolved target 没有满足全部非 wildcard 贴纸约束",
        );
      }
      return result;
    },
  });
}
