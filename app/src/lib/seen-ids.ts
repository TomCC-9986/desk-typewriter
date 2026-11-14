export class SeenIds {
  private ids: string[];

  constructor(initial: string[] = [], private limit = 500) {
    this.ids = initial.slice(-limit);
  }

  /** Returns true the first time an id is seen. */
  add(id: string): boolean {
    if (this.ids.includes(id)) return false;
    this.ids.push(id);
    if (this.ids.length > this.limit) this.ids.shift();
    return true;
  }

  toJSON(): string[] {
    return [...this.ids];
  }
}
