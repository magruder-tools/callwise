// Each subscriber receives a full transcript once, then only changed/removed rows.
export class SnapshotStream {
  pack(snapshot) {
    const rows = snapshot.transcript || [];
    if (this.sessionId !== snapshot.sessionId) {
      this.sessionId = snapshot.sessionId;
      this.rows = new Map(rows.map((row) => [row.id, { ...row }]));
      return snapshot;
    }
    const changed = rows.filter((row) => {
      const prior = this.rows.get(row.id);
      return !prior || Object.keys(row).some((key) => row[key] !== prior[key]);
    });
    const ids = new Set(rows.map((row) => row.id));
    const removed = [...this.rows.keys()].filter((id) => !ids.has(id));
    this.rows = new Map(rows.map((row) => [row.id, { ...row }]));
    const { transcript, ...state } = snapshot;
    return { ...state, transcriptDelta: changed, transcriptRemoved: removed };
  }
}
