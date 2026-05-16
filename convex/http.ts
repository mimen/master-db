import { httpRouter } from "convex/server";

import { auth } from "./auth";
import { handleTodoistWebhook } from "./todoist/webhook";

/**
 * HTTP Router for Convex
 * Handles incoming HTTP requests and routes them to appropriate handlers
 */
const http = httpRouter();

/**
 * Convex Auth — mounts /api/auth/* (Google OAuth callback, token refresh,
 * sign-out). These endpoints are intentionally public; the whitelist is
 * enforced in the Google provider's `profile()` callback.
 */
auth.addHttpRoutes(http);

/**
 * Todoist webhook endpoint
 * POST /todoist/webhook
 *
 * Receives real-time webhook notifications from Todoist
 * Documentation: https://developer.todoist.com/api/v1#tag/Webhooks
 *
 * Required headers:
 * - X-Todoist-Hmac-SHA256: HMAC signature for verification
 * - X-Todoist-Delivery-ID: Unique delivery identifier
 *
 * Configuration:
 * 1. Set TODOIST_WEBHOOK_SECRET in environment variables
 * 2. Configure webhook URL in Todoist App Management Console:
 *    https://your-convex-deployment.convex.cloud/todoist/webhook
 */
http.route({
  path: "/todoist/webhook",
  method: "POST",
  handler: handleTodoistWebhook,
});

export default http;
