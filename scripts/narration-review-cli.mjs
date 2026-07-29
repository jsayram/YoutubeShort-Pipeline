import { loadEnv, parseArgs } from "./lib.mjs";
import {
  approveNarrationReview,
  prepareNarrationReview,
} from "./narration-review.mjs";

await loadEnv();
const { flags, positionals } = parseArgs();
if (!flags.project) throw new Error("Pass --project <slug>.");

const command = positionals[0] ?? "prepare";
if (command === "prepare") {
  const state = await prepareNarrationReview(flags.project, {
    autoApprove: flags["auto-approve"] === true,
  });
  console.log(
    state.status === "approved"
      ? `Narration approved and assembled for ${state.lines.length} lines.`
      : `Narration review ready for ${state.lines.length} lines.`,
  );
} else if (command === "approve") {
  const state = await approveNarrationReview(flags.project);
  console.log(`Narration approved and assembled for ${state.lines.length} lines.`);
} else {
  throw new Error(`Unknown narration review command "${command}".`);
}
