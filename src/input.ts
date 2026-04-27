export class InputController {
  private pendingAdvance = false;
  private readonly handleKeyDown = (event: KeyboardEvent) => {
    if (event.code !== "Space" || event.repeat) {
      return;
    }

    event.preventDefault();
    this.pendingAdvance = true;
  };

  constructor() {
    window.addEventListener("keydown", this.handleKeyDown);
  }

  consumeAdvance(): boolean {
    const shouldAdvance = this.pendingAdvance;
    this.pendingAdvance = false;
    return shouldAdvance;
  }

  dispose(): void {
    window.removeEventListener("keydown", this.handleKeyDown);
  }
}
