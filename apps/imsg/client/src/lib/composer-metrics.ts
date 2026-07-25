/**
 * Composer input metrics, shared by the real <TextInput> and the invisible
 * mirror <Text> that measures its height on iOS.
 *
 * These MUST stay in lockstep. The mirror only reports the right height if it
 * wraps text at exactly the same width as the input's text area — and the
 * input's text area is inset by its border AND its padding, while an
 * absolutely-positioned mirror is inset only by whatever left/right we give
 * it. Hard-coding `left: 14, right: 14` against `paddingHorizontal: 14` +
 * `borderWidth: 1` made the mirror 2px wider than the real text area, so a
 * word landing on that boundary fit on one line in the mirror but wrapped to
 * two in the input: the input kept its one-line height and the second line
 * was invisible until you sent the message.
 *
 * Deriving the mirror inset from the same numbers removes the class of bug.
 */
export const INPUT_PADDING_H = 14;
export const INPUT_BORDER_W = 1;

/** Distance from the input's outer edge to where its text actually starts. */
export const MIRROR_INSET_H = INPUT_PADDING_H + INPUT_BORDER_W;
