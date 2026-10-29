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
  train?: { time: number; initialTime: number; light: THREE.Mesh<THREE.BoxGeometry, THREE.MeshLambertMaterial> };
}

interface Vehicle {
  mesh: THREE.Group;
  laneIndex: number;
  width: number;
  initialX: number;
  x: number;
  direction: -1 | 1;
  speed: number;
  platformHeight?: number;
}

interface CheckpointProblem {
  problem: MathProblem;
  solved: boolean;
  mesh?: THREE.Mesh;
  tick?: THREE.Group;
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
const CHECKPOINT_PROBLEM_COUNT = 1;
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
  private readonly livesDisplay: HTMLElement;
  private readonly livesElement: HTMLElement;
  private readonly difficultyStatsElement: HTMLElement;
  private readonly questionText: HTMLElement;
  private readonly answerEntry: HTMLElement;
  private readonly answerDisplay: HTMLElement;
  private readonly answerFeedback: HTMLElement;
  private readonly restartButton: HTMLButtonElement;
  private playerLane = START_LANE;
  private targetLane = START_LANE;
  private selectedSlotIndex = START_SLOT_INDEX;
  private hopProgress = 1;
  private hopStartX = PROBLEM_SLOTS[START_SLOT_INDEX];
  private hopStartZ = laneIndexToZ(START_LANE);
  private hopStartY = 0;
  private hopEndY = 0;
  private hopEndX = PROBLEM_SLOTS[START_SLOT_INDEX];
  private hopEndZ = laneIndexToZ(START_LANE);
  private answerText = "";
  private gameOver = false;
  private roundPaused = false;
  private maxLaneReached = 0;
  private bestLaneReached = Number(localStorage.getItem("hop-lane-best") ?? 0);
  private readonly shouldSaveProgress = readSaveProgressSetting();
  private skips = 1;
  private answersThisGame = 0;
  private readonly skipButton: HTMLButtonElement;
  private readonly maxLives = readLivesSetting();
  private readonly baseDifficulty = readBaseDifficultySetting();
  private readonly questionsAnsweredByDifficulty = createQuestionStats();
  private readonly savedUnlockedCheckpoints = new Set<number>([START_LANE]);
  private livesRemaining = this.maxLives;
  private pendingResultAction: (() => void) | undefined;
  private playerSquashed = false;
  private playerFlashTime = 0;
  private drowningTime: number | undefined;
  private readonly splash: THREE.Group;
  private animationId = 0;
  private displayedTargetLane: number | undefined;
  private queuedForwardHops = 0;

  constructor(
    private readonly gameScene: GameScene,
    private readonly input: InputController,
  ) {
    this.scoreElement = requireElement("#score");
    this.bestElement = requireElement("#best");
    this.livesDisplay = requireElement("#lives-display");
    this.livesElement = requireElement("#lives");
    this.difficultyStatsElement = requireElement("#difficulty-stats");
    this.questionText = requireElement("#question-text");
    this.answerEntry = requireElement(".live-answer");
    this.answerDisplay = requireElement("#answer-input");
    this.answerFeedback = requireElement("#answer-feedback");
    this.skipButton = requireElement("#skip-button");
    this.skipButton.addEventListener("click", () => { this.skipQuestion(); this.skipButton.blur(); });
    this.restartButton = requireElement("#restart-button");
    this.restartButton.addEventListener("click", () => this.handleResultButton());

    this.player = this.gameScene.createPlayer();
    this.splash = this.gameScene.createSplash();
    this.targetHighlight = this.gameScene.createQuestionHighlight();
    this.gameScene.scene.add(this.player, this.targetHighlight);

    try {
      const saved = JSON.parse(sessionStorage.getItem("hop-lane-session-stats") ?? "{}");
      for (const level of DIFFICULTY_LEVELS) {
        if (Number.isInteger(saved[level]) && saved[level] >= 0) this.questionsAnsweredByDifficulty[level] = saved[level];
      }
    } catch { /* Start a fresh session if stored data is invalid. */ }
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
    if (this.input.consumeBackward()) {
      this.queuedForwardHops = 0;
      this.advancePlayer(-1);
    }

    const forwardPresses = this.input.consumeAdvance();
    if (!this.gameOver && !this.roundPaused) this.queuedForwardHops += forwardPresses;

    this.updatePlayer(delta);
    this.updateVehicles(delta);
    this.checkCollisions();
    if (!this.gameOver && !this.roundPaused && this.hopProgress >= 1 && this.queuedForwardHops > 0) {
      this.queuedForwardHops -= 1;
      this.advancePlayer();
      if (this.hopProgress >= 1) this.queuedForwardHops = 0;
    }
    this.ensureWorldAhead();
    this.updateSuccessTick(delta);
    this.updateSquashedPlayer(delta);
    this.updateDrowning(delta);
    this.updateTargetHighlight();
    this.gameScene.updateCamera(this.player.position.z, delta);
    const targetLane = this.targetCheckpoint()?.laneIndex;
    if (!this.gameOver && !this.roundPaused && targetLane !== this.displayedTargetLane) {
      this.updateQuestionPanel();
      this.updateSkipButton();
    }
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
      plan.kind === "road" && plan.section % 4 !== 2 && plan.roadOffset < plan.outgoingRoadCount - 1,
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
      if (plan.section % 4 === 2) {
        lane.train = { time: plan.roadOffset * 2.5, initialTime: plan.roadOffset * 2.5, light: this.gameScene.addTrainTrack(visual.group, index) };
        this.addTrain(lane);
      } else if (plan.section % 4 === 1) {
        this.addLorries(lane, plan.section);
      } else {
        this.addVehicles(lane, plan.section);
      }
    } else if (plan.kind === "water") {
      if (plan.roadOffset === 0) this.addLilyPads(lane);
      else this.addCanalBoats(lane, plan.section);
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
      if (entry.tick) {
        checkpoint.visual.group.remove(entry.tick);
        entry.tick = undefined;
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
      const mesh = this.gameScene.createMathText(displayText, checkpoint.unlocked || entry.solved, entry.solved);
      mesh.position.set(0, 0.035, z + 0.05);
      checkpoint.visual.group.add(mesh);
      entry.mesh = mesh;

      if (entry.solved && !checkpoint.unlocked) {
        const tick = this.gameScene.createSuccessTick();
        tick.visible = true;
        tick.position.set(PROBLEM_SLOTS[problemIndex], 0.595, z - 0.77);
        checkpoint.visual.group.add(tick);
        entry.tick = tick;
      }
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

  private addTrain(lane: Lane): void {
    const mesh = this.gameScene.createExpressTrain();
    mesh.position.set(-100, 0.02, laneIndexToZ(lane.index));
    mesh.visible = false;
    lane.vehicles.push({ mesh, laneIndex: lane.index, width: 9, initialX: -100, x: -100, direction: 1, speed: 13 * 4 / 3 });
  }

  private addLorries(lane: Lane, section: number): void {
    const spacing = WORLD_HALF_WIDTH + 3.5;
    for (let i = 0; i < 2; i += 1) {
      const mesh = this.gameScene.createLorry(VEHICLE_STYLES[(section + lane.index + i) % VEHICLE_STYLES.length].body);
      const x = -WORLD_HALF_WIDTH - 3.5 + i * spacing + ((lane.index * 1.7) % spacing);
      mesh.position.set(x, 0.02, laneIndexToZ(lane.index));
      mesh.rotation.y = lane.direction === 1 ? 0 : Math.PI;
      lane.vehicles.push({ mesh, laneIndex: lane.index, width: 5.2, initialX: x, x, direction: lane.direction, speed: lane.speed * 0.8 });
    }
  }

  private addCanalBoats(lane: Lane, section: number): void {
    const spacing = (WORLD_HALF_WIDTH * 2 + 10) / 3;
    for (let i = 0; i < 3; i += 1) {
      const mesh = this.gameScene.createCanalBoat([0x295d71, 0x933b37, 0x31704e][(section + i) % 3]);
      const x = -WORLD_HALF_WIDTH - 5 + i * spacing + ((lane.index * 1.7) % spacing);
      mesh.position.set(x, 0, laneIndexToZ(lane.index));
      mesh.rotation.y = lane.direction === 1 ? 0 : Math.PI;
      lane.vehicles.push({ mesh, laneIndex: lane.index, width: 5.35, initialX: x, x, direction: lane.direction, speed: 1.8, platformHeight: 0.71 });
    }
  }

  private addLilyPads(lane: Lane): void {
    for (let x = -12; x <= 12; x += 4) {
      const mesh = this.gameScene.createLilyPad((x + lane.index) % 3 === 0);
      mesh.position.set(x, 0, laneIndexToZ(lane.index));
      lane.vehicles.push({ mesh, laneIndex: lane.index, width: 1.8, initialX: x, x, direction: 1, speed: 0, platformHeight: 0.1 });
    }
  }

  private handleAnswerInput(): void {
    const events = this.input.consumeAnswerInput();
    if (this.gameOver || this.roundPaused) {
      return;
    }

    if (events.clear || events.backspaceCount > 0 || events.characters.length > 0) {
      this.answerEntry.classList.remove("incorrect");
      if (this.answerFeedback.textContent === "Not quite — try again.") this.answerFeedback.textContent = "";
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
    const target = this.targetCheckpoint();
    if (events.characters.length && target && !target.unlocked && this.answerText && checkAnswer(target.problems[0].problem, this.answerText)) {
      this.submitAnswer();
      this.queuedForwardHops += events.submit;
      return;
    }

    if (events.submit > 0) {
      if (this.answerText.trim()) this.submitAnswer();
      else this.queuedForwardHops += events.submit;
    }
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

  private advancePlayer(direction: -1 | 1 = 1): void {
    if (this.gameOver || this.roundPaused || this.hopProgress < 1) {
      return;
    }

    const currentCheckpoint = this.currentCheckpoint();
    const nextCheckpoint = currentCheckpoint ? this.nextCheckpointFrom(currentCheckpoint) : undefined;
    if (direction === 1 && currentCheckpoint && nextCheckpoint && !nextCheckpoint.unlocked) {
      this.answerFeedback.textContent = "Answer the highlighted question first.";
      return;
    }

    if (direction === -1 && this.playerLane === START_LANE) return;
    this.targetLane = this.playerLane + direction;
    this.hopStartX = this.player.position.x;
    this.hopStartZ = this.player.position.z;
    this.hopStartY = this.player.position.y;
    const destination = this.lanes.get(this.targetLane);
    const platform = destination?.kind === "water"
      ? destination.vehicles.find((vehicle) => Math.abs(vehicle.x - this.player.position.x) <= vehicle.width / 2)
      : undefined;
    this.hopEndY = platform?.platformHeight ?? 0;
    this.hopEndX = this.player.position.x;
    this.hopEndZ = laneIndexToZ(this.targetLane);
    this.hopProgress = 0;
  }

  private updatePlayer(delta: number): void {
    if (this.gameOver || this.roundPaused) {
      return;
    }

    if (this.hopProgress >= 1) {
      return;
    }

    this.hopProgress = Math.min(1, this.hopProgress + delta * 4.56);
    const eased = this.hopProgress * this.hopProgress * (3 - 2 * this.hopProgress);
    const jump = Math.sin(this.hopProgress * Math.PI);
    this.player.position.x = THREE.MathUtils.lerp(this.hopStartX, this.hopEndX, eased);
    this.player.position.z = THREE.MathUtils.lerp(this.hopStartZ, this.hopEndZ, eased);
    this.player.position.y = THREE.MathUtils.lerp(this.hopStartY, this.hopEndY, eased) + jump * 1.25;
    this.player.rotation.x = jump * (this.targetLane > this.playerLane ? -0.18 : 0.18);
    this.player.scale.set(1 - jump * 0.12, 1 + jump * 0.23, 1 - jump * 0.08);
    for (const name of ["left-hind-leg", "right-hind-leg"]) {
      const leg = this.player.getObjectByName(name);
      if (leg) leg.rotation.x = jump * 0.65;
    }

    if (this.hopProgress === 1) {
      this.playerLane = this.targetLane;
      this.player.position.set(this.hopEndX, this.hopEndY, laneIndexToZ(this.playerLane));
      this.player.rotation.x = 0;
      this.player.scale.set(1, 1, 1);
      for (const name of ["left-hind-leg", "right-hind-leg"]) {
        const leg = this.player.getObjectByName(name);
        if (leg) leg.rotation.x = 0;
      }
      this.maxLaneReached = Math.max(this.maxLaneReached, this.playerLane);
      this.bestLaneReached = Math.max(this.bestLaneReached, this.maxLaneReached);
      localStorage.setItem("hop-lane-best", String(this.bestLaneReached));
      this.updateHud();
    }
  }

  private updateVehicles(delta: number): void {
    const minX = -WORLD_HALF_WIDTH - 5;
    const maxX = WORLD_HALF_WIDTH + 5;

    for (const lane of this.lanes.values()) {
      if (lane.train) {
        lane.train.time = (lane.train.time + delta) % 10;
        const trainEnd = 2 + 3 / (4 / 3);
        const active = lane.train.time >= 2 && lane.train.time < trainEnd;
        lane.train.light.material.color.setHex(lane.train.time >= 0 && lane.train.time < trainEnd && Math.floor(lane.train.time * 4) % 2 === 0 ? 0xff2525 : 0x541515);
        const train = lane.vehicles[0];
        train.x = active ? -WORLD_HALF_WIDTH - 5 + (lane.train.time - 2) * train.speed : -100;
        train.mesh.position.x = train.x;
        train.mesh.visible = active;
        continue;
      }
      for (const vehicle of lane.vehicles) {
        const carryingPlayer = lane.kind === "water" && !this.gameOver && !this.roundPaused && this.hopProgress >= 1
          && this.playerLane === lane.index && Math.abs(vehicle.x - this.player.position.x) <= vehicle.width / 2;
        vehicle.x += vehicle.direction * vehicle.speed * delta;

        if (vehicle.direction === 1 && vehicle.x > maxX) {
          vehicle.x = minX;
        } else if (vehicle.direction === -1 && vehicle.x < minX) {
          vehicle.x = maxX;
        }

        vehicle.mesh.position.x = vehicle.x;
        if (carryingPlayer) this.player.position.x += vehicle.direction * vehicle.speed * delta;
      }
    }
  }

  private checkCollisions(): void {
    if (this.gameOver || this.roundPaused) {
      return;
    }

    const lane = this.lanes.get(Math.round(-this.player.position.z / TILE_SIZE));
    if (lane?.kind === "water") {
      if (this.hopProgress < 1) return;
      const platform = lane.vehicles.find((vehicle) => Math.abs(vehicle.x - this.player.position.x) <= vehicle.width / 2);
      if (!platform || Math.abs(this.player.position.x) > WORLD_HALF_WIDTH) this.handleWaterFall();
      else this.player.position.y = platform.platformHeight ?? 0;
      return;
    }
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

    const selectedProblem = targetCheckpoint.problems[0];
    if (selectedProblem.solved) {
      this.answerText = "";
      this.selectNextUnsolvedProblem(targetCheckpoint);
      this.updateQuestionPanel();
      this.updateAnswerDisplay();
      return;
    }

    if (!checkAnswer(selectedProblem.problem, answer)) {
      this.answerEntry.classList.remove("incorrect");
      void this.answerEntry.offsetWidth;
      this.answerEntry.classList.add("incorrect");
      this.answerFeedback.textContent = "Not quite — try again.";
      return;
    }

    this.answerEntry.classList.remove("incorrect");
    selectedProblem.solved = true;
    this.questionsAnsweredByDifficulty[selectedProblem.problem.yearLevel as DifficultyLevel] += 1;
    this.answersThisGame += 1;
    if (this.answersThisGame % 4 === 0) this.skips += 1;
    sessionStorage.setItem("hop-lane-session-stats", JSON.stringify(this.questionsAnsweredByDifficulty));
    targetCheckpoint.unlocked = true;
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
    this.updateSkipButton();
    this.updateAnswerDisplay();
  }

  private skipQuestion(): void {
    const target = this.targetCheckpoint();
    if (this.gameOver || this.roundPaused || !target || target.unlocked || this.skips < 1) return;
    this.skips -= 1;
    this.answerEntry.classList.remove("incorrect");
    target.unlocked = true;
    this.saveUnlockedCheckpoint(target.laneIndex);
    this.gameScene.setSafeLaneState(target.visual.surface, "unlocked");
    this.answerText = "";
    this.refreshCheckpointText(target);
    this.updateHud();
  }

  private updateSkipButton(): void {
    const target = this.targetCheckpoint();
    this.skipButton.textContent = `Skip question (${this.skips})`;
    this.skipButton.disabled = this.gameOver || this.roundPaused || !target || target.unlocked || this.skips === 0;
  }

  private selectNextUnsolvedProblem(checkpoint: Checkpoint): void {
    const nextProblemIndex = checkpoint.problems.findIndex((entry) => !entry.solved);
    if (nextProblemIndex >= 0) {
      this.selectedSlotIndex = nextProblemIndex;
    }
  }

  private updateSuccessTick(delta: number): void {
    for (const lane of this.lanes.values()) {
      const checkpoint = lane.checkpoint;
      if (!checkpoint || checkpoint.unlocked) {
        continue;
      }

      for (const entry of checkpoint.problems) {
        if (entry.tick) {
          entry.tick.rotation.y += delta * Math.PI * 0.8;
        }
      }
    }
  }

  private squashPlayer(): void {
    this.playerSquashed = true;
    this.playerFlashTime = 0;
    this.player.visible = true;
    this.player.position.y = 0;
    this.player.rotation.set(0, 0, 0);
    this.player.scale.set(1.35, 0.16, 1.22);
  }

  private restorePlayerShape(): void {
    this.playerSquashed = false;
    this.playerFlashTime = 0;
    this.player.visible = true;
    this.player.scale.set(1, 1, 1);
    this.drowningTime = undefined;
    this.splash.visible = false;
    for (const name of ["left-hind-leg", "right-hind-leg"]) {
      const leg = this.player.getObjectByName(name);
      if (leg) leg.rotation.x = 0;
    }
  }

  private updateSquashedPlayer(delta: number): void {
    if (!this.playerSquashed) {
      return;
    }

    this.playerFlashTime += delta;
    this.player.visible = Math.floor(this.playerFlashTime * 8) % 2 === 0;
  }

  private resetRound(feedback = ""): void {
    this.queuedForwardHops = 0;
    this.gameOver = false;
    this.roundPaused = false;
    this.pendingResultAction = undefined;
    this.answerEntry.hidden = false;
    this.answerEntry.classList.remove("incorrect");
    this.restartButton.textContent = "Restart";
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
    this.restorePlayerShape();
    this.player.position.set(PROBLEM_SLOTS[START_SLOT_INDEX], 0, laneIndexToZ(START_LANE));
    this.player.rotation.set(0, 0, 0);
    this.resetVehicles();
    this.resetCheckpoints();
    this.updateHud();
    this.answerFeedback.textContent = feedback;
  }

  private returnToLastSafeLane(feedback = ""): void {
    this.queuedForwardHops = 0;
    const safeLaneIndex = this.lastSafeLaneIndex();
    this.gameOver = false;
    this.roundPaused = false;
    this.pendingResultAction = undefined;
    this.answerEntry.hidden = false;
    this.answerEntry.classList.remove("incorrect");
    this.restartButton.textContent = "Restart";
    this.restartButton.hidden = true;
    this.playerLane = safeLaneIndex;
    this.targetLane = safeLaneIndex;
    this.hopProgress = 1;
    this.answerText = "";
    this.hopStartX = PROBLEM_SLOTS[this.selectedSlotIndex];
    this.hopEndX = PROBLEM_SLOTS[this.selectedSlotIndex];
    this.hopStartZ = laneIndexToZ(safeLaneIndex);
    this.hopEndZ = laneIndexToZ(safeLaneIndex);
    this.restorePlayerShape();
    this.player.position.set(PROBLEM_SLOTS[this.selectedSlotIndex], 0, laneIndexToZ(safeLaneIndex));
    this.player.rotation.set(0, 0, 0);
    this.updateHud();
    this.answerFeedback.textContent = feedback;
  }

  private restartGame(): void {
    this.livesRemaining = this.maxLives;
    this.skips = 1;
    this.answersThisGame = 0;
    this.resetRound();
  }

  private handleTrafficHit(): void {
    this.livesRemaining -= 1;
    this.updateLivesDisplay();
    this.squashPlayer();
    if (this.livesRemaining <= 0) {
      this.endRound(
        "Squashed by traffic",
        "No lives remaining.",
        true,
      );
      return;
    }

    this.showResult(
      "Squashed by traffic",
      `Lives remaining: ${this.livesRemaining}`,
      "Continue",
      true,
      () => this.returnToLastSafeLane(),
    );
  }

  private handleWaterFall(): void {
    this.queuedForwardHops = 0;
    this.livesRemaining -= 1;
    this.updateLivesDisplay();
    this.roundPaused = true;
    this.drowningTime = 0;
    this.answerEntry.hidden = true;
    this.skipButton.disabled = true;
    this.targetHighlight.visible = false;
    this.questionText.textContent = "Splash!";
    this.answerFeedback.textContent = "";
    this.splash.position.set(this.player.position.x, 0.04, this.player.position.z);
    this.splash.visible = true;
  }

  private updateDrowning(delta: number): void {
    if (this.drowningTime === undefined) return;
    this.drowningTime = Math.min(1, this.drowningTime + delta / 1.1);
    const t = this.drowningTime;
    this.player.position.y = -1.1 * t;
    this.player.rotation.z = Math.sin(t * Math.PI * 3) * 0.25 * (1 - t);
    this.player.scale.setScalar(1 - t * 0.25);
    this.splash.scale.setScalar(0.35 + t * 2.1);
    this.splash.traverse((object) => {
      if (object instanceof THREE.Mesh && object.material instanceof THREE.MeshBasicMaterial) object.material.opacity = 0.8 * (1 - t);
    });
    if (t < 1) return;
    this.drowningTime = undefined;
    this.splash.visible = false;
    this.player.visible = false;
    if (this.livesRemaining <= 0) {
      this.endRound("Splash!", "You fell in the canal. No lives remaining.", true);
    } else {
      this.showResult("Splash!", `You fell in the canal. Lives remaining: ${this.livesRemaining}`, "Continue", true, () => this.returnToLastSafeLane());
    }
  }

  private showResult(
    title: string,
    detail: string,
    buttonText: string,
    hideAnswerEntry: boolean,
    action: () => void,
  ): void {
    this.queuedForwardHops = 0;
    this.roundPaused = true;
    this.answerText = "";
    this.skipButton.disabled = true;
    this.targetHighlight.visible = false;
    this.questionText.textContent = title;
    this.answerFeedback.textContent = detail;
    this.answerEntry.hidden = hideAnswerEntry;
    this.restartButton.textContent = buttonText;
    this.restartButton.hidden = false;
    this.pendingResultAction = action;
    this.updateAnswerDisplay();
  }

  private endRound(title: string, detail: string, hideAnswerEntry: boolean): void {
    this.queuedForwardHops = 0;
    this.gameOver = true;
    this.answerText = "";
    this.skipButton.disabled = true;
    this.targetHighlight.visible = false;
    this.questionText.textContent = title;
    this.answerFeedback.textContent = detail;
    this.answerEntry.hidden = hideAnswerEntry;
    this.restartButton.textContent = "Restart";
    this.restartButton.hidden = false;
    this.pendingResultAction = () => this.restartGame();
    this.updateAnswerDisplay();
  }

  private handleResultButton(): void {
    const action = this.pendingResultAction ?? (() => this.restartGame());
    action();
  }

  private resetVehicles(): void {
    for (const lane of this.lanes.values()) {
      if (lane.train) lane.train.time = lane.train.initialTime;
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
        if (entry.tick) {
          lane.checkpoint.visual.group.remove(entry.tick);
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

  private lastSafeLaneIndex(): number {
    const laneAtPlayerPosition = Math.round(-this.player.position.z / TILE_SIZE);
    const referenceLane = Math.max(this.playerLane, laneAtPlayerPosition);
    let safeLaneIndex = START_LANE;

    for (const lane of this.lanes.values()) {
      if (lane.checkpoint && lane.index <= referenceLane && lane.index >= safeLaneIndex) {
        safeLaneIndex = lane.index;
      }
    }

    return safeLaneIndex;
  }

  private targetCheckpoint(): Checkpoint | undefined {
    const checkpoints = [...this.lanes.values()]
      .filter((lane) => lane.checkpoint && lane.index > this.playerLane)
      .sort((a, b) => a.index - b.index);
    this.gameScene.camera.updateMatrixWorld();
    return checkpoints.find((lane) => {
      if (lane.checkpoint!.unlocked) return false;
      const point = new THREE.Vector3(0, 0, laneIndexToZ(lane.index)).project(this.gameScene.camera);
      return point.x >= -1 && point.x <= 1 && point.y >= -1 && point.y <= 1 && point.z >= -1 && point.z <= 1;
    })?.checkpoint;
  }

  private nextCheckpointFrom(checkpoint: Checkpoint): Checkpoint | undefined {
    const targetLaneIndex = checkpoint.laneIndex + checkpoint.outgoingRoadCount + 1;
    return this.lanes.get(targetLaneIndex)?.checkpoint;
  }

  private updateTargetHighlight(): void {
    const checkpoint = this.targetCheckpoint();
    if (this.gameOver || this.roundPaused || !checkpoint || checkpoint.unlocked) {
      this.targetHighlight.visible = false;
      return;
    }

    this.targetHighlight.visible = true;
    this.targetHighlight.position.set(
      0,
      0.045,
      laneIndexToZ(checkpoint.laneIndex) + 0.05,
    );
  }

  private updateHud(): void {
    this.scoreElement.textContent = String(this.maxLaneReached);
    this.bestElement.textContent = String(this.bestLaneReached);
    this.updateLivesDisplay();
    this.updateDifficultyStats();
    this.updateQuestionPanel();
    this.updateAnswerDisplay();
    this.updateSkipButton();
  }

  private updateLivesDisplay(): void {
    this.livesElement.textContent = String(Math.max(0, this.livesRemaining));
    this.livesDisplay.hidden = this.maxLives <= 1;
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

    this.difficultyStatsElement.textContent = `${total} correct this session`;
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

    const targetCheckpoint = this.targetCheckpoint();
    this.displayedTargetLane = targetCheckpoint?.laneIndex;
    if (!targetCheckpoint) {
      this.questionText.textContent = "Hop forward to see more questions";
      this.answerFeedback.textContent = "";
      return;
    }

    const selectedProblem = targetCheckpoint.problems[0];
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
    const crossingCount = (n: number): number => n % 4 === 3
      ? 2
      : n % 4 === 2
        ? 1 + (Math.floor(n / 4) % 2)
        : ROAD_GROUP_SEQUENCE[n % ROAD_GROUP_SEQUENCE.length];
    const outgoingRoadCount = crossingCount(section);
    const incomingRoadCount = section === 0 ? crossingCount(0) : crossingCount(section - 1);

    if (index === safeIndex) {
      return { kind: "grass", section, incomingRoadCount, outgoingRoadCount, roadOffset: -1 };
    }

    if (index > safeIndex && index <= safeIndex + outgoingRoadCount) {
      return {
        kind: section % 4 === 3 ? "water" : "road",
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

function readLivesSetting(): number {
  return readPositiveIntegerQuerySetting([
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
