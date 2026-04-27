import * as THREE from "three";

export const TILE_SIZE = 2;
export const WORLD_HALF_WIDTH = 14;
export const LANE_DEPTH = TILE_SIZE;

const geometryCache = new Map<string, THREE.BoxGeometry>();
const materialCache = new Map<string, THREE.MeshLambertMaterial>();

export type LaneKind = "grass" | "road";
export type SafeLaneState = "locked" | "unlocked";

export interface VehicleStyle {
  body: number;
  cabin: number;
  length: number;
}

export interface LaneVisual {
  group: THREE.Group;
  surface: THREE.Mesh<THREE.BoxGeometry, THREE.MeshLambertMaterial>;
}

export class GameScene {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.OrthographicCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly world = new THREE.Group();
  readonly vehicles = new THREE.Group();
  readonly decorations = new THREE.Group();

  private readonly ambient = new THREE.HemisphereLight(0xffffff, 0x7a8b53, 1.9);
  private readonly sun = new THREE.DirectionalLight(0xffffff, 2.6);
  private readonly targetCameraPosition = new THREE.Vector3(10, 13, 12);
  private readonly cameraLookAt = new THREE.Vector3(0, 0, -6);
  private readonly canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      canvas,
      powerPreference: "high-performance",
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x91d6ff);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.camera = new THREE.OrthographicCamera(-12, 12, 8, -8, 0.1, 100);
    this.camera.position.copy(this.targetCameraPosition);
    this.camera.lookAt(this.cameraLookAt);

    this.sun.position.set(-8, 18, 9);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.left = -24;
    this.sun.shadow.camera.right = 24;
    this.sun.shadow.camera.top = 24;
    this.sun.shadow.camera.bottom = -24;

    this.scene.add(this.ambient, this.sun, this.world, this.vehicles, this.decorations);
    this.resize();
  }

  resize(): void {
    const width = this.canvas.clientWidth || window.innerWidth;
    const height = this.canvas.clientHeight || window.innerHeight;
    const aspect = width / height;
    const viewHeight = height < 620 ? 14.5 : 16.5;
    const viewWidth = viewHeight * aspect;

    this.camera.left = -viewWidth / 2;
    this.camera.right = viewWidth / 2;
    this.camera.top = viewHeight / 2;
    this.camera.bottom = -viewHeight / 2;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  updateCamera(playerZ: number, delta: number): void {
    const desiredPosition = this.targetCameraPosition.clone();
    desiredPosition.z = playerZ + 12;
    this.camera.position.lerp(desiredPosition, Math.min(1, delta * 4));

    this.cameraLookAt.z = playerZ - 3.5;
    this.camera.lookAt(this.cameraLookAt);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  createLane(index: number, kind: LaneKind, safeState: SafeLaneState = "unlocked"): LaneVisual {
    const lane = new THREE.Group();
    const z = laneIndexToZ(index);
    const isRoad = kind === "road";
    const base = new THREE.Mesh(
      getGeometry(WORLD_HALF_WIDTH * 2, 0.22, LANE_DEPTH),
      new THREE.MeshLambertMaterial({ color: isRoad ? 0x505a65 : safeLaneColor(safeState) }),
    );
    base.position.set(0, -0.11, z);
    base.castShadow = true;
    base.receiveShadow = true;
    lane.add(base);

    if (isRoad) {
      this.addRoadMarks(lane, z);
    } else {
      this.addGrassDetails(lane, index, z);
    }

    this.world.add(lane);
    return { group: lane, surface: base };
  }

  setSafeLaneState(surface: THREE.Mesh<THREE.BoxGeometry, THREE.MeshLambertMaterial>, state: SafeLaneState): void {
    surface.material.color.setHex(safeLaneColor(state));
  }

  createMathText(expression: string, unlocked: boolean): THREE.Mesh {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 160;

    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Could not create math text canvas.");
    }

    context.clearRect(0, 0, canvas.width, canvas.height);
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font = "900 56px Inter, Arial, sans-serif";
    context.lineWidth = 10;
    context.strokeStyle = unlocked ? "rgba(255,255,255,0.9)" : "rgba(255,248,188,0.95)";
    context.fillStyle = "#17202a";
    context.strokeText(expression, canvas.width / 2, canvas.height / 2);
    context.fillText(expression, canvas.width / 2, canvas.height / 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.anisotropy = Math.min(this.renderer.capabilities.getMaxAnisotropy(), 8);
    texture.needsUpdate = true;

    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(3.9, 1.1), material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.renderOrder = 2;
    return mesh;
  }

  createQuestionHighlight(): THREE.Group {
    const group = new THREE.Group();
    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(4.3, 1.18),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        opacity: 0.42,
        transparent: true,
        depthWrite: false,
      }),
    );
    plate.rotation.x = -Math.PI / 2;
    plate.renderOrder = 1;

    const pointer = new THREE.Mesh(
      new THREE.ConeGeometry(0.35, 0.55, 4),
      new THREE.MeshLambertMaterial({ color: 0xff3d3d }),
    );
    pointer.position.set(0, 0.55, -0.82);
    pointer.rotation.y = Math.PI / 4;
    pointer.castShadow = true;

    group.add(plate, pointer);
    group.visible = false;
    return group;
  }

  createPlayer(): THREE.Group {
    const player = new THREE.Group();
    player.add(block(1.05, 0.58, 1.05, 0x38d659));

    const head = block(0.84, 0.46, 0.72, 0x46e46d);
    head.position.set(0, 0.48, -0.15);
    player.add(head);

    const belly = block(0.54, 0.14, 0.38, 0xf8ffe0);
    belly.position.set(0, 0.03, -0.47);
    player.add(belly);

    const eyeLeft = block(0.2, 0.18, 0.16, 0xf6fff6);
    eyeLeft.position.set(-0.27, 0.78, -0.44);
    const eyeRight = eyeLeft.clone();
    eyeRight.position.x = 0.27;
    const pupilLeft = block(0.09, 0.08, 0.05, 0x162222);
    pupilLeft.position.set(-0.27, 0.79, -0.53);
    const pupilRight = pupilLeft.clone();
    pupilRight.position.x = 0.27;
    player.add(eyeLeft, eyeRight, pupilLeft, pupilRight);

    player.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });

    return player;
  }

  createVehicle(style: VehicleStyle): THREE.Group {
    const car = new THREE.Group();
    const body = block(style.length, 0.62, 1.08, style.body);
    body.position.y = 0.28;
    const nose = block(style.length * 0.72, 0.2, 1.18, lighten(style.body, 1.18));
    nose.position.y = 0.68;
    const cabin = block(style.length * 0.45, 0.58, 0.78, style.cabin);
    cabin.position.set(style.length * 0.05, 0.94, 0);

    const wheelGeometry = getGeometry(0.32, 0.32, 0.2);
    const wheelMaterial = getMaterial(0x16181d);
    const wheelInset = style.length * 0.31;
    for (const x of [-wheelInset, wheelInset]) {
      for (const z of [-0.52, 0.52]) {
        const wheel = new THREE.Mesh(wheelGeometry, wheelMaterial);
        wheel.position.set(x, 0.12, z);
        wheel.castShadow = true;
        car.add(wheel);
      }
    }

    car.add(body, nose, cabin);
    car.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });

    this.vehicles.add(car);
    return car;
  }

  private addRoadMarks(lane: THREE.Group, z: number): void {
    for (let x = -WORLD_HALF_WIDTH + 2; x < WORLD_HALF_WIDTH; x += 4) {
      const stripe = block(1.35, 0.035, 0.11, 0xc7d0db);
      stripe.position.set(x, 0.025, z);
      lane.add(stripe);
    }
  }

  private addGrassDetails(lane: THREE.Group, index: number, z: number): void {
    if (index < 2) {
      return;
    }

    const treeSlots = [-12, 12];
    for (const x of treeSlots) {
      if ((index + Math.abs(x)) % 3 !== 0) {
        continue;
      }

      const trunk = block(0.45, 0.7, 0.45, 0x7a4837);
      trunk.position.set(x, 0.27, z + 0.06);
      const crown = block(0.95, 1.4, 0.95, index % 2 === 0 ? 0x9ac518 : 0x86b91b);
      crown.position.set(x, 1.25, z + 0.06);
      lane.add(trunk, crown);
    }
  }
}

export function laneIndexToZ(index: number): number {
  return -index * TILE_SIZE;
}

export function block(width: number, height: number, depth: number, color: number): THREE.Mesh {
  const mesh = new THREE.Mesh(getGeometry(width, height, depth), getMaterial(color));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function getGeometry(width: number, height: number, depth: number): THREE.BoxGeometry {
  const key = `${width}:${height}:${depth}`;
  const existing = geometryCache.get(key);
  if (existing) {
    return existing;
  }

  const geometry = new THREE.BoxGeometry(width, height, depth);
  geometryCache.set(key, geometry);
  return geometry;
}

function getMaterial(color: number): THREE.MeshLambertMaterial {
  const key = color.toString(16);
  const existing = materialCache.get(key);
  if (existing) {
    return existing;
  }

  const material = new THREE.MeshLambertMaterial({ color });
  materialCache.set(key, material);
  return material;
}

function lighten(color: number, multiplier: number): number {
  const value = new THREE.Color(color);
  value.multiplyScalar(multiplier);
  return value.getHex();
}

function safeLaneColor(state: SafeLaneState): number {
  return state === "unlocked" ? 0xa9ef52 : 0xffd447;
}
