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
  roadCount: number;
  yearLevel: "year1" | "year2" | "year3" | "year4";
  problems: CheckpointProblem[];
  unlocked: boolean;
  visual: LaneVisual;
}

interface LanePlan {
  kind: LaneKind;
  section: number;
  roadCount: number;
}

const START_LANE = 0;
const PLAYER_SIZE = 0.78;
const CHECKPOINT_PROBLEM_COUNT = 3;
const ROAD_GROUP_SEQUENCE = [1, 2, 3, 4] as const;
const PROBLEM_SLOTS = [-6, 0, 6];
const VEHICLE_STYLES: VehicleStyle[] = [
  { body: 0xff6d3a, cabin: 0xffffff, length: 2.6 },
  { body: 0x00a8d8, cabin: 0xf0ffff, length: 2.35 },
  { body: 0xf45b69, cabin: 0xfff8f0, length: 2.15 },
  { body: 0xf4c95d, cabin: 0xffffff, length: 3.0 },
  { body: 0x8f65ff, cabin: 0xfffcff, length: 2.45 },
];

export class Game {
  private readonly player: THREE.Group;
  private readonly lanes = new Map<number, Lane>();
  private readonly clock = new THREE.Clock();
  private readonly scoreElement: HTMLElement;
  private readonly bestElement: HTMLElement;
  private readonly answerForm: HTMLFormElement;
  private readonly answerInput: HTMLInputElement;
  private readonly answerButton: HTMLButtonElement;
  private readonly answerLabel: HTMLElement;
  private readonly questionText: HTMLElement;
  private readonly answerFeedback: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private playerLane = START_LANE;
  private targetLane = START_LANE;
  private hopProgress = 1;
  private hopStartZ = laneIndexToZ(START_LANE);
  private hopEndZ = laneIndexToZ(START_LANE);
  private maxLaneReached = 0;
  private bestLaneReached = Number(localStorage.getItem("hop-lane-best") ?? 0);
  private animationId = 0;

  private readonly handleAnswerSubmit = (event: SubmitEvent) => {
    event.preventDefault();
    this.submitAnswer();
  };

  constructor(
    private readonly gameScene: GameScene,
    private readonly input: InputController,
  ) {
    this.scoreElement = requireElement("#score");
    this.bestElement = requireElement("#best");
    this.answerForm = requireElement<HTMLFormElement>("#answer-panel");
    this.answerInput = requireElement<HTMLInputElement>("#answer-input");
    this.answerButton = requireElement<HTMLButtonElement>("#answer-panel button");
    this.answerLabel = requireElement("#answer-label");
    this.questionText = requireElement("#question-text");
    this.answerFeedback = requireElement("#answer-feedback");
    this.canvas = requireElement<HTMLCanvasElement>("#game-canvas");
    this.answerForm.addEventListener("submit", this.handleAnswerSubmit);

    this.player = this.gameScene.createPlayer();
    this.gameScene.scene.add(this.player);

    this.buildInitialWorld();
    this.resetPlayer();
    this.updateHud();
  }

  start(): void {
    this.clock.start();
    this.tick();
  }

  stop(): void {
    cancelAnimationFrame(this.animationId);
    this.answerForm.removeEventListener("submit", this.handleAnswerSubmit);
  }

  handleResize(): void {
    this.gameScene.resize();
  }

  private tick = (): void => {
    const delta = Math.min(this.clock.getDelta(), 0.05);

    if (this.input.consumeAdvance()) {
      this.advancePlayer();
    }

    this.updatePlayer(delta);
    this.updateVehicles(delta);
    this.checkCollisions();
    this.ensureWorldAhead();
    this.gameScene.updateCamera(this.player.position.z, delta);
    this.gameScene.render();

    this.animationId = requestAnimationFrame(this.tick);
  };

  private buildInitialWorld(): void {
    for (let index = 0; index < 28; index += 1) {
      this.createLane(index);
    }
  }

  private ensureWorldAhead(): void {
    const highestLane = Math.max(...this.lanes.keys());
    for (let index = highestLane + 1; index <= this.playerLane + 28; index += 1) {
      this.createLane(index);
    }
  }

  private createLane(index: number): Lane {
    const plan = getLanePlan(index);
    const isCheckpoint = plan.kind === "grass";
    const visual = this.gameScene.createLane(
      index,
      plan.kind,
      isCheckpoint ? "locked" : "unlocked",
    );

    const lane: Lane = {
      index,
      kind: plan.kind,
      direction: (plan.section + index) % 2 === 0 ? 1 : -1,
      speed: 3.1 + (plan.section % 4) * 0.42 + plan.roadCount * 0.18,
      vehicles: [],
    };

    if (isCheckpoint) {
      lane.checkpoint = this.createCheckpoint(index, plan.roadCount, visual);
    }

    this.lanes.set(index, lane);

    if (plan.kind === "road") {
      this.addVehicles(lane, plan.section);
    }

    return lane;
  }

  private createCheckpoint(index: number, roadCount: number, visual: LaneVisual): Checkpoint {
    const checkpoint: Checkpoint = {
      laneIndex: index,
      roadCount,
      yearLevel: roadCountToYearLevel(roadCount),
      problems: Array.from({ length: CHECKPOINT_PROBLEM_COUNT }, () => ({
        problem: generateProblem({ yearLevel: roadCountToYearLevel(roadCount) }),
        solved: false,
      })),
      unlocked: false,
      visual,
    };

    this.refreshCheckpointText(checkpoint);
    return checkpoint;
  }

  private refreshCheckpointText(checkpoint: Checkpoint): void {
    const z = laneIndexToZ(checkpoint.laneIndex);

    checkpoint.problems.forEach((entry, problemIndex) => {
      if (entry.mesh) {
        checkpoint.visual.group.remove(entry.mesh);
      }

      const displayText = entry.solved
        ? `OK ${entry.problem.expression_short}`
        : entry.problem.expression_short;
      const mesh = this.gameScene.createMathText(displayText, entry.solved);
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
        x,
        direction: lane.direction,
        speed: lane.speed,
      });
    }
  }

  private advancePlayer(): void {
    if (this.hopProgress < 1) {
      return;
    }

    const checkpoint = this.currentCheckpoint();
    if (checkpoint && !checkpoint.unlocked) {
      this.answerFeedback.textContent = "Answer all three questions first.";
      this.answerInput.focus();
      return;
    }

    this.targetLane = this.playerLane + 1;
    this.hopStartZ = this.player.position.z;
    this.hopEndZ = laneIndexToZ(this.targetLane);
    this.hopProgress = 0;
  }

  private updatePlayer(delta: number): void {
    if (this.hopProgress >= 1) {
      return;
    }

    this.hopProgress = Math.min(1, this.hopProgress + delta * 7.4);
    const eased = easeOutCubic(this.hopProgress);
    this.player.position.z = THREE.MathUtils.lerp(this.hopStartZ, this.hopEndZ, eased);
    this.player.position.y = Math.sin(this.hopProgress * Math.PI) * 0.72;
    this.player.rotation.x = Math.sin(this.hopProgress * Math.PI) * -0.12;

    if (this.hopProgress === 1) {
      this.playerLane = this.targetLane;
      this.player.position.set(0, 0, laneIndexToZ(this.playerLane));
      this.player.rotation.x = 0;
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
        this.resetPlayer();
        return;
      }
    }
  }

  private submitAnswer(): void {
    const checkpoint = this.currentCheckpoint();
    const activeProblem = checkpoint?.problems.find((entry) => !entry.solved);

    if (!checkpoint || checkpoint.unlocked || !activeProblem) {
      this.answerFeedback.textContent = "This lane is already unlocked.";
      this.answerInput.value = "";
      return;
    }

    const answer = this.answerInput.value.trim();
    if (!answer) {
      this.answerFeedback.textContent = "Type an answer first.";
      return;
    }

    if (!checkAnswer(activeProblem.problem, answer)) {
      this.answerFeedback.textContent = "Not quite. Try that one again.";
      this.answerInput.select();
      return;
    }

    activeProblem.solved = true;
    this.answerInput.value = "";
    this.refreshCheckpointText(checkpoint);

    if (checkpoint.problems.every((entry) => entry.solved)) {
      checkpoint.unlocked = true;
      this.gameScene.setSafeLaneState(checkpoint.visual.surface, "unlocked");
      this.updateQuestionPanel();
      this.answerFeedback.textContent = "Lane unlocked. Press Space to cross.";
      this.canvas.focus({ preventScroll: true });
    } else {
      const remaining = checkpoint.problems.filter((entry) => !entry.solved).length;
      this.updateQuestionPanel();
      this.answerFeedback.textContent = `Correct. ${remaining} to go.`;
    }
  }

  private resetPlayer(): void {
    this.playerLane = START_LANE;
    this.targetLane = START_LANE;
    this.hopProgress = 1;
    this.maxLaneReached = 0;
    this.player.position.set(0, 0, laneIndexToZ(START_LANE));
    this.player.rotation.set(0, 0, 0);
    this.updateHud();
  }

  private currentCheckpoint(): Checkpoint | undefined {
    return this.lanes.get(this.playerLane)?.checkpoint;
  }

  private updateHud(): void {
    this.scoreElement.textContent = String(this.maxLaneReached);
    this.bestElement.textContent = String(this.bestLaneReached);
    this.updateQuestionPanel();
  }

  private updateQuestionPanel(): void {
    const checkpoint = this.currentCheckpoint();
    if (!checkpoint) {
      this.answerLabel.textContent = "Crossing";
      this.questionText.textContent = "Keep hopping";
      this.answerFeedback.textContent = "Reach the next yellow maths lane.";
      this.answerInput.disabled = true;
      this.answerButton.disabled = true;
      return;
    }

    if (checkpoint.unlocked) {
      this.answerLabel.textContent = "Ready to cross";
      this.questionText.textContent = `${checkpoint.roadCount} road lane${checkpoint.roadCount === 1 ? "" : "s"} ahead`;
      this.answerFeedback.textContent = "Unlocked. Press Space to hop.";
      this.answerInput.disabled = true;
      this.answerButton.disabled = true;
      return;
    }

    const activeProblem = checkpoint.problems.find((entry) => !entry.solved);
    this.answerLabel.textContent = "Solve to unlock";
    this.questionText.textContent = activeProblem
      ? `${activeProblem.problem.expression} = ?`
      : "Unlocked";
    this.answerFeedback.textContent = `Year ${checkpoint.yearLevel.slice(-1)} challenge. Solve all three.`;
    this.answerInput.disabled = false;
    this.answerButton.disabled = false;
  }
}

function getLanePlan(index: number): LanePlan {
  let safeIndex = 0;
  let section = 0;

  while (true) {
    const roadCount = ROAD_GROUP_SEQUENCE[section % ROAD_GROUP_SEQUENCE.length];
    if (index === safeIndex) {
      return { kind: "grass", section, roadCount };
    }

    if (index > safeIndex && index <= safeIndex + roadCount) {
      return { kind: "road", section, roadCount };
    }

    safeIndex += roadCount + 1;
    section += 1;
  }
}

function roadCountToYearLevel(roadCount: number): Checkpoint["yearLevel"] {
  if (roadCount === 1) {
    return "year1";
  }
  if (roadCount === 2) {
    return "year2";
  }
  if (roadCount === 3) {
    return "year3";
  }
  return "year4";
}

function requireElement<T extends HTMLElement = HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing required element: ${selector}`);
  }
  return element;
}

function easeOutCubic(value: number): number {
  return 1 - Math.pow(1 - value, 3);
}
