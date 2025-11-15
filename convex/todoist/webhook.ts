import { internal } from "../_generated/api";
import { httpAction } from "../_generated/server";

import type {
  ItemWebhookEvent,
  LabelWebhookEvent,
  ProjectWebhookEvent,
  WebhookEvent,
} from "./types/webhook";

/**
 * Todoist Webhook Handler
 * Receives real-time webhook notifications from Todoist and updates Convex
 * Documentation: https://developer.todoist.com/api/v1#tag/Webhooks
 */
export const handleTodoistWebhook = httpAction(async (ctx, request) => {
  const startTime = Date.now();

  // Only accept POST requests
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    // Get the raw body for signature verification
    const rawBody = await request.text();
    const signature = request.headers.get("X-Todoist-Hmac-SHA256");
    const deliveryId = request.headers.get("X-Todoist-Delivery-ID");

    if (!signature || !deliveryId) {
      console.error("Missing required headers");
      return new Response("Missing required headers", { status: 400 });
    }

    // Verify signature
    const secret = process.env.TODOIST_WEBHOOK_SECRET;
    if (!secret) {
      console.error("TODOIST_WEBHOOK_SECRET not configured");
      return new Response("Webhook not configured", { status: 500 });
    }

    const isValid = await verifyWebhookSignature(rawBody, signature, secret);
    if (!isValid) {
      console.error("Invalid webhook signature");
      await logWebhookEvent(ctx, {
        deliveryId,
        eventName: "unknown",
        userId: "unknown",
        version: "unknown",
        triggeredAt: new Date().toISOString(),
        status: "failed",
        errorMessage: "Invalid signature",
        processedAt: Date.now(),
        processingTimeMs: Date.now() - startTime,
        eventDataSummary: { entity_id: "unknown", entity_type: "unknown" },
      });
      return new Response("Invalid signature", { status: 401 });
    }

    // Parse the webhook event
    const event: WebhookEvent = JSON.parse(rawBody);

    // Check for duplicate delivery using delivery_id
    const isDuplicate = await checkDuplicateDelivery(ctx, deliveryId);
    if (isDuplicate) {
      // Skipping duplicate delivery - return 200 to prevent retry
      return new Response("OK", { status: 200 });
    }

    // Process the webhook event
    const result = await processWebhookEvent(ctx, event);

    // Log the webhook event
    await logWebhookEvent(ctx, {
      deliveryId,
      eventName: event.event_name,
      userId: event.user_id,
      version: event.version,
      triggeredAt: event.triggered_at,
      status: result.status,
      errorMessage: result.error,
      processedAt: Date.now(),
      processingTimeMs: Date.now() - startTime,
      eventDataSummary: result.eventDataSummary,
      initiatorId: event.initiator.id,
      initiatorEmail: event.initiator.email,
    });

    return new Response("OK", { status: 200 });
  } catch (error) {
    console.error("Error processing webhook:", error);
    return new Response("Internal server error", { status: 500 });
  }
});

/**
 * Convert ArrayBuffer to base64 string (Web-compatible)
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  // btoa is available in Convex runtime (Web API)
  // eslint-disable-next-line no-undef
  return btoa(binary);
}

/**
 * Verify the webhook signature using HMAC-SHA256
 * Uses Web Crypto API (compatible with Convex runtime)
 */
async function verifyWebhookSignature(
  body: string,
  signature: string,
  secret: string
): Promise<boolean> {
  try {
    // Convert secret and body to Uint8Array
    const encoder = new TextEncoder();
    const keyData = encoder.encode(secret);
    const bodyData = encoder.encode(body);

    // Import the key for HMAC-SHA256
    const key = await crypto.subtle.importKey(
      "raw",
      keyData,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );

    // Sign the body
    const signatureBuffer = await crypto.subtle.sign("HMAC", key, bodyData);

    // Convert signature to base64 (using Web-compatible approach)
    const expectedSignature = arrayBufferToBase64(signatureBuffer);

    return signature === expectedSignature;
  } catch (error) {
    console.error("Error verifying signature:", error);
    return false;
  }
}

/**
 * Check if we've already processed this delivery
 */
async function checkDuplicateDelivery(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: any,
  deliveryId: string
): Promise<boolean> {
  const existing = await ctx.runQuery(
    internal.todoist.queries.getWebhookEventByDeliveryId.getWebhookEventByDeliveryId,
    { deliveryId }
  );
  return existing !== null;
}

/**
 * Process the webhook event and route to appropriate mutations
 */
async function processWebhookEvent(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: any,
  event: WebhookEvent
): Promise<{
  status: "success" | "failed" | "skipped";
  error?: string;
  eventDataSummary: { entity_id: string; entity_type: string };
}> {
  try {
    const eventName = event.event_name;

    // Handle item events
    if (eventName.startsWith("item:")) {
      return await processItemEvent(ctx, event as ItemWebhookEvent);
    }

    // Handle project events
    if (eventName.startsWith("project:")) {
      return await processProjectEvent(ctx, event as ProjectWebhookEvent);
    }

    // Handle label events
    if (eventName.startsWith("label:")) {
      return await processLabelEvent(ctx, event as LabelWebhookEvent);
    }

    return {
      status: "skipped",
      error: `Unsupported event type: ${eventName}`,
      eventDataSummary: { entity_id: "unknown", entity_type: "unknown" },
    };
  } catch (error) {
    console.error("Error processing webhook event:", error);
    return {
      status: "failed",
      error: error instanceof Error ? error.message : "Unknown error",
      eventDataSummary: { entity_id: "unknown", entity_type: "unknown" },
    };
  }
}

/**
 * Process item (task) webhook events
 */
async function processItemEvent(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: any,
  event: ItemWebhookEvent
): Promise<{
  status: "success" | "failed" | "skipped";
  error?: string;
  eventDataSummary: { entity_id: string; entity_type: string };
}> {
  const item = event.event_data;
  const eventName = event.event_name;

  // Handle deletion by setting is_deleted flag
  if (eventName === "item:deleted") {
    item.is_deleted = true;
  }

  // Handle completion
  if (eventName === "item:completed") {
    item.checked = true;
    item.completed_at = event.triggered_at;
  }

  // Handle uncompletion
  if (eventName === "item:uncompleted") {
    item.checked = false;
    item.completed_at = null;
  }

  // Upsert the item
  await ctx.runMutation(internal.todoist.mutations.upsertItem, {
    item,
  });

  // Check if this is a routine task and handle accordingly
  if (isRoutineTask(item)) {
    await handleRoutineTaskEvent(ctx, item, eventName);
  }

  // Trigger metadata extraction for items
  await ctx.runMutation(internal.todoist.mutations.triggerMetadataExtraction);

  return {
    status: "success",
    eventDataSummary: { entity_id: item.id, entity_type: "item" },
  };
}

/**
 * Check if a task is a routine task (has "routine" label)
 */
function isRoutineTask(item: {
  labels?: string[];
  [key: string]: unknown;
}): boolean {
  return item.labels ? item.labels.includes("routine") : false;
}

/**
 * Handle routine-specific task events
 */
async function handleRoutineTaskEvent(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: any,
  item: {
    id: string;
    [key: string]: unknown;
  },
  eventName: string
): Promise<void> {
  try {
    const todoistTaskId = item.id as string;

    // Find the routineTask by todoistTaskId
    const routineTask = await ctx.runQuery(
      internal.routines.queries.getRoutineTaskByTodoistId,
      { todoistTaskId }
    );

    if (!routineTask) {
      // Task not linked to a routine yet, skip routine handling
      return;
    }

    // Handle different event types
    if (eventName === "item:completed") {
      await ctx.runMutation(
        internal.routines.mutations.markRoutineTaskCompleted,
        {
          routineTaskId: routineTask._id,
          completedDate: Date.now(),
        }
      );
    } else if (eventName === "item:deleted") {
      await ctx.runMutation(
        internal.routines.mutations.markRoutineTaskSkipped,
        {
          routineTaskId: routineTask._id,
        }
      );
    } else if (eventName === "item:uncompleted") {
      await ctx.runMutation(
        internal.routines.mutations.markRoutineTaskPending,
        {
          routineTaskId: routineTask._id,
        }
      );
    }

    // Recalculate completion rate for the routine
    if (routineTask.routineId) {
      await ctx.runMutation(
        internal.routines.mutations.recalculateRoutineCompletionRate,
        {
          routineId: routineTask.routineId,
        }
      );
    }
  } catch (error) {
    // Log error but don't fail the webhook
    console.error("Error handling routine task event:", error);
  }
}

/**
 * Process project webhook events
 */
async function processProjectEvent(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: any,
  event: ProjectWebhookEvent
): Promise<{
  status: "success" | "failed" | "skipped";
  error?: string;
  eventDataSummary: { entity_id: string; entity_type: string };
}> {
  const project = event.event_data;
  const eventName = event.event_name;

  // Handle deletion and archiving by setting is_deleted flag
  if (eventName === "project:deleted" || eventName === "project:archived") {
    project.is_deleted = true;
    if (eventName === "project:archived") {
      project.is_archived = true;
    }
  }

  // Handle unarchiving
  if (eventName === "project:unarchived") {
    project.is_archived = false;
    project.is_deleted = false;
  }

  // Upsert the project
  await ctx.runMutation(internal.todoist.mutations.upsertProject, {
    project,
  });

  return {
    status: "success",
    eventDataSummary: { entity_id: project.id, entity_type: "project" },
  };
}

/**
 * Process label webhook events
 */
async function processLabelEvent(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: any,
  event: LabelWebhookEvent
): Promise<{
  status: "success" | "failed" | "skipped";
  error?: string;
  eventDataSummary: { entity_id: string; entity_type: string };
}> {
  const label = event.event_data;
  const eventName = event.event_name;

  // Handle deletion by setting is_deleted flag
  if (eventName === "label:deleted") {
    label.is_deleted = true;
  }

  // Upsert the label
  await ctx.runMutation(internal.todoist.mutations.upsertLabel, {
    label,
  });

  return {
    status: "success",
    eventDataSummary: { entity_id: label.id, entity_type: "label" },
  };
}

/**
 * Log webhook event to database for monitoring and debugging
 */
async function logWebhookEvent(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: any,
  data: {
    deliveryId: string;
    eventName: string;
    userId: string;
    version: string;
    triggeredAt: string;
    status: "success" | "failed" | "skipped";
    errorMessage?: string;
    processedAt: number;
    processingTimeMs: number;
    eventDataSummary: { entity_id: string; entity_type: string };
    initiatorId?: string;
    initiatorEmail?: string;
  }
): Promise<void> {
  await ctx.runMutation(internal.todoist.mutations.logWebhookEvent, {
    delivery_id: data.deliveryId,
    event_name: data.eventName,
    user_id: data.userId,
    version: data.version,
    triggered_at: data.triggeredAt,
    status: data.status,
    error_message: data.errorMessage,
    processed_at: data.processedAt,
    processing_time_ms: data.processingTimeMs,
    event_data_summary: data.eventDataSummary,
    initiator_id: data.initiatorId,
    initiator_email: data.initiatorEmail,
  });
}
