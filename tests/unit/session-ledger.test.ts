import { describe, expect, it } from "vitest";
import { describeAge, referentLabel, SessionLedger } from "../../src/application/session/session-ledger.js";
import { completed, failed, type CommandId } from "../../src/core/types/command.js";
import { milliseconds } from "../../src/core/types/scalars.js";
import { FakeClock } from "../fixtures/fake-clock.js";
import { spoken } from "../fixtures/fake-launcher.js";
import { observation } from "../fixtures/fake-perception.js";

function withId(text: string, id: string) {
  return { ...spoken(text), id: id as CommandId };
}

describe("SessionLedger tasks", () => {
  it("remembers what was asked and what happened", () => {
    const ledger = new SessionLedger(new FakeClock());

    ledger.recordTask(withId("open chatgpt", "c1"), completed("opened https://chatgpt.com/"));
    const snapshot = ledger.snapshot();

    expect(snapshot.recentTasks).toHaveLength(1);
    expect(snapshot.recentTasks[0]?.said).toBe("open chatgpt");
    expect(snapshot.recentTasks[0]?.result).toBe("completed");
    expect(snapshot.recentTasks[0]?.summary).toContain("chatgpt.com");
  });

  it("keeps failures, which are what a follow-up often reacts to", () => {
    const ledger = new SessionLedger(new FakeClock());
    ledger.recordTask(withId("play a song", "c1"), failed("nothing on screen helped"));

    expect(ledger.snapshot().recentTasks[0]?.result).toBe("failed");
  });

  it("keeps history bounded over a long session", () => {
    const ledger = new SessionLedger(new FakeClock(), { maxTasks: 3 });

    for (let i = 0; i < 10; i++) {
      ledger.recordTask(withId(`task ${i}`, `c${i}`), completed("fine"));
    }

    const tasks = ledger.snapshot().recentTasks;
    expect(tasks).toHaveLength(3);
    // Oldest dropped, order preserved.
    expect(tasks.map((task) => task.said)).toEqual(["task 7", "task 8", "task 9"]);
  });

  it("knows whether a command was already recorded", () => {
    const ledger = new SessionLedger(new FakeClock());
    const command = withId("open notepad", "c1");

    expect(ledger.hasTask(command.id)).toBe(false);
    ledger.recordTask(command, completed("started notepad"));
    expect(ledger.hasTask(command.id)).toBe(true);
  });
});

describe("SessionLedger referents", () => {
  it("offers what was recently opened, most recent first", () => {
    const clock = new FakeClock();
    const ledger = new SessionLedger(clock);

    ledger.remember("website", "https://youtube.com/", "youtube.com");
    clock.advance(5_000);
    ledger.remember("website", "https://chatgpt.com/", "chatgpt.com");

    const referents = ledger.snapshot().referents;
    expect(referents.map((r) => r.target)).toEqual(["https://chatgpt.com/", "https://youtube.com/"]);
  });

  it("refreshes rather than duplicates when the same thing recurs", () => {
    const clock = new FakeClock();
    const ledger = new SessionLedger(clock);

    ledger.remember("app", "chrome", "chrome");
    clock.advance(30_000);
    ledger.remember("website", "https://x.com/", "x.com");
    clock.advance(30_000);
    ledger.remember("app", "chrome", "chrome");

    const referents = ledger.snapshot().referents;
    expect(referents).toHaveLength(2);
    // Opening it again makes it the most recent, not a second entry.
    expect(referents[0]?.target).toBe("chrome");
  });

  it("forgets what is too old to be what someone means", () => {
    const clock = new FakeClock();
    const ledger = new SessionLedger(clock, { referentTtlMs: 60_000 });

    ledger.remember("website", "https://youtube.com/", "youtube.com");
    clock.advance(59_000);
    expect(ledger.snapshot().referents).toHaveLength(1);

    clock.advance(2_000);
    // An hour into a session, a site from the start is not what "it" means.
    expect(ledger.snapshot().referents).toHaveLength(0);
  });

  it("caps how many candidates are ever offered", () => {
    const clock = new FakeClock();
    const ledger = new SessionLedger(clock, { maxReferents: 4 });

    for (let i = 0; i < 12; i++) {
      ledger.remember("website", `https://site${i}.com/`, `site${i}.com`);
      clock.advance(1_000);
    }

    expect(ledger.snapshot().referents).toHaveLength(4);
  });
});

describe("SessionLedger world", () => {
  it("tracks where things currently stand", () => {
    const ledger = new SessionLedger(new FakeClock());

    ledger.observeWorld(
      observation({
        foreground: {
          processId: 1,
          processName: "chrome",
          title: "ChatGPT",
          bounds: { x: 0, y: 0, width: 800, height: 600 },
        },
        browserUrl: "https://chatgpt.com/",
      }),
    );

    expect(ledger.snapshot().world).toEqual({
      foregroundApp: "chrome",
      windowTitle: "ChatGPT",
      browserUrl: "https://chatgpt.com/",
    });
  });
});

describe("describing age", () => {
  it("reads the way a person would say it", () => {
    const now = milliseconds(3_600_000);
    expect(describeAge(milliseconds(3_600_000 - 3_000), now)).toBe("just now");
    expect(describeAge(milliseconds(3_600_000 - 30_000), now)).toBe("30s ago");
    expect(describeAge(milliseconds(3_600_000 - 300_000), now)).toBe("5m ago");
    expect(describeAge(milliseconds(0), now)).toBe("1h ago");
  });

  it("labels a referent so a person could recognise it", () => {
    const now = milliseconds(60_000);
    expect(referentLabel("website", "chatgpt.com", milliseconds(40_000), now)).toBe(
      "chatgpt.com (a website, 20s ago)",
    );
  });
});
