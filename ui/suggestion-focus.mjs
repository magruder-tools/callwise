// New advice follows the conversation; kept cards stay until an explicit ask.
export class SuggestionFocus {
  sync(sessionId, cards) {
    if (this.sessionId !== sessionId) {
      this.sessionId = sessionId;
      this.current = {};
      this.seen = { fast: new Set(), strategy: new Set() };
    }
    this.cards = cards;
    for (const lane of ["fast", "strategy"]) {
      const updated = cards.find((c) => c.id === this.current[lane]?.id);
      if (updated) this.current[lane] = updated;
      if (this.current[lane]?.status === "dismissed") this.current[lane] = null;
      const pending = this.pending(lane);
      const explicit = pending
        .filter((card) => ["asked", "hotkey"].includes(card.origin))
        .at(-1);
      if (explicit) {
        this.current[lane] = explicit;
        for (const card of pending) this.seen[lane].add(card.id);
      } else if (
        !this.current[lane] ||
        this.current[lane].status !== "accepted"
      )
        this.advance(lane);
    }
  }
  pending(lane) {
    return this.cards.filter(
      (c) =>
        c.lane === lane &&
        c.status !== "dismissed" &&
        !this.seen[lane].has(c.id),
    );
  }
  advance(lane) {
    const pending = this.pending(lane);
    if (pending.length) this.current[lane] = pending.at(-1);
    for (const card of pending) this.seen[lane].add(card.id);
  }
  dismiss(lane) {
    if (this.current[lane]) this.seen[lane].add(this.current[lane].id);
    this.current[lane] = null;
  }
  select(lane, id) {
    const card = this.cards.find(
      (c) => c.id === id && c.lane === lane && c.status !== "dismissed",
    );
    if (card) {
      this.current[lane] = card;
      this.seen[lane].add(id);
    }
  }
  navigate(lane, direction) {
    const history = this.cards.filter(
      (card) => card.lane === lane && card.status !== "dismissed",
    );
    const current = history.findIndex(
      (card) => card.id === this.current[lane]?.id,
    );
    const next = history[current + (direction === "previous" ? -1 : 1)];
    if (next) this.select(lane, next.id);
  }
}
