import { TYPES, TYPE_IDS, createState, countFilled, isFilled, decideAction, applyAction } from "./solver.js";

const board = document.getElementById("board");
const counter = document.getElementById("filled-count");
const spentCounter = document.getElementById("spent-count");
const hold = document.getElementById("hold");
const holdContent = document.getElementById("hold-content");
const holdFeedback = document.getElementById("hold-feedback");
const feedback = document.getElementById("feedback");
const completionOverlay = document.getElementById("completion-overlay");
const skipButton = document.getElementById("skip-button");
const undoButton = document.getElementById("undo-button");
const resetButton = document.getElementById("reset-button");
const patternButtons = document.getElementById("pattern-buttons");
let state = createState();
let history = [];
let busy = false;
let requestId = 0;
let pendingInput = null;
let worker = null;
let renderedState = null;
let renderedHeld;
const holdViews = new Map();

function setText(element, value) {
  const text = String(value);
  if (element.textContent !== text) element.textContent = text;
}

function setAttribute(element, name, value) {
  const text = String(value);
  if (element.getAttribute(name) !== text) element.setAttribute(name, text);
}

function patternIcon(type) {
  const definition = TYPES[type];
  const rowOffset = Math.floor((7 - definition.height) / 2);
  const colOffset = Math.floor((7 - definition.width) / 2);
  const active = new Set(definition.offsets.map(([row, col]) => (row + rowOffset) * 7 + col + colOffset));
  const icon = document.createElement("span");
  icon.className = "pattern-icon";
  icon.setAttribute("aria-hidden", "true");
  for (let index = 0; index < 49; index++) {
    const cell = document.createElement("span");
    cell.className = active.has(index) ? "mini-cell on" : "mini-cell";
    icon.append(cell);
  }
  return icon;
}

for (let index = 1; index <= 7; index++) {
  for (const id of ["column-labels", "row-labels"]) {
    const label = document.createElement("span");
    label.textContent = index;
    document.getElementById(id).append(label);
  }
}
const cells = Array.from({ length: 49 }, () => {
  const cell = document.createElement("div");
  cell.className = "cell";
  cell.setAttribute("aria-hidden", "true");
  board.append(cell);
  return cell;
});

for (const type of TYPE_IDS) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "pattern-button";
  button.dataset.pattern = type;
  button.setAttribute("aria-label", `${TYPES[type].name} 입력`);
  const label = document.createElement("span");
  label.textContent = TYPES[type].name;
  button.append(patternIcon(type), label);
  button.addEventListener("click", () => inputPattern(type));
  patternButtons.append(button);
}

function locationText(placement) {
  const row = Math.floor(placement.anchor / 7) + 1;
  const col = placement.anchor % 7 + 1;
  if (placement.type === "vertical") return `${col}열`;
  if (placement.type === "horizontal") return `${row}행`;
  return `${row}행 ${col}열 중심`;
}

function setFeedback(message, completed = false) {
  if (completionOverlay.hidden !== !message) completionOverlay.hidden = !message;
  if (skipButton.hidden !== !completed) skipButton.hidden = !completed;
  if (feedback.classList.contains("complete") !== completed) feedback.classList.toggle("complete", completed);
  if (message) {
    let text = feedback.firstElementChild;
    if (!text) { text = document.createElement("p"); feedback.append(text); }
    setText(text, message);
  } else if (feedback.firstElementChild) feedback.replaceChildren();
}

function renderHold() {
  if (renderedHeld === state.held) return;
  let view = holdViews.get(state.held);
  if (!view) {
    const label = document.createElement("span");
    if (state.held) {
      label.textContent = TYPES[state.held].name;
      view = [patternIcon(state.held), label];
    } else {
      const dash = document.createElement("span");
      dash.className = "hold-empty-mark";
      dash.textContent = "—";
      dash.setAttribute("aria-hidden", "true");
      label.className = "sr-only";
      label.textContent = "비어 있음";
      view = [dash, label];
    }
    holdViews.set(state.held, view);
  }
  holdContent.replaceChildren(...view);
  holdContent.classList.toggle("has-pattern", Boolean(state.held));
  renderedHeld = state.held;
}

function render() {
  const filled = countFilled(state.board);
  const finished = filled === 49;
  if (renderedState !== state) {
    const latestCells = new Set(state.latest?.cells ?? []);
    setText(counter, filled);
    setText(spentCounter, state.spent.toLocaleString("ko-KR"));
    for (let index = 0; index < 49; index++) {
      const filledCell = isFilled(state.board, index);
      const latestCell = latestCells.has(index);
      const className = ["cell", filledCell ? "filled" : "", latestCell ? "latest" : "", state.latest?.anchor === index ? "anchor" : ""].filter(Boolean).join(" ");
      const title = `${Math.floor(index / 7) + 1}행 ${index % 7 + 1}열 · ${latestCell ? "최근 배치" : filledCell ? "채운 칸" : "빈칸"}`;
      if (cells[index].className !== className) cells[index].className = className;
      if (cells[index].title !== title) cells[index].title = title;
    }
    const recent = state.latest ? ` 최근 배치: ${TYPES[state.latest.type].name}, ${locationText(state.latest)}.` : "";
    setAttribute(board, "aria-label", `7행 7열 빙고판. ${filled}칸이 채워졌고 ${49 - filled}칸이 비었습니다.${recent}`);
    renderHold();
    renderedState = state;
  }
  for (const button of patternButtons.children) {
    // The click guard blocks repeat input without temporarily dimming buttons or losing focus.
    if (button.disabled !== finished) button.disabled = finished;
    setAttribute(button, "aria-disabled", busy || finished);
  }
  setAttribute(patternButtons, "aria-busy", busy);
  const undoDisabled = history.length === 0 && !busy;
  if (undoButton.disabled !== undoDisabled) undoButton.disabled = undoDisabled;
  const resetDisabled = state.turn === 0 && !busy;
  if (resetButton.disabled !== resetDisabled) resetButton.disabled = resetDisabled;
  setText(holdFeedback, state.lastAction?.kind === "hold" ? "보관" : state.lastAction?.kind === "swap" ? "교환" : "");
  setFeedback(finished ? "빈칸 배치를 완료했습니다." : "", finished);
}

function finishInput(id, action) {
  if (id !== requestId || !busy) return;
  try {
    const nextState = applyAction(state, action);
    if (nextState !== state) history.push(state);
    state = nextState;
  }
  catch { busy = false; pendingInput = null; render(); setFeedback("배치를 계산하지 못했습니다. 패턴을 다시 선택해 주세요."); return; }
  busy = false;
  pendingInput = null;
  render();
}

function localPlan(id, incoming) {
  setTimeout(() => {
    if (id !== requestId || !busy) return;
    try { finishInput(id, decideAction(state, incoming)); }
    catch { busy = false; pendingInput = null; render(); setFeedback("배치를 계산하지 못했습니다. 패턴을 다시 선택해 주세요."); }
  }, 0);
}

try {
  worker = new Worker(new URL("./planner.worker.js", import.meta.url), { type: "module" });
  worker.onmessage = ({ data }) => {
    if (data.id !== requestId || !busy) return;
    if (data.error) { worker.terminate(); worker = null; localPlan(data.id, pendingInput); }
    else finishInput(data.id, data.action);
  };
  worker.onerror = () => {
    worker?.terminate(); worker = null;
    if (busy && pendingInput) localPlan(requestId, pendingInput);
  };
} catch { worker = null; }

function inputPattern(incoming) {
  if (busy || countFilled(state.board) === 49) return;
  busy = true;
  pendingInput = incoming;
  const id = ++requestId;
  render();
  if (worker) worker.postMessage({ id, state, incoming });
  else localPlan(id, incoming);
}

function resetBoard(undoable) {
  ++requestId;
  if (undoable) {
    if (state.turn > 0) history.push(state);
  } else history = [];
  state = createState();
  busy = false;
  pendingInput = null;
  render();
  patternButtons.firstElementChild.focus();
}

skipButton.addEventListener("click", () => {
  if (countFilled(state.board) !== 49) return;
  resetBoard(false);
});

resetButton.addEventListener("click", () => {
  if (state.turn === 0 && !busy) return;
  resetBoard(true);
});

undoButton.addEventListener("click", () => {
  if (!busy && history.length === 0) return;
  ++requestId;
  // A pending input has not changed the board yet; cancel it without undoing an earlier input.
  if (!busy) state = history.pop();
  busy = false;
  pendingInput = null;
  render();
});

render();
