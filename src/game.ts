import * as THREE from "three";
import { InputController } from "./input";
import {
  GameScene,
  LANE_DEPTH,
  TILE_SIZE,
  WORLD_HALF_WIDTH,
  laneIndexToZ,
  type LaneKind,
  type VehicleStyle,
} from "./scene";

interface Lane {
  index: number;
  kind: LaneKind;
  direction: -1 | 1;
  speed: number;
  vehicles: Vehicle[];
}

interface Vehicle {
  mesh: THREE.Group;
  laneIndex: number;
  width: number;
  x: number;
  direction: -1 | 1;
  speed: number;
}

const START_LANE = 0;
const PLAYER_SIZE = 0.78;
const ROAD_PATTERN = ["grass", "road", "road", "grass", "road", "grass", "road", "road"] as const;
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
  private playerLane = START_LANE;
  private targetLane = START_LANE;
  private hopProgress = 1;
  private hopStartZ = laneIndexToZ(START_LANE);
  private hopEndZ = laneIndexToZ(START_LANE);
  private maxLaneReached = 0;
  private bestLaneReached = Number(localStorage.getItem("hop-lane-best") ?? 0);
  private animationId = 0;

  constructor(
    private readonly gameScene: GameScene,
    private readonly input: InputController,
  ) {
    this.scoreElement = document.querySelector<HTMLElement>("#score") ?? document.body;
    this.bestElement = document.querySelector<HTMLElement>("#best") ?? document.body;
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
    for (let index = 0; index < 24; index += 1) {
      this.createLane(index);
    }
  }

  private ensureWorldAhead(): void {
    const highestLane = Math.max(...this.lanes.keys());
    for (let index = highestLane + 1; index <= this.playerLane + 24; index += 1) {
      this.createLane(index);
    }
  }

  private createLane(index: number): Lane {
    const kind = this.getLaneKind(index);
    this.gameScene.createLane(index, kind);

    const lane: Lane = {
      index,
      kind,
      direction: index % 2 === 0 ? 1 : -1,
      speed: 3.2 + (index % 5) * 0.35,
      vehicles: [],
    };

    this.lanes.set(index, lane);

    if (kind === "road") {
      this.addVehicles(lane);
    }

    return lane;
  }

  private getLaneKind(index: number): LaneKind {
    if (index === START_LANE || index === 1) {
      return "grass";
    }

    return ROAD_PATTERN[index % ROAD_PATTERN.length];
  }

  private addVehicles(lane: Lane): void {
    const count = 2 + (lane.index % 3 === 0 ? 1 : 0);
    const spacing = (WORLD_HALF_WIDTH * 2 + 6) / count;

    for (let i = 0; i < count; i += 1) {
      const style = VEHICLE_STYLES[(lane.index + i) % VEHICLE_STYLES.length];
      const mesh = this.gameScene.createVehicle(style);
      const x = -WORLD_HALF_WIDTH - 3 + i * spacing + ((lane.index * 1.7) % spacing);
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

  private resetPlayer(): void {
    this.playerLane = START_LANE;
    this.targetLane = START_LANE;
    this.hopProgress = 1;
    this.maxLaneReached = 0;
    this.player.position.set(0, 0, laneIndexToZ(START_LANE));
    this.player.rotation.set(0, 0, 0);
    this.updateHud();
  }

  private updateHud(): void {
    this.scoreElement.textContent = String(this.maxLaneReached);
    this.bestElement.textContent = String(this.bestLaneReached);
  }
}

function easeOutCubic(value: number): number {
  return 1 - Math.pow(1 - value, 3);
}
