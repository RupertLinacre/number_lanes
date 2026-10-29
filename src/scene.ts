import * as THREE from "three";

export const TILE_SIZE = 2;
export const WORLD_HALF_WIDTH = 14;
export const LANE_DEPTH = TILE_SIZE;

const geometryCache = new Map<string, THREE.BoxGeometry>();
const materialCache = new Map<string, THREE.MeshLambertMaterial>();

export type LaneKind = "grass" | "road" | "water";
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
    const viewHeight = height < 620 ? 22 : 25;
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

  createLane(
    index: number,
    kind: LaneKind,
    safeState: SafeLaneState = "unlocked",
    hasRoadMarkAfter = false,
  ): LaneVisual {
    const lane = new THREE.Group();
    const z = laneIndexToZ(index);
    const isRoad = kind === "road";
    const base = new THREE.Mesh(
      getGeometry(WORLD_HALF_WIDTH * 2, 0.22, LANE_DEPTH),
      new THREE.MeshLambertMaterial({ color: isRoad ? 0x505a65 : kind === "water" ? 0x2795bc : safeLaneColor(safeState) }),
    );
    base.position.set(0, -0.11, z);
    base.castShadow = true;
    base.receiveShadow = true;
    lane.add(base);

    if (isRoad) {
      if (hasRoadMarkAfter) {
        this.addRoadMarks(lane, z - LANE_DEPTH / 2);
      }
    } else if (kind === "grass") {
      this.addGrassDetails(lane, index, z);
    } else {
      for (let x = -WORLD_HALF_WIDTH + 1; x < WORLD_HALF_WIDTH; x += 4) {
        const ripple = block(1.1, 0.025, 0.045, 0x8ad6e2);
        ripple.position.set(x, 0.015, z + (index % 2 ? 0.72 : -0.72));
        lane.add(ripple);
      }
    }

    this.world.add(lane);
    return { group: lane, surface: base };
  }

  addTrainTrack(lane: THREE.Group, index: number): THREE.Mesh<THREE.BoxGeometry, THREE.MeshLambertMaterial> {
    const z = laneIndexToZ(index);
    for (const offset of [-0.55, 0.55]) {
      const rail = block(WORLD_HALF_WIDTH * 2, 0.09, 0.12, 0xb5c4ca);
      rail.position.set(0, 0.06, z + offset);
      lane.add(rail);
    }
    for (let x = -WORLD_HALF_WIDTH; x <= WORLD_HALF_WIDTH; x += 1.5) {
      const sleeper = block(0.22, 0.05, 1.5, 0x704631);
      sleeper.position.set(x, 0.025, z);
      lane.add(sleeper);
    }
    const post = block(0.18, 1.5, 0.18, 0x30343b);
    post.position.set(4, 0.75, z + 0.8);
    const sign = block(0.85, 0.55, 0.2, 0x22252a);
    sign.position.set(4, 1.5, z + 0.8);
    const light = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.32, 0.23), new THREE.MeshLambertMaterial({ color: 0x541515 }));
    light.position.set(4, 1.5, z + 0.92);
    lane.add(post, sign, light);
    return light;
  }

  setSafeLaneState(surface: THREE.Mesh<THREE.BoxGeometry, THREE.MeshLambertMaterial>, state: SafeLaneState): void {
    surface.material.color.setHex(safeLaneColor(state));
  }

  createMathText(expression: string, unlocked: boolean, solved = false): THREE.Mesh {
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
    context.font = "900 66px Inter, Arial, sans-serif";
    context.lineWidth = 12;
    context.strokeStyle = unlocked ? "rgba(255,255,255,0.92)" : "rgba(255,248,188,0.95)";
    context.fillStyle = solved ? "#079447" : "#17202a";
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
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(4.35, 1.22), material);
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

    group.add(plate);
    group.visible = false;
    return group;
  }

  createSuccessTick(): THREE.Group {
    const group = new THREE.Group();
    const material = getMaterial(0x11c95f);
    const shortStroke = new THREE.Mesh(getGeometry(0.34, 0.09, 0.09), material);
    const longStroke = new THREE.Mesh(getGeometry(0.58, 0.09, 0.09), material);

    shortStroke.position.set(-0.13, -0.06, 0);
    shortStroke.rotation.z = -Math.PI / 4;
    longStroke.position.set(0.15, 0.06, 0);
    longStroke.rotation.z = Math.PI / 4;

    group.add(shortStroke, longStroke);
    group.visible = false;
    group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });

    return group;
  }

  createPlayer(): THREE.Group {
    const player = new THREE.Group();
    const torso = new THREE.Mesh(new THREE.SphereGeometry(0.62, 10, 7), getMaterial(0x38c95b));
    torso.scale.set(1.05, 0.72, 0.92);
    torso.position.y = 0.38;
    player.add(torso);

    const head = block(0.84, 0.46, 0.72, 0x46e46d);
    head.position.set(0, 0.67, -0.15);
    player.add(head);

    const belly = block(0.54, 0.14, 0.38, 0xf8ffe0);
    belly.position.set(0, 0.31, -0.52);
    player.add(belly);

    const eyeLeft = block(0.2, 0.18, 0.16, 0xf6fff6);
    eyeLeft.position.set(-0.27, 1.01, -0.44);
    const eyeRight = eyeLeft.clone();
    eyeRight.position.x = 0.27;
    const pupilLeft = block(0.09, 0.08, 0.05, 0x162222);
    pupilLeft.position.set(-0.27, 1.02, -0.53);
    const pupilRight = pupilLeft.clone();
    pupilRight.position.x = 0.27;
    player.add(eyeLeft, eyeRight, pupilLeft, pupilRight);

    for (const side of [-1, 1]) {
      const hindLeg = new THREE.Group();
      hindLeg.name = side === -1 ? "left-hind-leg" : "right-hind-leg";
      hindLeg.position.set(side * 0.48, 0.28, 0.2);
      const eyeRidge = new THREE.Mesh(new THREE.SphereGeometry(0.19, 8, 6), getMaterial(0x46e46d));
      eyeRidge.position.set(side * 0.27, 0.95, -0.34);
      const leg = block(0.35, 0.32, 0.55, 0x239f46);
      leg.position.set(side * 0.07, -0.08, -0.04);
      leg.rotation.y = side * 0.3;
      const foot = block(0.48, 0.12, 0.32, 0x38c95b);
      foot.position.set(side * 0.14, -0.2, -0.44);
      const arm = block(0.2, 0.2, 0.42, 0x46d967);
      arm.position.set(side * 0.48, 0.35, -0.34);
      player.add(eyeRidge, arm, hindLeg);
      hindLeg.add(leg, foot);
      for (const toe of [-1, 0, 1]) {
        const tip = block(0.1, 0.08, 0.14, 0x80ed89);
        tip.position.set(side * 0.14 + toe * 0.14, -0.21, -0.64);
        hindLeg.add(tip);
      }
    }
    const mouth = block(0.36, 0.035, 0.035, 0x247538);
    mouth.position.set(0, 0.55, -0.52);
    player.add(mouth);

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

  createSplash(): THREE.Group {
    const splash = new THREE.Group();
    const rippleMaterial = new THREE.MeshBasicMaterial({ color: 0xd7f8ff, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide });
    for (const radius of [0.48, 0.78]) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(radius, radius + 0.09, 24), rippleMaterial);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.02;
      splash.add(ring);
    }
    for (let i = 0; i < 8; i += 1) {
      const angle = i * Math.PI / 4;
      const droplet = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 5), rippleMaterial);
      droplet.position.set(Math.cos(angle) * 0.7, 0.32, Math.sin(angle) * 0.7);
      droplet.scale.set(0.7, 1.5, 0.7);
      splash.add(droplet);
    }
    splash.visible = false;
    this.scene.add(splash);
    return splash;
  }

  createLilyPad(hasFlower: boolean): THREE.Group {
    const pad = new THREE.Group();
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(0.75, 0.3);
    shape.absarc(0, 0, 0.82, 0.38, Math.PI * 2 - 0.38, false);
    shape.closePath();
    const leaf = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.1, bevelEnabled: false, curveSegments: 16 }), getMaterial(0x479e53));
    leaf.rotation.x = -Math.PI / 2;
    leaf.position.y = 0;
    leaf.receiveShadow = true;
    pad.add(leaf);
    if (hasFlower) {
      const centre = block(0.12, 0.1, 0.12, 0xffc95e);
      centre.position.set(-0.48, 0.18, 0.28);
      pad.add(centre);
      for (const [x, z] of [[-0.15, 0], [0.15, 0], [0, -0.15], [0, 0.15]]) {
        const petal = block(0.16, 0.08, 0.16, 0xffd5df);
        petal.position.set(-0.48 + x, 0.14, 0.28 + z);
        pad.add(petal);
      }
    }
    this.vehicles.add(pad);
    return pad;
  }

  createCanalBoat(color: number): THREE.Group {
    const boat = new THREE.Group();
    const hullOutline = new THREE.Shape();
    hullOutline.moveTo(-2.9, -0.42);
    hullOutline.lineTo(-2.65, -0.68);
    hullOutline.lineTo(2.3, -0.68);
    hullOutline.lineTo(2.95, 0);
    hullOutline.lineTo(2.3, 0.68);
    hullOutline.lineTo(-2.65, 0.68);
    hullOutline.lineTo(-2.9, 0.42);
    hullOutline.closePath();
    const hull = new THREE.Mesh(new THREE.ExtrudeGeometry(hullOutline, { depth: 0.38, bevelEnabled: false }), getMaterial(color));
    hull.rotation.x = -Math.PI / 2;
    hull.position.y = -0.23;
    hull.castShadow = true;
    const deck = block(5.1, 0.08, 1.12, 0xbaa47d);
    deck.position.set(-0.1, 0.17, 0);
    const cabin = block(3.45, 0.42, 0.96, color);
    cabin.position.set(-0.35, 0.4, 0);
    const roof = block(3.6, 0.1, 1.05, 0xede4cf);
    roof.position.set(-0.35, 0.66, 0);
    boat.add(hull, deck, cabin, roof);
    for (let x = -2.45; x <= 2.3; x += 0.38) {
      const seam = block(0.025, 0.015, 1.1, 0x8e7959);
      seam.position.set(x, 0.22, 0);
      boat.add(seam);
    }
    for (const side of [-1, 1]) {
      const trim = block(5.0, 0.065, 0.06, 0xf2d37a);
      trim.position.set(-0.15, 0.1, side * 0.68);
      boat.add(trim);
      for (const x of [-1.45, -0.45, 0.55]) {
        const frame = block(0.64, 0.31, 0.04, 0xeedda7);
        frame.position.set(x, 0.43, side * 0.49);
        const window = block(0.49, 0.2, 0.05, 0x87bfce);
        window.position.set(x, 0.43, side * 0.52);
        const divider = block(0.035, 0.22, 0.06, 0xeedda7);
        divider.position.set(x, 0.43, side * 0.55);
        boat.add(frame, window, divider);
      }
      const rail = block(0.9, 0.04, 0.05, 0xe5d4a4);
      rail.position.set(1.85, 0.38, side * 0.54);
      const post = block(0.05, 0.23, 0.05, 0xe5d4a4);
      post.position.set(2.2, 0.28, side * 0.54);
      boat.add(rail, post);
    }
    const chimney = block(0.22, 0.35, 0.22, 0x303a3d);
    chimney.position.set(-1.45, 0.88, 0.23);
    const hatch = block(0.56, 0.08, 0.48, 0xa85e45);
    hatch.position.set(0.75, 0.74, 0);
    const rope = block(0.35, 0.06, 0.35, 0xc4a77a);
    rope.position.set(2.15, 0.24, 0);
    boat.add(chimney, hatch, rope);
    this.vehicles.add(boat);
    return boat;
  }

  createLorry(color: number): THREE.Group {
    const lorry = new THREE.Group();
    const chassis = block(5.2, 0.26, 1.02, 0x30363e);
    chassis.position.y = 0.28;
    const cargo = block(3.35, 1.35, 1.14, 0xe7e4d8);
    cargo.position.set(-0.8, 1.05, 0);
    const cab = block(1.48, 1.15, 1.08, color);
    cab.position.set(1.75, 0.94, 0);
    const windshield = block(0.7, 0.36, 1.1, 0x91c7df);
    windshield.position.set(2.08, 1.22, 0);
    const bumper = block(0.12, 0.18, 1.14, 0xc3cad0);
    bumper.position.set(2.6, 0.34, 0);
    lorry.add(chassis, cargo, cab, windshield, bumper);
    for (const side of [-1, 1]) {
      const stripe = block(3.1, 0.12, 0.03, color);
      stripe.position.set(-0.8, 0.95, side * 0.585);
      lorry.add(stripe);
      for (const x of [-1.9, -1.1, 1.75]) {
        const wheel = block(0.52, 0.48, 0.22, 0x20252d);
        wheel.position.set(x, 0.24, side * 0.55);
        lorry.add(wheel);
      }
    }
    this.vehicles.add(lorry);
    return lorry;
  }

  createExpressTrain(): THREE.Group {
    const train = new THREE.Group();
    // The train travels in the positive X direction, with a tapered leading cab.
    const body = block(6.8, 0.9, 1.18, 0xe9edf0);
    body.position.set(-1.05, 0.64, 0);
    const roof = block(6.5, 0.18, 1.04, 0xaab9c1);
    roof.position.set(-1.1, 1.17, 0);
    const undercarriage = block(7.5, 0.2, 0.94, 0x343c48);
    undercarriage.position.set(-0.6, 0.15, 0);
    const noseShape = new THREE.Shape();
    noseShape.moveTo(0, 0);
    noseShape.lineTo(2.1, 0);
    noseShape.lineTo(1.75, 0.28);
    noseShape.lineTo(0, 0.9);
    noseShape.closePath();
    const nose = new THREE.Mesh(
      new THREE.ExtrudeGeometry(noseShape, { depth: 1.18, bevelEnabled: false }),
      getMaterial(0xe9edf0),
    );
    nose.position.set(2.35, 0.2, -0.59);
    nose.castShadow = true;
    train.add(body, roof, undercarriage, nose);

    const roofLine = block(5.9, 0.05, 0.3, 0x788b98);
    roofLine.position.set(-1.3, 1.28, 0);
    train.add(roofLine);

    for (const side of [-1, 1]) {
      const stripe = block(6.7, 0.18, 0.025, 0x2256ac);
      stripe.position.set(-1.05, 0.47, side * 0.6);
      train.add(stripe);
      for (const x of [-2.05, 0.7]) {
        const door = block(0.05, 0.76, 0.04, 0x91a4b2);
        door.position.set(x, 0.69, side * 0.615);
        train.add(door);
      }
      for (let x = -3.8; x <= 1.6; x += 0.9) {
        const window = block(0.58, 0.28, 0.035, 0x263e59);
        window.position.set(x, 0.86, side * 0.61);
        train.add(window);
      }
      const windshield = block(0.72, 0.22, 0.04, 0x263e59);
      windshield.position.set(2.75, 0.84, side * 0.6);
      windshield.rotation.z = -0.24;
      train.add(windshield);
      const headlight = block(0.18, 0.1, 0.06, 0xffef9f);
      headlight.position.set(3.7, 0.42, side * 0.6);
      train.add(headlight);
      for (const x of [-3.4, -2.4, 0.4, 1.4]) {
        const wheel = block(0.38, 0.34, 0.16, 0x20262e);
        wheel.position.set(x, 0.16, side * 0.48);
        train.add(wheel);
      }
    }
    this.vehicles.add(train);
    return train;
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
