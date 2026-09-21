import { describe, expect, it } from "vitest";
import { AppCatalog, SiteCatalog } from "../../src/application/catalog/catalogs.js";

describe("AppCatalog", () => {
  const apps = new AppCatalog();

  it("resolves aliases to one app", () => {
    expect(apps.resolve("google chrome")?.appId).toBe("chrome");
    expect(apps.resolve("Chrome")?.appId).toBe("chrome");
    expect(apps.resolve("file explorer")?.processName).toBe("explorer");
  });

  it("returns null for anything not named", () => {
    expect(apps.resolve("photoshop")).toBeNull();
  });

  it("finds an app mentioned inside a phrase", () => {
    expect(apps.find("please open task manager now")?.appId).toBe("taskmgr");
  });
});

describe("SiteCatalog", () => {
  const sites = new SiteCatalog();

  it("resolves aliases", () => {
    expect(sites.resolve("yt")?.url).toBe("https://www.youtube.com/");
    expect(sites.resolve("you tube")?.url).toBe("https://www.youtube.com/");
  });

  it("prefers the longest alias", () => {
    // "google calendar" must not be swallowed by "google".
    expect(sites.find("open google calendar")?.url).toBe("https://calendar.google.com/");
  });

  it("matches whole words only", () => {
    // The site aliased "x" must not fire inside another word.
    expect(sites.find("play xylophone music")).toBeNull();
  });

  it("builds an encoded search URL", () => {
    const youtube = sites.resolve("youtube");
    expect(youtube).not.toBeNull();
    expect(sites.searchUrl(youtube!, "ride it")).toBe("https://www.youtube.com/results?search_query=ride%20it");
  });

  it("returns null for a site with no search endpoint", () => {
    const linkedin = sites.resolve("linkedin");
    expect(sites.searchUrl(linkedin!, "anything")).toBeNull();
  });

  it("returns null for an empty query", () => {
    const google = sites.resolve("google");
    expect(sites.searchUrl(google!, "   ")).toBeNull();
  });
});
