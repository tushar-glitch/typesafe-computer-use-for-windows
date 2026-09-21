/**
 * Observes the screen once and prints what the decision model would be offered.
 *
 * The quickest way to see whether perception is working on a given application:
 * how much OCR found, how much the accessibility tree added, and which items
 * came from both.
 *
 *   pnpm demo:observe
 */

import { startSidecar } from "../adapters/windows/sidecar-process.js";
import { WindowsAccessibilityProvider } from "../adapters/windows/windows-accessibility-provider.js";
import { WindowsOcrEngine } from "../adapters/windows/windows-ocr-engine.js";
import { WindowsScreenCapturer } from "../adapters/windows/windows-screen-capturer.js";
import { PerceptionPipeline } from "../application/perception/perception-pipeline.js";

async function main(): Promise<void> {
  const sidecar = startSidecar({ defaultTimeoutMs: 20_000 });

  const pipeline = new PerceptionPipeline(
    new WindowsScreenCapturer(sidecar),
    new WindowsOcrEngine(sidecar),
    new WindowsAccessibilityProvider(sidecar),
  );

  try {
    // Give the OCR engine and the connection a moment, so the timing below
    // reflects a steady-state step rather than a cold start.
    await pipeline.observe();

    const started = performance.now();
    const observation = await pipeline.observe();
    const elapsed = performance.now() - started;

    const { foreground, image, items, offscreen } = observation;
    console.log(`foreground: ${foreground.processName} - ${JSON.stringify(foreground.title.slice(0, 55))}`);
    console.log(`capture:    ${image.size.width}x${image.size.height} at (${image.origin.x}, ${image.origin.y})`);
    console.log(`observed in ${elapsed.toFixed(0)}ms\n`);

    const bySource = { ocr: 0, uia: 0, "uia+ocr": 0 };
    for (const item of items) bySource[item.source]++;
    console.log(`items: ${items.length}  (ocr ${bySource.ocr}, tree ${bySource.uia}, both ${bySource["uia+ocr"]})`);
    console.log(`offscreen controls: ${offscreen.length}`);
    console.log(
      `focused: ${
        observation.focusedField === null
          ? "none"
          : `${observation.focusedField.role} ${JSON.stringify(observation.focusedField.label.slice(0, 30))}`
      }\n`,
    );

    console.log("first 25 items, as the model would see them:");
    for (const item of items.slice(0, 25)) {
      const role = item.role === null ? "" : `${item.role} `;
      const where = `(${item.bounds.x.toFixed(0)},${item.bounds.y.toFixed(0)})`;
      console.log(`  [${String(item.index).padStart(3)}] ${item.source.padEnd(7)} ${where.padEnd(14)} ${role}${JSON.stringify(item.text.slice(0, 52))}`);
    }

    const fused = items.filter((item) => item.source === "uia+ocr");
    if (fused.length > 0) {
      console.log("\nfused (a control sitting on the text that names it):");
      for (const item of fused.slice(0, 8)) console.log(`  ${item.role} ${JSON.stringify(item.text.slice(0, 45))}`);
    }

    const iconOnly = items.filter((item) => item.source === "uia");
    if (iconOnly.length > 0) {
      console.log("\ntree only (invisible to OCR):");
      for (const item of iconOnly.slice(0, 10)) console.log(`  ${item.role} ${JSON.stringify(item.text.slice(0, 45))}`);
    }
  } finally {
    sidecar.close();
  }
}

await main();
