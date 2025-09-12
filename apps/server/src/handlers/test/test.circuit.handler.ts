import { EventHandler, Resilient } from "@/core/decorator";
import type { EventContext } from "@/core/context";
import { z } from "zod";

// Test handler for circuit breaker testing
// This handler can be configured to fail on demand

const testCircuitInput = z.object({
	shouldFail: z.boolean().optional(),
	failureMessage: z.string().optional(),
	delay: z.number().optional(), // Milliseconds to delay before responding
});

const testCircuitOutput = z.object({
	success: z.boolean(),
	message: z.string(),
});

type TestCircuitInput = z.infer<typeof testCircuitInput>;
type TestCircuitOutput = z.infer<typeof testCircuitOutput>;

@EventHandler({
	event: "test.circuit",
	inputSchema: testCircuitInput,
	outputSchema: testCircuitOutput,
	persist: false,
	rateLimit: 100,
	description: "Test handler for circuit breaker testing",
})
export class TestCircuitHandler {
	@Resilient({
		rateLimit: { limit: 100, windowMs: 60000 },
		timeout: 1000,
		circuitBreaker: {
			threshold: 5, // Open after 5 failures
			timeout: 1000, // Try half-open after 1 second
			fallback: () => ({
				success: false,
				message: "Circuit breaker open - fallback response",
			}),
		},
	})
	async handle(input: TestCircuitInput, ctx: EventContext): Promise<TestCircuitOutput> {
		// Add delay if requested (for timeout testing)
		if (input.delay) {
			await new Promise(resolve => setTimeout(resolve, input.delay));
		}

		// Fail on demand for testing
		if (input.shouldFail) {
			throw new Error(input.failureMessage || "Test failure");
		}

		return {
			success: true,
			message: "Test handler executed successfully",
		};
	}
}