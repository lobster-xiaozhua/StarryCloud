export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolOutput {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
  stdoutBytes: number;
  durationMs: number;
  note?: string;
  aborted?: boolean;
}

export const TOOL_NAMES = ['run_shell_command', 'read_file', 'write_file'] as const;
export type ToolName = typeof TOOL_NAMES[number];
