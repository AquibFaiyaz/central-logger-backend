import dotenv from "dotenv";

dotenv.config();

const port = process.env.PORT || 4000;
const baseUrl = `http://localhost:${port}/api/v1`;

async function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function test() {
  console.log("[Test] Beginning Central Logger API Verification...");

  // 1. Ingest normal log entry
  console.log("\n[Test] Sending standard INFO log...");
  const res1 = await fetch(`${baseUrl}/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      appId: "railinfo-mcp",
      level: "info",
      type: "log",
      message: "Server successfully connected to external Rail API gateway",
      timestamp: new Date().toISOString(),
      payload: { cacheTTL: 60 }
    })
  });
  console.log("Response:", await res1.json());

  // 2. Ingest transaction log (incoming request)
  console.log("\n[Test] Sending incoming HTTP TRANSACTION log...");
  const traceId = `trace-${Date.now()}`;
  const res2 = await fetch(`${baseUrl}/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      appId: "railinfo-mcp",
      traceId,
      level: "info",
      type: "transaction",
      message: "Incoming MCP tool execution: get_train_speed",
      timestamp: new Date().toISOString(),
      payload: {
        direction: "incoming",
        request: {
          method: "POST",
          url: "/mcp/get_train_speed",
          body: { trainNo: "15484" }
        },
        response: {
          status: 200,
          body: { speed: "38 km/h", source: "GPS", dataAge: "13s ago" }
        },
        durationMs: 450
      }
    })
  });
  console.log("Response:", await res2.json());

  // 3. Ingest error log
  console.log("\n[Test] Sending ERROR log...");
  const res3 = await fetch(`${baseUrl}/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      appId: "jobhunt-mcp",
      level: "error",
      type: "log",
      message: "Linkedin scraper session expired",
      timestamp: new Date().toISOString(),
      payload: {
        error: {
          message: "Session token invalid",
          stack: "Error: Session token invalid\n    at LinkedinService.scrape (/src/services/linkedin.service.ts:42:15)"
        }
      }
    })
  });
  console.log("Response:", await res3.json());

  await delay(1000); // Wait for SQLite write buffer

  // 4. Query distinct apps list
  console.log("\n[Test] Querying distinct app list...");
  const appListRes = await fetch(`${baseUrl}/apps`);
  console.log("Apps:", await appListRes.json());

  // 5. Query all logged entries
  console.log("\n[Test] Querying all logs...");
  const allLogsRes = await fetch(`${baseUrl}/logs`);
  const logsData = await allLogsRes.json();
  console.log(`Total logs returned: ${logsData.logs.length}`);
  console.log("Sample records:", JSON.stringify(logsData.logs.slice(0, 2), null, 2));

  // 6. Query filtered by appId
  console.log("\n[Test] Querying logs filtered by appId=jobhunt-mcp...");
  const filteredRes = await fetch(`${baseUrl}/logs?appId=jobhunt-mcp`);
  const filteredData = await filteredRes.json();
  console.log("JobHunt logs count:", filteredData.logs.length);
  console.log("JobHunt messages:", filteredData.logs.map((l: any) => l.message));

  console.log("\n[Test] Verification Complete!");
}

test().catch(err => {
  console.error("Test failed:", err.message);
});
