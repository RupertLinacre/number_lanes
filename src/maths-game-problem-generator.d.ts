declare module "maths-game-problem-generator" {
  export interface MathProblem {
    expression: string;
    expression_short: string;
    answer: number;
    formattedAnswer: string;
    type: string;
    yearLevel: string;
  }

  export interface GenerateProblemOptions {
    yearLevel?: string;
    type?: string;
  }

  export function generateProblem(options?: GenerateProblemOptions): MathProblem;
  export function checkAnswer(problem: MathProblem, userAnswer: number | string): boolean;
  export function getYearLevels(): string[];
  export function getProblemTypes(): string[];

  export const YEAR_LEVELS: Record<string, string>;
  export const PROBLEM_TYPES: Record<string, string>;
}
