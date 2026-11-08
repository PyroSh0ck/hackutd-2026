/**
 * Masks secret-looking values in player text before it reaches the model or logs. The game never
 * asks for real secrets, but players may type them anyway. Conservative: digit runs of 4+ (codes,
 * card/account fragments), emails, and long token-like strings.
 */
export function redactPlayerText(text: string): string {
  return text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email removed]")
    .replace(/\b(?:\d[ -]?){4,}\b/g, "[number removed]")
    .replace(/\b(?=[A-Za-z0-9]*\d)(?=[A-Za-z0-9]*[A-Za-z])[A-Za-z0-9]{16,}\b/g, "[token removed]");
}
