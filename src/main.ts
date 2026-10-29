import { Game } from "./game";
import { InputController } from "./input";
import { GameScene } from "./scene";
import { GameSound } from "./sound";
import "./style.css";

const canvas = document.querySelector<HTMLCanvasElement>("#game-canvas");

if (!canvas) {
  throw new Error("Game canvas was not found.");
}

const gameScene = new GameScene(canvas);
const input = new InputController();
const sound = new GameSound();
const game = new Game(gameScene, input, sound);

setupSettingsControls();

window.addEventListener("resize", () => game.handleResize());
window.addEventListener("beforeunload", () => {
  input.dispose();
  sound.dispose();
  game.stop();
});

game.start();

function setupSettingsControls(): void {
  const soundSetting = requireElement<HTMLInputElement>("#setting-sound");
  soundSetting.checked = sound.isEnabled;
  soundSetting.addEventListener("change", () => sound.setEnabled(soundSetting.checked));
  const allowSkips = requireElement<HTMLInputElement>("#setting-allow-skips");
  const lives = requireElement<HTMLInputElement>("#setting-lives");
  const baseDifficulty = requireElement<HTMLSelectElement>("#setting-base-difficulty");

  allowSkips.checked = readBooleanQuerySetting(["allowSkips", "allow_skips"]);
  lives.value = String(readPositiveIntegerQuerySetting([
    "lives",
    "numLives",
    "num_lives",
    "wrongAnswerLives",
    "wrong_answer_lives",
    "answerLives",
    "answer_lives",
    "questionLives",
    "question_lives",
    "trafficLives",
    "traffic_lives",
    "runOverLives",
    "run_over_lives",
    "collisionLives",
    "collision_lives",
  ]));
  baseDifficulty.value = readEnumQuerySetting(
    ["baseDifficulty", "base_difficulty", "baseYear", "base_year"],
    ["reception", "year1", "year2", "year3", "year4", "year5", "year6"],
    "year3",
  );

  allowSkips.addEventListener("change", () => updateBooleanSetting("allow_skips", allowSkips.checked));
  lives.addEventListener("change", () => updateNumberSetting("lives", lives.value));
  baseDifficulty.addEventListener("change", () => updateEnumSetting("base_difficulty", baseDifficulty.value, "year3"));
}

function updateBooleanSetting(name: string, value: boolean): void {
  updateUrlSetting(name, value ? "true" : null);
}

function updateNumberSetting(name: string, value: string): void {
  const parsedValue = Number(value);
  if (!Number.isInteger(parsedValue) || parsedValue < 1) {
    updateUrlSetting(name, null);
    return;
  }

  updateUrlSetting(name, parsedValue === 1 ? null : String(parsedValue));
}

function updateEnumSetting(name: string, value: string, defaultValue: string): void {
  updateUrlSetting(name, value === defaultValue ? null : value);
}

function updateUrlSetting(name: string, value: string | null): void {
  const url = new URL(window.location.href);
  const canonicalGroups = [
    ["allowSkips", "allow_skips"],
    ["requireAllQuestions", "require_all_questions", "allQuestions", "all_questions"],
    [
      "lives",
      "numLives",
      "num_lives",
      "wrongAnswerLives",
      "wrong_answer_lives",
      "answerLives",
      "answer_lives",
      "questionLives",
      "question_lives",
      "trafficLives",
      "traffic_lives",
      "runOverLives",
      "run_over_lives",
      "collisionLives",
      "collision_lives",
    ],
    ["baseDifficulty", "base_difficulty", "baseYear", "base_year"],
  ];
  const group = canonicalGroups.find((entries) => entries.includes(name)) ?? [name];

  for (const entry of group) {
    url.searchParams.delete(entry);
  }

  if (value !== null) {
    url.searchParams.set(name, value);
  }

  window.location.assign(url);
}

function readBooleanQuerySetting(names: string[]): boolean {
  const value = readQuerySetting(names);
  if (value === null) {
    return false;
  }

  return !["0", "false", "off", "no"].includes(value.toLowerCase());
}

function readPositiveIntegerQuerySetting(names: string[]): number {
  const value = readQuerySetting(names);
  if (value === null) {
    return 1;
  }

  const parsedValue = Number(value);
  return Number.isInteger(parsedValue) && parsedValue > 0 ? parsedValue : 1;
}

function readEnumQuerySetting(names: string[], values: string[], defaultValue: string): string {
  const value = readQuerySetting(names);
  return value !== null && values.includes(value) ? value : defaultValue;
}

function readQuerySetting(names: string[]): string | null {
  const parameters = new URLSearchParams(window.location.search);
  for (const name of names) {
    const value = parameters.get(name);
    if (value !== null) {
      return value;
    }
  }

  return null;
}

function requireElement<T extends HTMLElement = HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing required element: ${selector}`);
  }
  return element;
}
