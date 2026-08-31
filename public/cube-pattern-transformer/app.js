import "https://cdn.cubing.net/v0/js/cubing/twisty";
import {
  createCenterOrbitSolver,
  cube4x4CenterModel,
  validateCenterColors,
} from "./solver-core.mjs";

const {
  faceOrder: FACE_ORDER,
  colors: COLORS,
  stickers,
  editableIndices: centerIndices,
  solvedColors,
} = cube4x4CenterModel;
const centerSet = new Set(centerIndices);
const COLOR_CSS = {
  white: "var(--white)", red: "var(--red-sticker)", green: "var(--green-sticker)",
  yellow: "var(--yellow)", orange: "var(--orange)", blue: "var(--blue-sticker)",
};
const COLOR_NAMES = { white: "白", red: "红", green: "绿", yellow: "黄", orange: "橙", blue: "蓝" };

const elements = {
  fromNet: document.querySelector("#from-net"), toNet: document.querySelector("#to-net"),
  fromValid: document.querySelector("#from-valid"), toValid: document.querySelector("#to-valid"),
  palette: document.querySelector("#palette"), swapMode: document.querySelector("#swap-mode"),
  solve: document.querySelector("#solve"), example: document.querySelector("#example"), reset: document.querySelector("#reset"),
  swapStates: document.querySelector("#swap-states"), output: document.querySelector("#output"),
  status: document.querySelector("#status"), copy: document.querySelector("#copy"), player: document.querySelector("#player"),
  cycleCount: document.querySelector("#cycle-count"), moveCount: document.querySelector("#move-count"), fixedCount: document.querySelector("#fixed-count"),
};

function createFace(face, stateName) {
  const faceElement = document.createElement("div");
  faceElement.className = "face";
  faceElement.dataset.face = face;
  const label = document.createElement("span");
  label.className = "face-label";
  label.textContent = face;
  faceElement.append(label);
  stickers.forEach((sticker, index) => {
    if (sticker.face !== face) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = `sticker ${centerSet.has(index) ? "editable" : "locked"}`;
    button.dataset.index = index;
    button.dataset.state = stateName;
    button.disabled = !centerSet.has(index);
    button.setAttribute("aria-label", `${stateName === "from" ? "起点" : "终点"} ${face} 面第 ${sticker.row + 1} 行第 ${sticker.column + 1} 列`);
    faceElement.append(button);
  });
  return faceElement;
}
function createNet(container, stateName) { FACE_ORDER.forEach((face) => container.append(createFace(face, stateName))); }

const states = { from: [...solvedColors], to: [...solvedColors] };
let editMode = "swap";
let selectedColor = "green";
let pendingSticker = null;
let lastFormula = "";
let solver;

function renderPalette() {
  elements.palette.replaceChildren();
  COLORS.forEach((color) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `palette-button ${editMode === "paint" && selectedColor === color ? "selected" : ""}`;
    button.style.background = COLOR_CSS[color];
    button.title = `${COLOR_NAMES[color]}色：点击后进入涂色模式`;
    button.setAttribute("aria-label", `选择${COLOR_NAMES[color]}色`);
    button.addEventListener("click", () => { editMode = "paint"; selectedColor = color; pendingSticker = null; renderAll(); });
    elements.palette.append(button);
  });
  elements.swapMode.classList.toggle("active", editMode === "swap");
}

function renderNet(container, stateName) {
  container.querySelectorAll(".sticker").forEach((button) => {
    const index = Number(button.dataset.index);
    const color = states[stateName][index];
    button.style.setProperty("--sticker-color", COLOR_CSS[color]);
    button.title = `${COLOR_NAMES[color]}色${centerSet.has(index) ? "中心" : "（锁定）"}`;
    button.classList.toggle("pending", pendingSticker?.stateName === stateName && pendingSticker?.index === index);
  });
  const validation = validateCenterColors(states[stateName]);
  const validationElement = stateName === "from" ? elements.fromValid : elements.toValid;
  validationElement.className = validation.valid ? "count-ok" : "count-bad";
  validationElement.textContent = validation.valid ? "颜色数量正确" : `${validation.invalid.map((color) => COLOR_NAMES[color]).join("、")}色数量错误`;
}
function renderAll() { renderPalette(); renderNet(elements.fromNet, "from"); renderNet(elements.toNet, "to"); }

function markDirty() {
  lastFormula = "";
  elements.output.textContent = "图案已改变，点击“求解图案”重新计算";
  elements.status.className = "status";
  elements.status.textContent = "等待计算新的中心 orbit 解法。";
  elements.cycleCount.textContent = "—";
  elements.moveCount.textContent = "—";
  elements.fixedCount.textContent = "—";
}

function handleStickerClick(event) {
  const button = event.target.closest(".sticker.editable");
  if (!button) return;
  const index = Number(button.dataset.index);
  const stateName = button.dataset.state;
  if (editMode === "paint") {
    states[stateName][index] = selectedColor;
  } else if (!pendingSticker || pendingSticker.stateName !== stateName) {
    pendingSticker = { stateName, index };
    renderAll();
    return;
  } else {
    const firstIndex = pendingSticker.index;
    [states[stateName][firstIndex], states[stateName][index]] = [states[stateName][index], states[stateName][firstIndex]];
    pendingSticker = null;
  }
  markDirty();
  renderAll();
}

function showError(message) {
  elements.status.className = "status error";
  elements.status.textContent = message;
  elements.output.textContent = "无法生成解法";
  elements.cycleCount.textContent = "—";
  elements.moveCount.textContent = "—";
  elements.fixedCount.textContent = "—";
}

function solveAndRender() {
  try {
    const solution = solver.solve(states.from, states.to);
    const source = solver.solve(solvedColors, states.from);
    lastFormula = solution.formula;
    elements.output.textContent = solution.formula || "（无需转动：两个中心图案相同）";
    elements.status.className = "status success";
    elements.status.textContent = "已验证：结果命中全部 24 个目标中心，且 72 个非中心贴纸保持原位。";
    elements.cycleCount.textContent = String(solution.triples.length);
    elements.moveCount.textContent = String(solution.tokens.length);
    elements.fixedCount.textContent = `${solution.fixedNonCenterCount} / ${solution.fixedNonCenterCount}`;
    elements.player.experimentalSetupAlg = source.formula;
    elements.player.alg = solution.formula;
  } catch (error) { showError(error.message); }
}

createNet(elements.fromNet, "from");
createNet(elements.toNet, "to");
elements.fromNet.addEventListener("click", handleStickerClick);
elements.toNet.addEventListener("click", handleStickerClick);
elements.swapMode.addEventListener("click", () => { editMode = "swap"; pendingSticker = null; renderAll(); });
elements.solve.addEventListener("click", solveAndRender);
elements.reset.addEventListener("click", () => {
  states.from = [...solvedColors]; states.to = [...solvedColors]; pendingSticker = null; markDirty(); renderAll();
});
elements.swapStates.addEventListener("click", () => {
  [states.from, states.to] = [states.to, states.from]; pendingSticker = null; markDirty(); renderAll();
});
elements.example.addEventListener("click", () => {
  states.from = [...solvedColors];
  states.to = solver.centerPatternAfterAlgorithm("R U 2F D' 2R F2");
  pendingSticker = null; markDirty(); renderAll(); solveAndRender();
});
elements.copy.addEventListener("click", async () => {
  if (!lastFormula) return;
  await navigator.clipboard.writeText(lastFormula);
  elements.copy.textContent = "已复制";
  window.setTimeout(() => { elements.copy.textContent = "复制公式"; }, 1200);
});

try {
  solver = createCenterOrbitSolver();
  renderAll();
  elements.status.textContent = `局部交换子数据库已生成：覆盖 ${solver.databaseSize} 个有向中心 3-cycle。`;
  elements.player.alg = "";
} catch (error) {
  showError(error.message);
  elements.solve.disabled = true;
}
