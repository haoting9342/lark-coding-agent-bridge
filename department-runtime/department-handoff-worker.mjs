export class DepartmentHandoffWorker {
  constructor({ departmentId, nodeId, adapter, registry } = {}) {
    if (typeof departmentId !== 'string' || !departmentId) throw new TypeError('departmentId is required');
    if (typeof nodeId !== 'string' || !nodeId) throw new TypeError('nodeId is required');
    if (!adapter) throw new TypeError('adapter is required');
    if (!registry) throw new TypeError('registry is required');
    this.departmentId = departmentId;
    this.nodeId = nodeId;
    this.adapter = adapter;
    this.registry = registry;
  }

  runOnce() {
    const queued = this.adapter.claim(this.nodeId).tasks ?? [];
    if (queued.length === 0) return { status: 'idle' };
    const candidate = [...queued].sort(
      (left, right) => String(left.createdAt).localeCompare(String(right.createdAt)),
    )[0];
    let task;
    try {
      task = this.adapter.accept(this.nodeId, {
        taskId: candidate.id,
        expectedVersion: candidate.version,
        summary: `${this.nodeId} accepted ${candidate.protocolId}`,
      }).task;
      task = this.adapter.progress(this.nodeId, {
        taskId: task.id,
        expectedVersion: task.version,
        summary: `${this.nodeId} started ${task.protocolId}`,
        start: true,
      }).task;
      const output = this.registry.run(task);
      if (task.deliveryMode === 'direct_with_receipt') {
        if (!output.receipt) throw new Error('direct delivery runner did not return a receipt');
        task = this.adapter.receipt(this.nodeId, {
          taskId: task.id,
          expectedVersion: task.version,
          summary: output.summary,
          evidence: output.evidence,
          receipt: output.receipt,
        }).task;
        return { status: 'completed_with_receipt', taskId: task.id, task };
      }
      task = this.adapter.complete(this.nodeId, {
        taskId: task.id,
        expectedVersion: task.version,
        summary: output.summary,
        evidence: output.evidence,
      }).task;
      return { status: 'completed', taskId: task.id, task };
    } catch (error) {
      const current = task ?? candidate;
      try {
        if (current && !new Set(['completed', 'failed', 'cancelled']).has(current.state)) {
          this.adapter.fail(this.nodeId, {
            taskId: current.id,
            expectedVersion: current.version,
            summary: `runner failed: ${String(error.message).slice(0, 1000)}`,
          });
        }
      } catch {
        // A concurrent cancellation may fence this worker; preserve the original error.
      }
      return { status: 'failed', taskId: candidate.id, error: error.message };
    }
  }
}
