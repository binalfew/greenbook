const { execSync } = require("child_process");

console.log("🧪 Testing hierarchy sync...");

try {
  // Test hierarchy-only sync (should also sync users automatically)
  console.log("📋 Running hierarchy-only sync...");
  const response = execSync(
    'curl -X POST http://localhost:3000/api/sync -H "Content-Type: application/x-www-form-urlencoded" -d "action=selective_sync&users=false&referenceData=false&hierarchy=true&linkReferences=false"',
    {
      encoding: "utf8",
    }
  );

  console.log("✅ Sync response:", response);

  // Check the sync logs
  console.log("\n📊 Checking sync logs...");
  const logsResponse = execSync("curl -s http://localhost:3000/api/sync", {
    encoding: "utf8",
  });

  console.log("📋 Sync logs:", logsResponse);
} catch (error) {
  console.error("❌ Test failed:", error.message);
}
