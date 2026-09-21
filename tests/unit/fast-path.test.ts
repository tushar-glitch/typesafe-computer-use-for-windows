import { describe, expect, it } from "vitest";
import { DeepLinkSearchHandler } from "../../src/application/handlers/deep-link-search-handler.js";
import { HandlerChain } from "../../src/application/handlers/handler-chain.js";
import { LaunchAppHandler } from "../../src/application/handlers/launch-app-handler.js";
import { OpenSiteHandler } from "../../src/application/handlers/open-site-handler.js";
import type { ICommandHandler } from "../../src/core/ports/handling.js";
import { completed, unhandled } from "../../src/core/types/command.js";
import { FakeLauncher, spoken } from "../fixtures/fake-launcher.js";

const NEVER_ABORTED = new AbortController().signal;

function chainOf(launcher: FakeLauncher): HandlerChain {
  // Cheapest and most specific first; the order is the design.
  return new HandlerChain([
    new DeepLinkSearchHandler(launcher),
    new LaunchAppHandler(launcher),
    new OpenSiteHandler(launcher),
  ]);
}

describe("LaunchAppHandler", () => {
  it("starts an application that is not running", async () => {
    const launcher = new FakeLauncher();
    const outcome = await new LaunchAppHandler(launcher).execute(spoken("open notepad"), NEVER_ABORTED);

    expect(outcome.status).toBe("completed");
    expect(launcher.launched).toEqual(["notepad"]);
  });

  it("focuses an application already running instead of starting another", async () => {
    const launcher = new FakeLauncher();
    launcher.running.add("chrome");

    await new LaunchAppHandler(launcher).execute(spoken("open chrome"), NEVER_ABORTED);

    expect(launcher.activated).toEqual(["chrome"]);
    expect(launcher.launched).toEqual([]);
  });

  it("declines a website, leaving it for the site handler", () => {
    // "open" is shared between launching and navigating; only the catalog decides.
    expect(new LaunchAppHandler(new FakeLauncher()).canHandle(spoken("open youtube"))).toBe(false);
  });

  it("survives speech filler", async () => {
    const launcher = new FakeLauncher();
    await new LaunchAppHandler(launcher).execute(
      spoken("Hey, can you please open the task manager for me"),
      NEVER_ABORTED,
    );
    expect(launcher.launched).toEqual(["taskmgr"]);
  });
});

describe("OpenSiteHandler", () => {
  it("opens a catalogued site", async () => {
    const launcher = new FakeLauncher();
    await new OpenSiteHandler(launcher).execute(spoken("go to github"), NEVER_ABORTED);
    expect(launcher.opened).toEqual(["https://github.com/"]);
  });

  it("opens a spoken domain with https", async () => {
    const launcher = new FakeLauncher();
    await new OpenSiteHandler(launcher).execute(spoken("go to example.com"), NEVER_ABORTED);
    // Passed through as spoken; the sidecar normalises it via Uri before opening.
    expect(launcher.opened).toEqual(["https://example.com"]);
  });

  it("declines ordinary speech rather than guessing a URL", () => {
    const handler = new OpenSiteHandler(new FakeLauncher());
    expect(handler.canHandle(spoken("open the pod bay doors"))).toBe(false);
  });
});

describe("DeepLinkSearchHandler", () => {
  it("jumps straight to a YouTube results page", async () => {
    const launcher = new FakeLauncher();
    await new DeepLinkSearchHandler(launcher).execute(spoken("play ride it on youtube"), NEVER_ABORTED);

    expect(launcher.opened).toEqual(["https://www.youtube.com/results?search_query=ride%20it"]);
  });

  it("defaults play to YouTube when no site is named", async () => {
    const launcher = new FakeLauncher();
    await new DeepLinkSearchHandler(launcher).execute(spoken("play bohemian rhapsody"), NEVER_ABORTED);

    expect(launcher.opened[0]).toContain("youtube.com/results");
    expect(launcher.opened[0]).toContain("bohemian%20rhapsody");
  });

  it("defaults look-up to a search engine, not YouTube", async () => {
    const launcher = new FakeLauncher();
    await new DeepLinkSearchHandler(launcher).execute(spoken("look up reinforcement learning"), NEVER_ABORTED);

    expect(launcher.opened[0]).toContain("google.com/search");
  });

  it("handles the site leading the terms", async () => {
    const launcher = new FakeLauncher();
    await new DeepLinkSearchHandler(launcher).execute(spoken("search amazon for wireless headphones"), NEVER_ABORTED);

    expect(launcher.opened).toEqual(["https://www.amazon.com/s?k=wireless%20headphones"]);
  });

  it("keeps a query that itself contains the separator", async () => {
    const launcher = new FakeLauncher();
    await new DeepLinkSearchHandler(launcher).execute(spoken("play hold on on youtube"), NEVER_ABORTED);

    expect(launcher.opened[0]).toContain("search_query=hold%20on");
  });

  it("declines when there is no search verb", () => {
    expect(new DeepLinkSearchHandler(new FakeLauncher()).canHandle(spoken("open chrome"))).toBe(false);
  });
});

describe("HandlerChain", () => {
  it("routes each phrase of the demo to the right handler", async () => {
    const launcher = new FakeLauncher();
    const chain = chainOf(launcher);

    await chain.dispatch(spoken("open chrome"), NEVER_ABORTED);
    await chain.dispatch(spoken("open youtube"), NEVER_ABORTED);
    await chain.dispatch(spoken("play ride it"), NEVER_ABORTED);

    expect(launcher.launched).toEqual(["chrome"]);
    expect(launcher.opened).toEqual([
      "https://www.youtube.com/",
      "https://www.youtube.com/results?search_query=ride%20it",
    ]);
  });

  it("reports unhandled when nothing claims the command", async () => {
    const outcome = await chainOf(new FakeLauncher()).dispatch(spoken("make me a sandwich"), NEVER_ABORTED);
    expect(outcome.status).toBe("unhandled");
  });

  it("moves on when a handler claims and then declines", async () => {
    const claimsThenDeclines: ICommandHandler = {
      name: "greedy",
      canHandle: () => true,
      execute: () => Promise.resolve(unhandled("changed my mind")),
    };
    const realOne: ICommandHandler = {
      name: "real",
      canHandle: () => true,
      execute: () => Promise.resolve(completed("done")),
    };

    const outcome = await new HandlerChain([claimsThenDeclines, realOne]).dispatch(spoken("anything"), NEVER_ABORTED);
    expect(outcome).toEqual(completed("done"));
  });

  it("keeps going when a handler throws while deciding", async () => {
    const broken: ICommandHandler = {
      name: "broken",
      canHandle: () => {
        throw new Error("boom");
      },
      execute: () => Promise.resolve(completed("should not run")),
    };

    const launcher = new FakeLauncher();
    const chain = new HandlerChain([broken, new LaunchAppHandler(launcher)]);
    const outcome = await chain.dispatch(spoken("open notepad"), NEVER_ABORTED);

    expect(outcome.status).toBe("completed");
    expect(launcher.launched).toEqual(["notepad"]);
  });

  it("stops immediately when the speaker has superseded the command", async () => {
    const controller = new AbortController();
    controller.abort();

    const outcome = await chainOf(new FakeLauncher()).dispatch(spoken("open chrome"), controller.signal);
    expect(outcome.status).toBe("cancelled");
  });

  it("exposes its order for diagnosis", () => {
    expect(chainOf(new FakeLauncher()).order).toEqual(["deep-link-search", "launch-app", "open-site"]);
  });
});

describe("phrases from a real spoken run", () => {
  it("handles a chained clause and a naming clause", async () => {
    const launcher = new FakeLauncher();
    launcher.running.add("chrome");
    const chain = chainOf(launcher);

    // Verbatim from the demo; both of these failed before the parser learned
    // about connectors and naming clauses.
    await chain.dispatch(spoken("Hey, can you open chrome"), NEVER_ABORTED);
    await chain.dispatch(spoken("and then open youtube"), NEVER_ABORTED);
    await chain.dispatch(spoken("play my favourite song which is Ride It"), NEVER_ABORTED);

    expect(launcher.activated).toEqual(["chrome"]);
    expect(launcher.opened).toEqual([
      "https://www.youtube.com/",
      "https://www.youtube.com/results?search_query=ride%20it",
    ]);
  });
});
