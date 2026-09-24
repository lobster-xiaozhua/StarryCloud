// 熔断参数（冻结，见规格 T10）
export const CIRCUIT = {
  maxRounds: 15,
  maxWallClockMs: 45 * 60_000,
  maxTotalTokens: 500_000,
  maxToolCalls: 40,
  maxRepeatSameTool: 3,
};
// maxWallClockMs 依据：MVP 定位交互式数据运维，超过 45 分钟用户失去耐心。
// v1.1 加"长任务模式"可调高。
