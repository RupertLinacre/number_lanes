import { checkAnswer, generateProblem, type MathProblem } from "maths-game-problem-generator";
import * as THREE from "three";
import { InputController } from "./input";
import {
  GameScene,
  LANE_DEPTH,
  TILE_SIZE,
  WORLD_HALF_WIDTH,
  laneIndexToZ,
  type LaneKind,
  type LaneVisual,
  type VehicleStyle,
} from "./scene";

interface Lane {
  index: number;
  kind: LaneKind;
  direction: -1 | 1;
  speed: number;
  vehicles: Vehicle[];
  checkpoint?: Checkpoint;
}

interface Vehicle {
  mesh: THREE.Group;
  laneIndex: number;
  width: number;
  initialX: number;
  x: number;
  direction: -1 | 1;
  speed: number;
}

interface CheckpointProblem {
  problem: MathProblem;
  solved: boolean;
  mesh?: THREE.Mesh;
}

interface Checkpoint {
  laneIndex: number;
  incomingRoadCount: number;
  outgoingRoadCount: number;
  yearLevel: DifficultyLevel;
  problems: CheckpointProblem[];
  unlocked: boolean;
  visual: LaneVisual;
}

interface LanePlan {
  kind: LaneKind;
  section: number;
  incomingRoadCount: number;
  outgoingRoadCount: number;
  roadOffset: number;
}

const START_LANE = 0;
const PLAYER_SIZE = 0.78;
const CHECKPOINT_PROBLEM_COUNT = 3;
const ROAD_GROUP_SEQUENCE = [1, 2, 3, 4] as const;
const PROBLEM_SLOTS = [-6, 0, 6];
const START_SLOT_INDEX = 1;
const DIFFICULTY_LEVELS = ["reception", "year1", "year2", "year3", "year4", "year5", "year6"] as const;
const DIFFICULTY_LABELS: Record<DifficultyLevel, string> = {
  reception: "Reception",
  year1: "Y1",
  year2: "Y2",
  year3: "Y3",
  year4: "Y4",
  year5: "Y5",
  year6: "Y6",
};
const VEHICLE_STYLES: VehicleStyle[] = [
  { body: 0xff6d3a, cabin: 0xffffff, length: 2.6 },
  { body: 0x00a8d8, cabin: 0xf0ffff, length: 2.35 },
  { body: 0xf45b69, cabin: 0xfff8f0, length: 2.15 },
  { body: 0xf4c95d, cabin: 0xffffff, length: 3.0 },
  { body: 0x8f65ff, cabin: 0xfffcff, length: 2.45 },
];

type DifficultyLevel = (typeof DIFFICULTY_LEVELS)[number];

export class Game {
  private readonly player: THREE.Group;
  private readonly targetHighlight: THREE.Group;
  private readonly lanes = new Map<number, Lane>();
  private readonly clock = new THREE.Clock();
  private readonly scoreElement: HTMLElement;
  private readonly bestElement: HTMLElement;
  private readonly difficultyStatsElement: HTMLElement;
  private readonly questionText: HTMLElement;
  private readonly answerDisplay: HTMLElement;
  private readonly answerFeedback: HTMLElement;
  private readonly restartButton: HTMLButtonElement;
  private playerLane = START_LANE;
  private targetLane = START_LANE;
  private selectedSlotIndex = START_SLOT_INDEX;
  private hopProgress = 1;
  private hopStartX = PROBLEM_SLOTS[START_SLOT_INDEX];
  private hopStartZ = laneIndexToZ(START_LANE);
  private hopEndX = PROBLEM_SLOTS[START_SLOT_INDEX];
  private hopEndZ = laneIndexToZ(START_LANE);
  private answerText = "";
  private gameOver = false;
  private maxLaneReached = 0;
  private bestLaneReached = Number(localStorage.getItem("hop-lane-best") ?? 0);
  private readonly shouldSaveProgress = readSaveProgressSetting();
  private readonly shouldRequireAllQuestions = readRequireAllQuestionsSetting();
  private readonly maxWrongAnswerLives = readWrongAnswerLivesSetting();
  private readonly maxTrafficLives = readTrafficLivesSetting();
  private readonly baseDifficulty = readBaseDifficultySetting();
  private readonly questionsAnsweredByDifficulty = createQuestionStats();
  private readonly savedUnlockedCheckpoints = new Set<number>([START_LANE]);
  private wrongAnswerLivesRemaining = this.maxWrongAnswerLives;
  private trafficLivesRemaining = this.maxTrafficLives;
  private animationId = 0;

  constructor(
    private readonly gameScene: GameScene,
    private readonly input: InputController,
  ) {
    this.scoreElement = requireElement("#score");
    this.bestElement = requireElement("#best");
    this.difficultyStatsElement = requireElement("#difficulty-stats");
    this.questionText = requireElement("#question-text");
    this.answerDisplay = requireElement("#answer-input");
    this.answerFeedback = requireElement("#answer-feedback");
    this.restartButton = requireElement("#restart-button");
    this.restartButton.addEventListener("click", () => this.restartGame());

    this.player = this.gameScene.createPlayer();
    this.targetHighlight = this.gameScene.createQuestionHighlight();
    this.gameScene.scene.add(this.player, this.targetHighlight);

    this.buildInitialWorld();
    this.resetRound();
  }

  start(): void {
    this.clock.start();
    this.tick();
  }

  stop(): void {
    cancelAnimationFrame(this.animationId);
  }

  handleResize(): void {
    this.gameScene.resize();
  }

  private tick = (): void => {
    const delta = Math.min(this.clock.getDelta(), 0.05);

    this.handleAnswerInput();
    this.moveSelection(this.input.consumeHorizontal());

    if (this.input.consumeAdvance()) {
      this.advancePlayer();
    }

    this.updatePlayer(delta);
    this.updateVehicles(delta);
    this.checkCollisions();
    this.ensureWorldAhead();
    this.updateTargetHighlight();
    this.gameScene.updateCamera(this.player.position.z, delta);
    this.gameScene.render();

    this.animationId = requestAnimationFrame(this.tick);
  };

  private buildInitialWorld(): void {
    for (let index = 0; index < 30; index += 1) {
      this.createLane(index);
    }
  }

  private ensureWorldAhead(): void {
    const highestLane = Math.max(...this.lanes.keys());
    for (let index = highestLane + 1; index <= this.playerLane + 30; index += 1) {
      this.createLane(index);
    }
  }

  private createLane(index: number): Lane {
    const plan = getLanePlan(index);
    const isCheckpoint = plan.kind === "grass";
    const isUnlockedCheckpoint = isCheckpoint && this.isCheckpointUnlocked(index);
    const visual = this.gameScene.createLane(
      index,
      plan.kind,
      isCheckpoint && !isUnlockedCheckpoint ? "locked" : "unlocked",
      plan.kind === "road" && plan.roadOffset < plan.outgoingRoadCount - 1,
    );

    const lane: Lane = {
      index,
      kind: plan.kind,
      direction: (plan.section + index) % 2 === 0 ? 1 : -1,
      speed: 3.1 + (plan.section % 4) * 0.42 + plan.outgoingRoadCount * 0.18,
      vehicles: [],
    };

    if (isCheckpoint) {
      lane.checkpoint = this.createCheckpoint(
        index,
        plan.incomingRoadCount,
        plan.outgoingRoadCount,
        visual,
      );
    }

    this.lanes.set(index, lane);

    if (plan.kind === "road") {
      this.addVehicles(lane, plan.section);
    }

    return lane;
  }

  private createCheckpoint(
    index: number,
    incomingRoadCount: number,
    outgoingRoadCount: number,
    visual: LaneVisual,
  ): Checkpoint {
    const checkpoint: Checkpoint = {
      laneIndex: index,
      incomingRoadCount,
      outgoingRoadCount,
      yearLevel: this.roadCountToDifficulty(incomingRoadCount),
      problems: this.generateProblems(incomingRoadCount),
      unlocked: this.isCheckpointUnlocked(index),
      visual,
    };

    this.refreshCheckpointText(checkpoint);
    return checkpoint;
  }

  private generateProblems(roadCount: number): CheckpointProblem[] {
    const yearLevel = this.roadCountToDifficulty(roadCount);
    return Array.from({ length: CHECKPOINT_PROBLEM_COUNT }, () => ({
      problem: generateProblem({ yearLevel }),
      solved: false,
    }));
  }

  private roadCountToDifficulty(roadCount: number): DifficultyLevel {
    const baseIndex = DIFFICULTY_LEVELS.indexOf(this.baseDifficulty);
    const difficultyIndex = THREE.MathUtils.clamp(
      baseIndex + roadCount - 1,
      0,
      DIFFICULTY_LEVELS.length - 1,
    );
    return DIFFICULTY_LEVELS[difficultyIndex];
  }

  private refreshCheckpointText(checkpoint: Checkpoint): void {
    const z = laneIndexToZ(checkpoint.laneIndex);

    checkpoint.problems.forEach((entry, problemIndex) => {
      if (entry.mesh) {
        checkpoint.visual.group.remove(entry.mesh);
        entry.mesh = undefined;
      }
    });

    if (checkpoint.laneIndex === START_LANE) {
      return;
    }

    checkpoint.problems.forEach((entry, problemIndex) => {
      if (checkpoint.unlocked && !entry.solved) {
        return;
      }

      const displayText = entry.solved
        ? `OK ${entry.problem.expression_short}`
        : entry.problem.expression_short;
      const mesh = this.gameScene.createMathText(displayText, checkpoint.unlocked || entry.solved);
      mesh.position.set(PROBLEM_SLOTS[problemIndex], 0.035, z + 0.05);
      checkpoint.visual.group.add(mesh);
      entry.mesh = mesh;
    });
  }

  private addVehicles(lane: Lane, section: number): void {
    const count = 2 + (lane.index + section) % 2;
    const spacing = (WORLD_HALF_WIDTH * 2 + 7) / count;

    for (let i = 0; i < count; i += 1) {
      const style = VEHICLE_STYLES[(lane.index + section + i) % VEHICLE_STYLES.length];
      const mesh = this.gameScene.createVehicle(style);
      const x = -WORLD_HALF_WIDTH - 3.5 + i * spacing + ((lane.index * 1.7) % spacing);
      mesh.position.set(x, 0.02, laneIndexToZ(lane.index));
      mesh.rotation.y = lane.direction === 1 ? 0 : Math.PI;

      lane.vehicles.push({
        mesh,
        laneIndex: lane.index,
        width: style.length,
        initialX: x,
        x,
        direction: lane.direction,
        speed: lane.speed,
      });
    }
  }

  private handleAnswerInput(): void {
    const events = this.input.consumeAnswerInput();
    if (this.gameOver) {
      if (events.submit) {
        this.restartGame();
      }
      return;
    }

    if (events.clear) {
      this.answerText = "";
    }

    if (events.backspaceCount > 0) {
      this.answerText = this.answerText.slice(0, Math.max(0, this.answerText.length - events.backspaceCount));
    }

    for (const character of events.characters) {
      this.addAnswerCharacter(character);
    }

    this.updateAnswerDisplay();

    if (events.submit) {
      if (this.shouldSubmitHop()) {
        this.advancePlayer();
        return;
      }

      this.submitAnswer();
    }
  }

  private shouldSubmitHop(): boolean {
    if (this.gameOver || this.hopProgress < 1) {
      return false;
    }

    const currentCheckpoint = this.currentCheckpoint();
    if (!currentCheckpoint) {
      return true;
    }

    const targetCheckpoint = currentCheckpoint ? this.nextCheckpointFrom(currentCheckpoint) : undefined;
    return Boolean(targetCheckpoint?.unlocked);
  }

  private addAnswerCharacter(character: string): void {
    if (character === "." && this.answerText.includes(".")) {
      return;
    }

    if (character === "-" && this.answerText.length > 0) {
      return;
    }

    if (this.answerText.length >= 10) {
      return;
    }

    this.answerText += character;
  }

  private moveSelection(direction: -1 | 0 | 1): void {
    if (this.gameOver || direction === 0 || this.hopProgress < 1 || !this.currentCheckpoint()) {
      return;
    }

    const nextIndex = THREE.MathUtils.clamp(
      this.selectedSlotIndex + direction,
      0,
      PROBLEM_SLOTS.length - 1,
    );

    if (nextIndex === this.selectedSlotIndex) {
      return;
    }

    this.selectedSlotIndex = nextIndex;
    this.answerText = "";
    this.updateAnswerDisplay();
    this.updateQuestionPanel();
  }

  private advancePlayer(): void {
    if (this.gameOver || this.hopProgress < 1) {
      return;
    }

    const currentCheckpoint = this.currentCheckpoint();
    const nextCheckpoint = currentCheckpoint ? this.nextCheckpointFrom(currentCheckpoint) : undefined;
    if (currentCheckpoint && nextCheckpoint && !nextCheckpoint.unlocked) {
      this.answerFeedback.textContent = "Answer the highlighted question first.";
      return;
    }

    this.targetLane = this.playerLane + 1;
    this.hopStartX = this.player.position.x;
    this.hopStartZ = this.player.position.z;
    this.hopEndX = PROBLEM_SLOTS[this.selectedSlotIndex];
    this.hopEndZ = laneIndexToZ(this.targetLane);
    this.hopProgress = 0;
  }

  private updatePlayer(delta: number): void {
    if (this.gameOver) {
      return;
    }

    const selectedX = PROBLEM_SLOTS[this.selectedSlotIndex];

    if (this.hopProgress >= 1) {
      if (this.currentCheckpoint()) {
        this.player.position.x = THREE.MathUtils.lerp(this.player.position.x, selectedX, Math.min(1, delta * 9));
      }
      return;
    }

    this.hopProgress = Math.min(1, this.hopProgress + delta * 7.4);
    const eased = easeOutCubic(this.hopProgress);
    this.player.position.x = THREE.MathUtils.lerp(this.hopStartX, this.hopEndX, eased);
    this.player.position.z = THREE.MathUtils.lerp(this.hopStartZ, this.hopEndZ, eased);
    this.player.position.y = Math.sin(this.hopProgress * Math.PI) * 0.72;
    this.player.rotation.x = Math.sin(this.hopProgress * Math.PI) * -0.12;

    if (this.hopProgress === 1) {
      this.playerLane = this.targetLane;
      this.player.position.set(this.hopEndX, 0, laneIndexToZ(this.playerLane));
      this.player.rotation.x = 0;
      this.maxLaneReached = Math.max(this.maxLaneReached, this.playerLane);
      this.bestLaneReached = Math.max(this.bestLaneReached, this.maxLaneReached);
      localStorage.setItem("hop-lane-best", String(this.bestLaneReached));
      this.answerText = "";
      this.updateHud();
    }
  }

  private updateVehicles(delta: number): void {
    const minX = -WORLD_HALF_WIDTH - 5;
    const maxX = WORLD_HALF_WIDTH + 5;

    for (const lane of this.lanes.values()) {
      for (const vehicle of lane.vehicles) {
        vehicle.x += vehicle.direction * vehicle.speed * delta;

        if (vehicle.direction === 1 && vehicle.x > maxX) {
          vehicle.x = minX;
        } else if (vehicle.direction === -1 && vehicle.x < minX) {
          vehicle.x = maxX;
        }

        vehicle.mesh.position.x = vehicle.x;
      }
    }
  }

  private checkCollisions(): void {
    if (this.gameOver) {
      return;
    }

    const lane = this.lanes.get(Math.round(-this.player.position.z / TILE_SIZE));
    if (!lane || lane.kind !== "road") {
      return;
    }

    const playerZ = this.player.position.z;
    for (const vehicle of lane.vehicles) {
      const vehicleZ = laneIndexToZ(vehicle.laneIndex);
      const xOverlap = Math.abs(vehicle.x - this.player.position.x) < vehicle.width * 0.5 + PLAYER_SIZE * 0.5;
      const zOverlap = Math.abs(vehicleZ - playerZ) < LANE_DEPTH * 0.42;

      if (xOverlap && zOverlap) {
        this.handleTrafficHit();
        return;
      }
    }
  }

  private submitAnswer(): void {
    const targetCheckpoint = this.targetCheckpoint();

    if (!targetCheckpoint) {
      this.answerFeedback.textContent = "Reach a safe lane to target maths.";
      this.answerText = "";
      this.updateAnswerDisplay();
      return;
    }

    if (targetCheckpoint.unlocked) {
      this.advancePlayer();
      this.answerText = "";
      this.updateAnswerDisplay();
      return;
    }

    const answer = this.answerText.trim();
    if (!answer || answer === "-" || answer === ".") {
      this.answerFeedback.textContent = "Type an answer, then Enter.";
      return;
    }

    const selectedProblem = targetCheckpoint.problems[this.selectedSlotIndex];
    if (selectedProblem.solved) {
      this.answerText = "";
      this.selectNextUnsolvedProblem(targetCheckpoint);
      this.updateQuestionPanel();
      this.updateAnswerDisplay();
      return;
    }

    if (!checkAnswer(selectedProblem.problem, answer)) {
      const correctAnswer = selectedProblem.problem.formattedAnswer || String(selectedProblem.problem.answer);
      this.handleWrongAnswer(`${selectedProblem.problem.expression} = ${correctAnswer}`);
      return;
    }

    selectedProblem.solved = true;
    this.questionsAnsweredByDifficulty[selectedProblem.problem.yearLevel as DifficultyLevel] += 1;
    targetCheckpoint.unlocked =
      !this.shouldRequireAllQuestions || targetCheckpoint.problems.every((entry) => entry.solved);
    if (targetCheckpoint.unlocked) {
      this.saveUnlockedCheckpoint(targetCheckpoint.laneIndex);
      this.gameScene.setSafeLaneState(targetCheckpoint.visual.surface, "unlocked");
    } else {
      this.selectNextUnsolvedProblem(targetCheckpoint);
    }
    this.answerText = "";
    this.refreshCheckpointText(targetCheckpoint);
    this.updateQuestionPanel();
    this.updateDifficultyStats();
    this.updateAnswerDisplay();
  }

  private selectNextUnsolvedProblem(checkpoint: Checkpoint): void {
    const nextProblemIndex = checkpoint.problems.findIndex((entry) => !entry.solved);
    if (nextProblemIndex >= 0) {
      this.selectedSlotIndex = nextProblemIndex;
    }
  }

  private resetRound(feedback = ""): void {
    this.gameOver = false;
    this.restartButton.hidden = true;
    this.playerLane = START_LANE;
    this.targetLane = START_LANE;
    this.selectedSlotIndex = START_SLOT_INDEX;
    this.hopProgress = 1;
    this.maxLaneReached = 0;
    this.answerText = "";
    this.hopStartX = PROBLEM_SLOTS[START_SLOT_INDEX];
    this.hopEndX = PROBLEM_SLOTS[START_SLOT_INDEX];
    this.hopStartZ = laneIndexToZ(START_LANE);
    this.hopEndZ = laneIndexToZ(START_LANE);
    this.player.position.set(PROBLEM_SLOTS[START_SLOT_INDEX], 0, laneIndexToZ(START_LANE));
    this.player.rotation.set(0, 0, 0);
    this.resetVehicles();
    this.resetCheckpoints();
    this.updateHud();
    this.answerFeedback.textContent = feedback;
  }

  private restartGame(): void {
    this.wrongAnswerLivesRemaining = this.maxWrongAnswerLives;
    this.trafficLivesRemaining = this.maxTrafficLives;
    this.resetRound();
  }

  private handleWrongAnswer(detail: string): void {
    this.wrongAnswerLivesRemaining -= 1;
    if (this.wrongAnswerLivesRemaining <= 0) {
      this.endRound(
        "Wrong answer",
        `${detail}. Press Enter or click Restart to try again.`,
      );
      return;
    }

    this.resetRound();
  }

  private handleTrafficHit(): void {
    this.trafficLivesRemaining -= 1;
    if (this.trafficLivesRemaining <= 0) {
      this.endRound(
        "Squashed by traffic",
        "You were hit by a car. Press Enter or click Restart to try again.",
      );
      return;
    }

    this.resetRound();
  }

  private endRound(title: string, detail: string): void {
    this.gameOver = true;
    this.answerText = "";
    this.targetHighlight.visible = false;
    this.questionText.textContent = title;
    this.answerFeedback.textContent = detail;
    this.restartButton.hidden = false;
    this.updateAnswerDisplay();
  }

  private resetVehicles(): void {
    for (const lane of this.lanes.values()) {
      for (const vehicle of lane.vehicles) {
        vehicle.x = vehicle.initialX;
        vehicle.mesh.position.x = vehicle.initialX;
      }
    }
  }

  private resetCheckpoints(): void {
    for (const lane of this.lanes.values()) {
      if (!lane.checkpoint) {
        continue;
      }

      for (const entry of lane.checkpoint.problems) {
        if (entry.mesh) {
          lane.checkpoint.visual.group.remove(entry.mesh);
        }
      }

      const isUnlocked = this.isCheckpointUnlocked(lane.index);
      lane.checkpoint.unlocked = isUnlocked;
      if (!this.shouldSaveProgress || !isUnlocked) {
        lane.checkpoint.problems = this.generateProblems(lane.checkpoint.incomingRoadCount);
      }
      this.gameScene.setSafeLaneState(
        lane.checkpoint.visual.surface,
        isUnlocked ? "unlocked" : "locked",
      );
      this.refreshCheckpointText(lane.checkpoint);
    }
  }

  private isCheckpointUnlocked(laneIndex: number): boolean {
    return laneIndex === START_LANE || this.savedUnlockedCheckpoints.has(laneIndex);
  }

  private saveUnlockedCheckpoint(laneIndex: number): void {
    if (!this.shouldSaveProgress) {
      return;
    }

    this.savedUnlockedCheckpoints.add(laneIndex);
  }

  private currentCheckpoint(): Checkpoint | undefined {
    return this.lanes.get(this.playerLane)?.checkpoint;
  }

  private targetCheckpoint(): Checkpoint | undefined {
    const currentCheckpoint = this.currentCheckpoint();
    if (!currentCheckpoint) {
      return undefined;
    }

    return this.nextCheckpointFrom(currentCheckpoint);
  }

  private nextCheckpointFrom(checkpoint: Checkpoint): Checkpoint | undefined {
    const targetLaneIndex = checkpoint.laneIndex + checkpoint.outgoingRoadCount + 1;
    return this.lanes.get(targetLaneIndex)?.checkpoint;
  }

  private updateTargetHighlight(): void {
    const checkpoint = this.targetCheckpoint();
    if (this.gameOver || !checkpoint || checkpoint.unlocked || this.hopProgress < 1) {
      this.targetHighlight.visible = false;
      return;
    }

    this.targetHighlight.visible = true;
    this.targetHighlight.position.set(
      PROBLEM_SLOTS[this.selectedSlotIndex],
      0.045,
      laneIndexToZ(checkpoint.laneIndex) + 0.05,
    );
  }

  private updateHud(): void {
    this.scoreElement.textContent = String(this.maxLaneReached);
    this.bestElement.textContent = String(this.bestLaneReached);
    this.updateDifficultyStats();
    this.updateQuestionPanel();
    this.updateAnswerDisplay();
  }

  private updateDifficultyStats(): void {
    const total = DIFFICULTY_LEVELS.reduce(
      (sum, level) => sum + this.questionsAnsweredByDifficulty[level],
      0,
    );
    const breakdown = DIFFICULTY_LEVELS
      .filter((level) => this.questionsAnsweredByDifficulty[level] > 0)
      .map((level) => `${DIFFICULTY_LABELS[level]} ${this.questionsAnsweredByDifficulty[level]}`)
      .join("\n");

    this.difficultyStatsElement.textContent = `${total} correct`;
    if (breakdown) {
      this.difficultyStatsElement.dataset.breakdown = breakdown;
    } else {
      delete this.difficultyStatsElement.dataset.breakdown;
    }
  }

  private updateQuestionPanel(): void {
    if (this.gameOver) {
      return;
    }

    const currentCheckpoint = this.currentCheckpoint();
    if (!currentCheckpoint) {
      this.questionText.textContent = "Keep hopping";
      this.answerFeedback.textContent = "";
      return;
    }

    const targetCheckpoint = this.nextCheckpointFrom(currentCheckpoint);
    if (!targetCheckpoint) {
      this.questionText.textContent = "Next lane loading";
      this.answerFeedback.textContent = "";
      return;
    }

    if (targetCheckpoint.unlocked) {
      this.questionText.textContent = `${targetCheckpoint.incomingRoadCount} road lane${targetCheckpoint.incomingRoadCount === 1 ? "" : "s"} ahead`;
      this.answerFeedback.textContent = "";
      return;
    }

    const selectedProblem = targetCheckpoint.problems[this.selectedSlotIndex];
    this.questionText.textContent = `${selectedProblem.problem.expression} = ?`;
    this.answerFeedback.textContent = "";
  }

  private updateAnswerDisplay(): void {
    this.answerDisplay.textContent = this.answerText;
    this.answerDisplay.toggleAttribute("data-empty", this.answerText.length === 0);
  }
}

function getLanePlan(index: number): LanePlan {
  let safeIndex = 0;
  let section = 0;

  while (true) {
    const outgoingRoadCount = ROAD_GROUP_SEQUENCE[section % ROAD_GROUP_SEQUENCE.length];
    const incomingRoadCount =
      section === 0
        ? ROAD_GROUP_SEQUENCE[0]
        : ROAD_GROUP_SEQUENCE[(section - 1) % ROAD_GROUP_SEQUENCE.length];

    if (index === safeIndex) {
      return { kind: "grass", section, incomingRoadCount, outgoingRoadCount, roadOffset: -1 };
    }

    if (index > safeIndex && index <= safeIndex + outgoingRoadCount) {
      return {
        kind: "road",
        section,
        incomingRoadCount,
        outgoingRoadCount,
        roadOffset: index - safeIndex - 1,
      };
    }

    safeIndex += outgoingRoadCount + 1;
    section += 1;
  }
}

function requireElement<T extends HTMLElement = HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing required element: ${selector}`);
  }
  return element;
}

function readSaveProgressSetting(): boolean {
  return readBooleanQuerySetting(["saveProgress", "save_progress"]);
}

function readRequireAllQuestionsSetting(): boolean {
  return readBooleanQuerySetting([
    "requireAllQuestions",
    "require_all_questions",
    "allQuestions",
    "all_questions",
  ]);
}

function readWrongAnswerLivesSetting(): number {
  return readPositiveIntegerQuerySetting([
    "wrongAnswerLives",
    "wrong_answer_lives",
    "answerLives",
    "answer_lives",
    "questionLives",
    "question_lives",
  ]);
}

function readTrafficLivesSetting(): number {
  return readPositiveIntegerQuerySetting([
    "trafficLives",
    "traffic_lives",
    "runOverLives",
    "run_over_lives",
    "collisionLives",
    "collision_lives",
  ]);
}

function readBaseDifficultySetting(): DifficultyLevel {
  const value = readQuerySetting(["baseDifficulty", "base_difficulty", "baseYear", "base_year"]);
  return isDifficultyLevel(value) ? value : "year2";
}

function createQuestionStats(): Record<DifficultyLevel, number> {
  return Object.fromEntries(DIFFICULTY_LEVELS.map((level) => [level, 0])) as Record<DifficultyLevel, number>;
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

function isDifficultyLevel(value: string | null): value is DifficultyLevel {
  return DIFFICULTY_LEVELS.includes(value as DifficultyLevel);
}

function easeOutCubic(value: number): number {
  return 1 - Math.pow(1 - value, 3);
}
