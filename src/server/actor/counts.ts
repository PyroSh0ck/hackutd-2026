export const wordCount = (text: string) => text.trim().split(/\s+/u).filter(Boolean).length;
export const questionCount = (text: string) => (text.match(/[?？]/gu) ?? []).length;
export const hardWordLimit = (instruction: { action: string; constraints: { maxWords: number } }) =>
  Math.min(instruction.constraints.maxWords, ["clarify_response", "acknowledge_boundary"].includes(instruction.action) ? 40 : 70);
