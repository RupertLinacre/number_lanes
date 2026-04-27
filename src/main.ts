import { Game } from "./game";
import { InputController } from "./input";
import { GameScene } from "./scene";
import "./style.css";

const canvas = document.querySelector<HTMLCanvasElement>("#game-canvas");

if (!canvas) {
  throw new Error("Game canvas was not found.");
}

const gameScene = new GameScene(canvas);
const input = new InputController();
const game = new Game(gameScene, input);

window.addEventListener("resize", () => game.handleResize());
window.addEventListener("beforeunload", () => {
  input.dispose();
  game.stop();
});

game.start();
