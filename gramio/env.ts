// The second bot's credentials live in *_2 variables; fall back to the
// unsuffixed names so a single-bot setup keeps working.
export function env(name: string): string | undefined {
  return Deno.env.get(`${name}_2`) || Deno.env.get(name) || undefined;
}
