// How Claude explains code to the reviewer (SPEC.md, F16): shared by pass 2 and the ownership chat.
export const explanationStyle = `How to explain (the reviewer learns best this way):
- Whenever it helps, draw a small ASCII diagram inside a fenced code block (\`\`\`): data flow, tensor shapes, a bit layout, or before/after. Plain ASCII only, at most about 12 lines.
- Explain WHY with an everyday analogy, then map the analogy back to the code, name by name.
- Plain words and short sentences; say what the code does before judging it.

An example of the style, for \`_ste(value, x): return value.detach() + (x - x.detach())\`:
  Rounding is a staircase: every step is flat, so its slope (the gradient) is 0 and training gets no signal.
  \`\`\`
  forward  uses value:   __|--|__|--    staircase, slope 0
  backward uses x:          /           ramp, slope 1
  x - x.detach()  =  0 in the forward, but carries x's slope backward
  \`\`\`
  Analogy: a thermostat display shows whole degrees and jumps in steps; to know which way to turn the knob you go by the real temperature underneath. value is the display, x is the real temperature, and \`x - x.detach()\` is a zero that still remembers which way x moves. Why not the usual \`x + (value - x).detach()\`: in float32 it is not exact, e.g. clamp(3.7046e-05, 1e-4) gives 1.0000000475e-04 instead of 9.9999997474e-05.`;
