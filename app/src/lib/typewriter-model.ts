import { MAX_TEXT } from "@shared/protocol";

export interface Cell { ch: string; struck: boolean }

export class TypewriterModel {
  cells: Cell[] = [];

  constructor(initial = "") {
    this.type(initial);
  }

  get length(): number {
    return this.cells.filter((c) => !c.struck).length;
  }

  text(): string {
    return this.cells.filter((c) => !c.struck).map((c) => c.ch).join("");
  }

  /** Returns the characters actually accepted (truncated at MAX_TEXT). */
  type(s: string): string {
    let accepted = "";
    for (const ch of s) {
      if (this.length >= MAX_TEXT) break;
      this.cells.push({ ch, struck: false });
      accepted += ch;
    }
    return accepted;
  }

  /** Erases the last character (or line break). Returns whether anything changed. */
  backspace(): boolean {
    if (!this.cells.length) return false;
    this.cells.pop();
    return true;
  }

  clear(): void {
    this.cells = [];
  }
}
