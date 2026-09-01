import "https://cdn.cubing.net/v0/js/cubing/twisty";

import { createCubeModel } from "./cube-model.mjs";
import { validateEditorState } from "./editor-validation.mjs";
import {
  createRestrictedPatternSolver,
  RestrictedPatternSolveError,
} from "./pattern-solver.mjs";

const COLOR_CSS = {
  white: "var(--white)", red: "var(--red-sticker)", green: "var(--green-sticker)",
  yellow: "var(--yellow)", orange: "var(--orange)", blue: "var(--blue-sticker)",
};
const COLOR_NAMES = { white: "白", red: "红", green: "绿", yellow: "黄", orange: "橙", blue: "蓝" };
const EXAMPLES = {
  2: { from: "R U", to: "F R" },
  3: { from: "R U F", to: "R U' R U R U R U' R' U' R2" },
  4: { from: "R U F", to: "U R U' 2R U R' U' 2R' F' 2L 2F' 2L' F 2L 2F 2L'" },
  5: {
    from: "R U F",
    to: [
      "R U' R U R U R U' R' U' R2",
      "U R U' 2R U R' U' 2R'",
      "F' 2L 2F' 2L' F 2L 2F 2L'",
      "F' 2L 3F' 2L' F 2L 3F 2L'",
    ].join(" "),
  },
};

const elements = {
  size: document.querySelector("#cube-size"), scope: document.querySelector("#scope-text"),
  fromNet: document.querySelector("#from-net"), toNet: document.querySelector("#to-net"),
  fromMeta: document.querySelector("#from-meta"), toMeta: document.querySelector("#to-meta"),
  fromValid: document.querySelector("#from-valid"), toValid: document.querySelector("#to-valid"),
  palette: document.querySelector("#palette"), swapMode: document.querySelector("#swap-mode"),
  solve: document.querySelector("#solve"), example: document.querySelector("#example"), reset: document.querySelector("#reset"),
  swapStates: document.querySelector("#swap-states"), output: document.querySelector("#output"),
  status: document.querySelector("#status"), copy: document.querySelector("#copy"), player: document.querySelector("#player"),
  stageCount: document.querySelector("#stage-count"), moveCount: document.querySelector("#move-count"),
  verifiedCount: document.querySelector("#verified-count"),
};

let model;
let solver;
let fixedStickerSet = new Set();
let pieceBySticker = [];
let states = { from: [], to: [] };
let stateFormulas = { from: "", to: "" };
let editMode = "swap";
let selectedColor = "green";
let pendingSticker = null;
let lastFormula = "";

function setBusy(busy) {
  elements.solve.disabled = busy;
  elements.example.disabled = busy;
  elements.size.disabled = busy;
}

function createFace(face, stateName) {
  const faceElement = document.createElement("div");
  faceElement.className = "face";
  faceElement.dataset.face = face;
  const label = document.createElement("span");
  label.className = "face-label";
  label.textContent = face;
  faceElement.append(label);
  model.stickers.forEach((sticker, index) => {
    if (sticker.face !== face) return;
    const fixed = fixedStickerSet.has(index);
    const button = document.createElement("button");
    button.type = "button";
    button.className = `sticker ${fixed ? "locked" : "editable"}`;
    button.dataset.index = index;
    button.dataset.state = stateName;
    button.disabled = fixed;
    button.setAttribute("aria-label", `${stateName === "from" ? "起点" : "终点"} ${face} 面第 ${sticker.row + 1} 行第 ${sticker.column + 1} 列`);
    faceElement.append(button);
  });
  return faceElement;
}

function createNet(container, stateName) {
  container.replaceChildren();
  container.style.setProperty("--cube-size", model.size);
  model.faceOrder.forEach((face) => container.append(createFace(face, stateName)));
}

function renderPalette() {
  elements.palette.replaceChildren();
  [...model.colors, null].forEach((color) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `palette-button ${color === null ? "wildcard" : ""} ${editMode === "paint" && selectedColor === color ? "selected" : ""}`;
    if (color === null) {
      button.textContent = "?";
      button.title = "不关心这块最终是什么颜色（仅目标）";
      button.setAttribute("aria-label", "选择 wildcard");
    } else {
      button.style.background = COLOR_CSS[color];
      button.title = `${COLOR_NAMES[color]}色：点击后进入涂色模式`;
      button.setAttribute("aria-label", `选择${COLOR_NAMES[color]}色`);
    }
    button.addEventListener("click", () => {
      editMode = "paint";
      selectedColor = color;
      pendingSticker = null;
      renderAll();
    });
    elements.palette.append(button);
  });
  elements.swapMode.classList.toggle("active", editMode === "swap");
}

function renderNet(container, stateName) {
  container.querySelectorAll(".sticker").forEach((button) => {
    const index = Number(button.dataset.index);
    const color = states[stateName][index];
    const fixed = fixedStickerSet.has(index);
    button.style.setProperty("--sticker-color", COLOR_CSS[color] ?? "transparent");
    button.classList.toggle("wildcard", color === null);
    button.title = color === null
      ? "wildcard：不约束这块的最终颜色"
      : `${COLOR_NAMES[color] ?? color}色${fixed ? "（第一版固定）" : ""}`;
    button.classList.toggle("pending", pendingSticker?.stateName === stateName && pendingSticker?.index === index);
  });
  const validation = validateEditorState(
    model,
    states[stateName],
    stateName === "from" ? "source" : "target",
  );
  const validationElement = stateName === "from" ? elements.fromValid : elements.toValid;
  validationElement.className = validation.valid ? "count-ok" : "count-bad";
  if (validation.valid && validation.wildcardCount > 0) {
    validationElement.textContent = `${validation.wildcardCount} 枚 ?，其余颜色约束可补全`;
  } else if (validation.valid) {
    validationElement.textContent = `颜色总数正确（每色 ${model.size ** 2} 枚）`;
  } else if (validation.reason === "partial-piece") {
    validationElement.textContent = "corner/edge/wing 必须整块设为 ?";
  } else if (validation.reason === "source-wildcard") {
    validationElement.textContent = "起点不能包含 ?";
  } else if (validation.reason === "physical-state") {
    validationElement.textContent = "颜色总数正确，但不能组成合法 physical pieces";
  } else if (validation.reason === "physical-pattern") {
    validationElement.textContent = "现有颜色约束不能补成合法 physical pieces";
  } else {
    validationElement.textContent = `${validation.invalid.map((color) => COLOR_NAMES[color] ?? color).join("、")}色数量错误`;
  }
}

function renderAll() {
  if (!model) return;
  renderPalette();
  renderNet(elements.fromNet, "from");
  renderNet(elements.toNet, "to");
}

function resetMetrics() {
  elements.stageCount.textContent = "—";
  elements.moveCount.textContent = "—";
  elements.verifiedCount.textContent = "—";
}

function markDirty(stateName = null) {
  if (stateName) stateFormulas[stateName] = null;
  lastFormula = "";
  elements.output.textContent = "图案已改变，点击“求解图案”重新计算";
  elements.status.className = "status";
  elements.status.textContent = "等待完整 physical assignment 与 stage pipeline 验证。";
  elements.player.alg = "";
  resetMetrics();
}

function handleStickerClick(event) {
  const button = event.target.closest(".sticker.editable");
  if (!button) return;
  const index = Number(button.dataset.index);
  const stateName = button.dataset.state;
  if (editMode === "paint") {
    if (selectedColor === null && stateName === "from") {
      elements.status.className = "status error";
      elements.status.textContent = "wildcard 只允许用于目标图案；起点必须是完整 physical state。";
      return;
    }
    if (selectedColor === null) {
      const piece = pieceBySticker[index];
      for (const stickerIndex of piece.stickerIndices) states[stateName][stickerIndex] = null;
    } else {
      states[stateName][index] = selectedColor;
    }
  } else if (!pendingSticker || pendingSticker.stateName !== stateName) {
    if (states[stateName][index] === null) {
      elements.status.className = "status error";
      elements.status.textContent = "wildcard piece 不能逐贴纸交换；请先用颜色工具补全该块。";
      return;
    }
    pendingSticker = { stateName, index };
    renderAll();
    return;
  } else {
    const firstIndex = pendingSticker.index;
    if (states[stateName][index] === null || states[stateName][firstIndex] === null) {
      pendingSticker = null;
      elements.status.className = "status error";
      elements.status.textContent = "wildcard piece 不能逐贴纸交换；请先用颜色工具补全该块。";
      renderAll();
      return;
    }
    [states[stateName][firstIndex], states[stateName][index]] = [states[stateName][index], states[stateName][firstIndex]];
    pendingSticker = null;
  }
  markDirty(stateName);
  renderAll();
}

function errorMessage(error) {
  if (!(error instanceof RestrictedPatternSolveError)) return error.message;
  if (error.code === "invalid-source-state") return "起点贴纸不能组成合法的 physical pieces。";
  if (error.code === "invalid-target-state") return "目标贴纸不能组成合法的 physical pieces。";
  if (error.code === "unsupported-fixed-center-target") return "第一版不处理奇数阶固定中心换色；请保持六个中心贴纸不变。";
  if (error.code === "unsupported-orbit-subgroup") return `${error.stage} 超出当前第一版支持的局部子群；目标未被判定为不可达。`;
  if (error.code === "invalid-pattern-wildcard") return "corner、edge 和 wing 必须整块设为 wildcard；center 可以单贴纸设为 ?。";
  if (error.code === "no-pattern-assignment") return `${error.stage} 找不到满足颜色、orientation 和 parity 的 wildcard assignment。`;
  return `${error.code}：${error.message}`;
}

function showError(error) {
  elements.status.className = "status error";
  elements.status.textContent = errorMessage(error);
  elements.output.textContent = "无法在当前第一版能力范围内生成解法";
  resetMetrics();
}

function stageSummary(solution) {
  const active = solution.stages.filter((stage) => stage.tokens.length > 0);
  return active.length === 0 ? "无需执行任何 stage" : active.map((stage) => {
    const collateral = stage.collateralEffects.length > 0
      ? `；暂时扰动 ${stage.collateralEffects.map((effect) => effect.orbitId).join(", ")}`
      : "";
    return `${stage.id}(${stage.tokens.length}${collateral})`;
  }).join(" → ");
}

async function solveAndRender() {
  if (!solver) return;
  setBusy(true);
  elements.status.className = "status";
  elements.status.textContent = "正在构造并重放完整公式…";
  await new Promise((resolve) => window.requestAnimationFrame(resolve));
  try {
    const wildcardCount = states.to.filter((color) => color === null).length;
    const solution = wildcardCount > 0
      ? solver.solvePattern(states.from, states.to)
      : solver.solve(states.from, states.to);
    lastFormula = solution.formula;
    elements.output.textContent = solution.formula || "（无需转动：起点与目标相同）";
    elements.status.className = "status success";
    elements.status.textContent = `已验证全部 ${model.stickers.length} 枚贴纸。${wildcardCount > 0 ? `已解析 ${wildcardCount} 枚 wildcard；` : ""}${stageSummary(solution)}`;
    elements.stageCount.textContent = String(solution.stages.filter((stage) => stage.tokens.length > 0).length);
    elements.moveCount.textContent = String(solution.tokens.length);
    elements.verifiedCount.textContent = `${model.stickers.length}/${model.stickers.length}`;
    let setupFormula = stateFormulas.from;
    if (setupFormula === null) {
      try {
        setupFormula = solver.solve(model.solvedColors, states.from).formula;
      } catch {
        setupFormula = null;
      }
    }
    if (setupFormula === null) {
      elements.player.experimentalSetupAlg = "";
      elements.player.alg = "";
      elements.status.textContent += " 起点超出播放器 setup 范围，公式本身仍已验证。";
    } else {
      elements.player.experimentalSetupAlg = setupFormula;
      elements.player.alg = solution.formula;
    }
  } catch (error) {
    showError(error);
  } finally {
    setBusy(false);
  }
}

function capabilityText() {
  const groups = solver.capabilities.stages
    .filter((stage) => stage.physicalPermutationGroup)
    .map((stage) => `${stage.id}:${stage.physicalPermutationGroup}`);
  const boundary = model.size === 5
    ? " · 第一版限制：middle-edge A12、wing A24、固定中心锁定"
    : model.size === 3 ? " · 第一版限制：固定中心锁定" : "";
  const staged = solver.capabilities.stages
    .filter((stage) => !stage.localToFullCube)
    .map((stage) => stage.id);
  const stageNotice = staged.length > 0
    ? ` · stage 可暂时扰动后续 orbit：${staged.join(", ")}`
    : "";
  return `${model.size}×${model.size}×${model.size} · ${groups.join(" · ") || "corner stage"}${boundary}${stageNotice}`;
}

async function initializeSize(size) {
  setBusy(true);
  elements.status.className = "status";
  elements.status.textContent = `正在生成 ${size}×${size}×${size} orbit 数据库…`;
  await new Promise((resolve) => window.requestAnimationFrame(resolve));
  try {
    model = createCubeModel(size);
    solver = createRestrictedPatternSolver(model);
    pieceBySticker = Array(model.stickers.length);
    model.pieces.forEach((piece) => {
      piece.stickerIndices.forEach((index) => { pieceBySticker[index] = piece; });
    });
    const fixedOrbitIds = new Set(solver.capabilities.fixedVisualOrbits);
    fixedStickerSet = new Set(model.pieceOrbits
      .filter((orbit) => fixedOrbitIds.has(orbit.id))
      .flatMap((orbit) => orbit.stickerIndices));
    states = { from: [...model.solvedColors], to: [...model.solvedColors] };
    stateFormulas = { from: "", to: "" };
    pendingSticker = null;
    lastFormula = "";
    createNet(elements.fromNet, "from");
    createNet(elements.toNet, "to");
    const editableCount = model.stickers.length - fixedStickerSet.size;
    elements.fromMeta.textContent = `${editableCount} 枚可编辑贴纸`;
    elements.toMeta.textContent = `${editableCount} 枚可编辑贴纸`;
    elements.scope.textContent = capabilityText();
    elements.player.setAttribute("puzzle", `${size}x${size}x${size}`);
    elements.player.experimentalSetupAlg = "";
    elements.player.alg = "";
    elements.output.textContent = "编辑贴纸或载入示例后点击“求解图案”";
    elements.status.className = "status success";
    elements.status.textContent = `后端已就绪：${solver.capabilities.stages.length} 个 stage，完整贴纸 oracle 已启用。`;
    resetMetrics();
    renderAll();
  } catch (error) {
    solver = null;
    showError(error);
  } finally {
    setBusy(false);
  }
}

elements.fromNet.addEventListener("click", handleStickerClick);
elements.toNet.addEventListener("click", handleStickerClick);
elements.swapMode.addEventListener("click", () => { editMode = "swap"; pendingSticker = null; renderAll(); });
elements.solve.addEventListener("click", solveAndRender);
elements.reset.addEventListener("click", () => {
  states = { from: [...model.solvedColors], to: [...model.solvedColors] };
  stateFormulas = { from: "", to: "" };
  pendingSticker = null;
  markDirty();
  renderAll();
});
elements.swapStates.addEventListener("click", () => {
  if (states.to.some((color) => color === null)) {
    elements.status.className = "status error";
    elements.status.textContent = "目标含 wildcard 时不能与起点交换，因为 source 必须是完整状态。";
    return;
  }
  [states.from, states.to] = [states.to, states.from];
  [stateFormulas.from, stateFormulas.to] = [stateFormulas.to, stateFormulas.from];
  pendingSticker = null;
  markDirty();
  renderAll();
});
elements.example.addEventListener("click", async () => {
  const example = EXAMPLES[model.size];
  states.from = model.applyAlgorithm(model.solvedColors, example.from);
  states.to = model.applyAlgorithm(model.solvedColors, example.to);
  stateFormulas = { ...example };
  pendingSticker = null;
  markDirty();
  renderAll();
  await solveAndRender();
});
elements.copy.addEventListener("click", async () => {
  if (!lastFormula) return;
  try {
    await navigator.clipboard.writeText(lastFormula);
    elements.copy.textContent = "已复制";
    window.setTimeout(() => { elements.copy.textContent = "复制公式"; }, 1200);
  } catch {
    elements.status.className = "status error";
    elements.status.textContent = "浏览器未允许访问剪贴板，请手动复制公式。";
  }
});
elements.size.addEventListener("change", () => initializeSize(Number(elements.size.value)));

initializeSize(Number(elements.size.value));
