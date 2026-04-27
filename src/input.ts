export interface AnswerInputEvents {
  backspaceCount: number;
  characters: string[];
  clear: boolean;
  submit: boolean;
}

export class InputController {
  private pendingAdvance = false;
  private pendingHorizontal = 0;
  private pendingSubmit = false;
  private pendingClear = false;
  private pendingBackspaceCount = 0;
  private readonly pendingCharacters: string[] = [];

  private readonly handleKeyDown = (event: KeyboardEvent) => {
    if (event.code === "Space" && !event.repeat) {
      event.preventDefault();
      this.pendingAdvance = true;
      return;
    }

    if ((event.code === "ArrowLeft" || event.code === "ArrowRight") && !event.repeat) {
      event.preventDefault();
      this.pendingHorizontal += event.code === "ArrowLeft" ? -1 : 1;
      return;
    }

    if (event.code === "Enter" || event.code === "NumpadEnter") {
      event.preventDefault();
      this.pendingSubmit = true;
      return;
    }

    if (event.code === "Backspace") {
      event.preventDefault();
      this.pendingBackspaceCount += 1;
      return;
    }

    if (event.code === "Escape") {
      event.preventDefault();
      this.pendingClear = true;
      return;
    }

    if (isAnswerCharacter(event.key)) {
      event.preventDefault();
      this.pendingCharacters.push(event.key);
    }
  };

  constructor() {
    window.addEventListener("keydown", this.handleKeyDown);
  }

  consumeAdvance(): boolean {
    const shouldAdvance = this.pendingAdvance;
    this.pendingAdvance = false;
    return shouldAdvance;
  }

  consumeHorizontal(): -1 | 0 | 1 {
    const direction = Math.sign(this.pendingHorizontal) as -1 | 0 | 1;
    this.pendingHorizontal = 0;
    return direction;
  }

  consumeAnswerInput(): AnswerInputEvents {
    const events: AnswerInputEvents = {
      backspaceCount: this.pendingBackspaceCount,
      characters: [...this.pendingCharacters],
      clear: this.pendingClear,
      submit: this.pendingSubmit,
    };

    this.pendingBackspaceCount = 0;
    this.pendingCharacters.length = 0;
    this.pendingClear = false;
    this.pendingSubmit = false;

    return events;
  }

  dispose(): void {
    window.removeEventListener("keydown", this.handleKeyDown);
  }
}

function isAnswerCharacter(key: string): boolean {
  return /^[0-9.-]$/.test(key);
}
