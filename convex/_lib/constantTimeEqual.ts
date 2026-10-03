export function constantTimeEqual(expected: string, provided: string): boolean {
  let difference = expected.length ^ provided.length;
  for (let i = 0; i < expected.length; i++) {
    difference |= expected.charCodeAt(i) ^ (provided.charCodeAt(i) || 0);
  }
  return difference === 0;
}
