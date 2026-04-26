/**
 * Handler for the detect_domain tool — lightweight domain classification.
 *
 * source: mcp_server/handlers/detect_domain.py
 */

import type { DomainContext, DomainDetectionResult, ProfilesStore } from "../types.js";
import { detectDomain } from "../domain-detector.js";

/**
 * Classify the current working directory + first message into a cognitive domain.
 *
 * Returns domain, confidence, isNew, alternativeDomains.
 * The `profiles` argument is injected by the infrastructure layer.
 *
 * source: mcp_server/handlers/detect_domain.py handler
 */
export function detectDomainHandler(
  args: DomainContext,
  profiles: ProfilesStore,
): DomainDetectionResult {
  return detectDomain(
    { cwd: args.cwd, project: args.project, firstMessage: args.firstMessage },
    profiles,
  );
}
