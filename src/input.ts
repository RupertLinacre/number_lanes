export interface AnswerInputEvents {
  backspaceCount: number;
  characters: string[];
  clear: boolean;
  submit: number;
}

export class InputController {
  private pendingAdvance = 0;
  private pendingSubmit = 0;
  private pendingClear = false;
  private pendingBackspaceCount = 0;
  private readonly pendingCharacters: string[] = [];

  private readonly handleKeyDown = (event: KeyboardEvent) => {
    if (isFormControl(event.target)) {
      return;
    }

    if ((event.code === "Space" || event.code === "ArrowUp") && !event.repeat) {
      event.preventDefault();
      this.pendingAdvance += 1;
      return;
    }

    if (event.code === "ArrowLeft" || event.code === "ArrowRight" || event.code === "ArrowDown") {
      event.preventDefault();
      return;
    }

    if ((event.code === "Enter" || event.code === "NumpadEnter") && !event.repeat) {
      event.preventDefault();
      this.pendingSubmit += 1;
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

  pressTouchKey(key: string): void {
    if (key === "hop") this.pendingAdvance += 1;
    else if (key === "submit") this.pendingSubmit += 1;
    else if (key === "back") this.pendingBackspaceCount += 1;
    else if (key === "clear") this.pendingClear = true;
    else if (isAnswerCharacter(key)) this.pendingCharacters.push(key);
  }

  consumeAdvance(): number {
    const shouldAdvance = this.pendingAdvance;
    this.pendingAdvance = 0;
    return shouldAdvance;
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
    this.pendingSubmit = 0;

    return events;
  }

  dispose(): void {
    window.removeEventListener("keydown", this.handleKeyDown);
  }
}

function isAnswerCharacter(key: string): boolean {
  return /^[0-9.-]$/.test(key);
}

function isFormControl(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
    || target instanceof HTMLButtonElement;
}
