import { EventHandler, Instrumented, Resilient } from "@/core/decorator";
import type { EventContext } from "@/core/context";
import { z } from "zod";
import { redisScripts } from "@/core/redis-scripts";

// Input/Output schemas for quorum voting
const systemQuorumVoteInput = z.object({
	instanceId: z.string(),
	decision: z.string(),
	value: z.string(),
	totalInstances: z.number().int().min(1).default(3),
});

const systemQuorumVoteOutput = z.object({
	voted: z.boolean(),
	quorumReached: z.boolean(),
	finalDecision: z.string().optional(),
	voteCount: z.number().optional(),
});

type SystemQuorumVoteInput = z.infer<typeof systemQuorumVoteInput>;
type SystemQuorumVoteOutput = z.infer<typeof systemQuorumVoteOutput>;

@EventHandler({
	event: "system.quorum.vote",
	inputSchema: systemQuorumVoteInput,
	outputSchema: systemQuorumVoteOutput,
	persist: false,
	rateLimit: 50,
	description: "Submit vote for quorum-based decisions atomically via Lua script",
})
export class SystemQuorumVoteHandler {
	@Instrumented(0)
	@Resilient({
		rateLimit: { limit: 50, windowMs: 60000 },
		timeout: 5000,
		circuitBreaker: { 
			threshold: 5, 
			timeout: 30000,
			fallback: () => ({ 
				voted: false,
				quorumReached: false,
			})
		}
	})
	async handle(input: SystemQuorumVoteInput, ctx: EventContext): Promise<SystemQuorumVoteOutput> {
		// Submit vote atomically using Lua script
		const voteResult = await redisScripts.addQuorumVote(
			`${input.decision}:${input.instanceId}`,
			input.value,
			input.totalInstances
		);
		
		// If quorum reached, emit decision event
		if (voteResult.quorumReached && voteResult.decision) {
			await ctx.publish({
				type: "quorum.decision.made",
				payload: {
					decision: input.decision,
					value: voteResult.decision,
					voteCount: voteResult.voteCount,
					quorum: Math.floor(input.totalInstances / 2) + 1,
				},
			});
		}
		
		return {
			voted: true,
			quorumReached: voteResult.quorumReached,
			finalDecision: voteResult.decision || undefined,
			voteCount: voteResult.voteCount,
		};
	}
}