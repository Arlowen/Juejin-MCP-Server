import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { ToolCode, ToolStatus } from "../shared/errorCodes.js";

export interface TraceStep {
  ts: string;
  action: string;
  target: string;
  note: string;
}

export interface TraceRecord {
  traceId: string;
  toolName: string;
  startedAt: string;
  finishedAt?: string;
  status?: ToolStatus;
  code?: ToolCode;
  message?: string;
  steps: TraceStep[];
  filePath?: string;
}

interface TraceCompleteInput {
  status: ToolStatus;
  code: ToolCode;
  message: string;
}

export class TraceRecorder {
  private readonly recordData: TraceRecord;
  private tracesRoot?: string;

  public constructor(traceId: string, toolName: string, tracesRoot?: string) {
    this.recordData = {
      traceId,
      toolName,
      startedAt: new Date().toISOString(),
      steps: []
    };
    this.tracesRoot = tracesRoot;
  }

  public setTracesRoot(tracesRoot: string): void {
    this.tracesRoot = tracesRoot;
  }

  public record(action: string, target: string, note = ""): void {
    this.recordData.steps.push({
      ts: new Date().toISOString(),
      action,
      target,
      note
    });
  }

  public snapshot(): TraceRecord {
    return {
      ...this.recordData,
      steps: [...this.recordData.steps]
    };
  }

  public async complete(input: TraceCompleteInput): Promise<TraceRecord> {
    this.recordData.finishedAt = new Date().toISOString();
    this.recordData.status = input.status;
    this.recordData.code = input.code;
    this.recordData.message = input.message;

    if (this.tracesRoot) {
      await mkdir(this.tracesRoot, { recursive: true });
      const filePath = join(this.tracesRoot, `${this.recordData.traceId}.json`);
      await writeFile(filePath, JSON.stringify(this.recordData, null, 2), "utf8");
      this.recordData.filePath = filePath;
    }

    return this.snapshot();
  }
}

const MAX_IN_MEMORY_TRACES = 50;

export class TraceStore {
  private readonly traces = new Map<string, TraceRecord>();
  private latestTraceId?: string;

  public createTrace(traceId: string, toolName: string, tracesRoot?: string): TraceRecorder {
    const recorder = new TraceRecorder(traceId, toolName, tracesRoot);
    recorder.record("tool.start", toolName, "tool execution started");
    this.latestTraceId = traceId;
    return recorder;
  }

  public save(record: TraceRecord): void {
    this.traces.set(record.traceId, record);
    this.latestTraceId = record.traceId;

    if (this.traces.size <= MAX_IN_MEMORY_TRACES) {
      return;
    }

    const first = this.traces.keys().next();
    if (!first.done) {
      this.traces.delete(first.value);
    }
  }

  public getLatest(): TraceRecord | undefined {
    if (!this.latestTraceId) {
      return undefined;
    }
    return this.traces.get(this.latestTraceId);
  }

  public getByTraceId(traceId: string): TraceRecord | undefined {
    return this.traces.get(traceId);
  }
}
