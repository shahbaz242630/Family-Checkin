import { Logger } from '@nestjs/common';

/**
 * Vitest setup for the backend project. The services log every failure they swallow (CB-047), and the specs
 * deliberately drive those paths, so without this every run buries its own output in stack-free Nest log lines.
 * Specs that care about a log line assert on it with `vi.spyOn(Logger.prototype, ...)`, which intercepts the call
 * before this silence applies.
 */
Logger.overrideLogger(false);
