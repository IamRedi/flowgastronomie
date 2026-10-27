import type { DesignDocument } from "@flowgastronomie/domain";
export class DesignHistory {
  private past: DesignDocument[] = [];
  private future: DesignDocument[] = [];
  constructor(
    private current: DesignDocument,
    private limit = 60,
  ) {}
  push(next: DesignDocument) {
    if (JSON.stringify(next) === JSON.stringify(this.current)) return;
    this.past.push(this.current);
    this.past = this.past.slice(-this.limit);
    this.current = next;
    this.future = [];
  }
  undo() {
    const previous = this.past.pop();
    if (!previous) return this.current;
    this.future.push(this.current);
    this.current = previous;
    return previous;
  }
  redo() {
    const next = this.future.pop();
    if (!next) return this.current;
    this.past.push(this.current);
    this.current = next;
    return next;
  }
}
