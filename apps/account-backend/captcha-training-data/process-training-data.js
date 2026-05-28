#!/usr/bin/env node

/**
 * Training Data Processor
 *
 * This script helps process collected captcha training data for AI model training.
 *
 * Usage:
 *   node process-training-data.js [options]
 *
 * Options:
 *   --stats          Show statistics about collected data
 *   --export-csv     Export data to CSV format
 *   --verify         Verify data integrity
 *   --help           Show this help message
 */

const fs = require("fs");
const path = require("path");

const TRAINING_DATA_PATH = path.join(__dirname);

function showStats() {
  console.log("📊 Training Data Statistics\n");

  const files = fs.readdirSync(TRAINING_DATA_PATH);
  const jsonFiles = files.filter((f) => f.endsWith(".json"));
  const imageFiles = files.filter((f) => f.endsWith(".jpg"));

  console.log(`📁 Total JSON files: ${jsonFiles.length}`);
  console.log(`🖼️  Total image files: ${imageFiles.length}`);

  if (jsonFiles.length === 0) {
    console.log(
      "ℹ️  No training data found yet. Wait for successful captcha validations.",
    );
    return;
  }

  // Analyze metadata
  const metadata = jsonFiles
    .map((file) => {
      try {
        return JSON.parse(
          fs.readFileSync(path.join(TRAINING_DATA_PATH, file), "utf8"),
        );
      } catch (error) {
        console.warn(`⚠️  Could not parse ${file}: ${error.message}`);
        return null;
      }
    })
    .filter(Boolean);

  const inputLengths = metadata.map((m) => m.inputLength);
  const imageSizes = metadata.map((m) => m.imageSize);

  console.log(`\n📝 Input Statistics:`);
  console.log(
    `   • Average length: ${(inputLengths.reduce((a, b) => a + b, 0) / inputLengths.length).toFixed(1)} characters`,
  );
  console.log(`   • Min length: ${Math.min(...inputLengths)} characters`);
  console.log(`   • Max length: ${Math.max(...inputLengths)} characters`);

  console.log(`\n🖼️  Image Statistics:`);
  console.log(
    `   • Average size: ${(imageSizes.reduce((a, b) => a + b, 0) / imageSizes.length / 1024).toFixed(1)} KB`,
  );
  console.log(
    `   • Min size: ${(Math.min(...imageSizes) / 1024).toFixed(1)} KB`,
  );
  console.log(
    `   • Max size: ${(Math.max(...imageSizes) / 1024).toFixed(1)} KB`,
  );

  // Show recent entries
  const recent = metadata
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, 5);

  console.log(`\n🕐 Recent Entries:`);
  recent.forEach((entry, i) => {
    console.log(
      `   ${i + 1}. "${entry.userInput}" (${new Date(entry.timestamp).toLocaleString()})`,
    );
  });
}

function exportToCsv() {
  console.log("📤 Exporting training data to CSV...\n");

  const files = fs.readdirSync(TRAINING_DATA_PATH);
  const jsonFiles = files.filter((f) => f.endsWith(".json"));

  if (jsonFiles.length === 0) {
    console.log("ℹ️  No training data found to export.");
    return;
  }

  const csvHeaders = [
    "timestamp",
    "userInput",
    "imagePath",
    "imageSize",
    "inputLength",
    "sessionId",
  ];
  const csvRows = [csvHeaders.join(",")];

  jsonFiles.forEach((file) => {
    try {
      const metadata = JSON.parse(
        fs.readFileSync(path.join(TRAINING_DATA_PATH, file), "utf8"),
      );
      const row = [
        metadata.timestamp,
        `"${metadata.userInput}"`,
        `"${metadata.imagePath}"`,
        metadata.imageSize,
        metadata.inputLength,
        metadata.sessionId.substring(0, 8) + "***",
      ];
      csvRows.push(row.join(","));
    } catch (error) {
      console.warn(`⚠️  Could not process ${file}: ${error.message}`);
    }
  });

  const csvContent = csvRows.join("\n");
  const csvPath = path.join(TRAINING_DATA_PATH, "training_data_export.csv");
  fs.writeFileSync(csvPath, csvContent);

  console.log(`✅ Exported ${jsonFiles.length} entries to: ${csvPath}`);
}

function verifyData() {
  console.log("🔍 Verifying training data integrity...\n");

  const files = fs.readdirSync(TRAINING_DATA_PATH);
  const jsonFiles = files.filter((f) => f.endsWith(".json"));
  const imageFiles = files.filter((f) => f.endsWith(".jpg"));

  let errors = 0;
  let verified = 0;

  jsonFiles.forEach((jsonFile) => {
    try {
      const metadata = JSON.parse(
        fs.readFileSync(path.join(TRAINING_DATA_PATH, jsonFile), "utf8"),
      );
      const expectedImageFile = path.basename(metadata.imagePath);

      if (!imageFiles.includes(expectedImageFile)) {
        console.log(`❌ Missing image for ${jsonFile}: ${expectedImageFile}`);
        errors++;
      } else {
        const imagePath = path.join(TRAINING_DATA_PATH, expectedImageFile);
        const imageSize = fs.statSync(imagePath).size;

        if (imageSize !== metadata.imageSize) {
          console.log(
            `⚠️  Size mismatch for ${expectedImageFile}: expected ${metadata.imageSize}, got ${imageSize}`,
          );
          errors++;
        } else {
          verified++;
        }
      }
    } catch (error) {
      console.log(`❌ Invalid JSON file ${jsonFile}: ${error.message}`);
      errors++;
    }
  });

  console.log(`\n📊 Verification Results:`);
  console.log(`   ✅ Verified entries: ${verified}`);
  console.log(`   ❌ Errors found: ${errors}`);

  if (errors === 0) {
    console.log(`\n🎉 All training data is valid and ready for AI training!`);
  }
}

function showHelp() {
  console.log(`
🤖 Captcha Training Data Processor

Usage: node process-training-data.js [options]

Options:
  --stats          Show statistics about collected data
  --export-csv     Export data to CSV format for analysis
  --verify         Verify data integrity (check for missing files, etc.)
  --help           Show this help message

Examples:
  node process-training-data.js --stats
  node process-training-data.js --export-csv
  node process-training-data.js --verify

For AI training preparation:
1. Run --verify to ensure data integrity
2. Run --export-csv to get a structured dataset
3. Use the CSV file with your preferred ML framework
`);
}

// Main execution
const args = process.argv.slice(2);

if (args.length === 0 || args.includes("--help")) {
  showHelp();
} else if (args.includes("--stats")) {
  showStats();
} else if (args.includes("--export-csv")) {
  exportToCsv();
} else if (args.includes("--verify")) {
  verifyData();
} else {
  console.log("❌ Unknown option. Use --help for available options.");
}
