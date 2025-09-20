#!/usr/bin/env bun
import { ConvexClient } from "convex/browser";
import { api } from "./convex/_generated/api";

const CONVEX_URL = process.env.CONVEX_URL || "https://thankful-swallow-588.convex.cloud";
const client = new ConvexClient(CONVEX_URL);

async function waitForSync(delay = 2000) {
  console.log(`Waiting ${delay}ms for sync...`);
  await new Promise(resolve => setTimeout(resolve, delay));
}

async function testTaskCompletion() {
  console.log("\n=== Testing Task Completion ===");
  
  // Get initial state
  const initialItems = await client.query(api.todoist.publicQueries.getActiveItems);
  console.log(`Initial active items: ${initialItems.length}`);
  
  // Create a test task using MCP
  console.log("Creating test task in Todoist...");
  // Note: We'll need to use the MCP tool to create a task
  
  // Wait for sync
  await waitForSync(3000);
  
  // Check if task appears
  const afterCreate = await client.query(api.todoist.publicQueries.getActiveItems);
  console.log(`Active items after create: ${afterCreate.length}`);
  
  // Find the test task
  const testTask = afterCreate.find(item => item.content.includes("Test Task"));
  if (testTask) {
    console.log(`Found test task: ${testTask.todoist_id} - ${testTask.content}`);
  } else {
    console.log("Test task not found after sync");
  }
}

async function main() {
  console.log("Starting Todoist sync tests...");
  
  // Check current sync status
  const syncStatus = await client.query(api.todoist.publicQueries.getSyncStatus);
  console.log("Current sync status:", syncStatus);
  
  // Run tests
  await testTaskCompletion();
  
  client.close();
}

main().catch(console.error);