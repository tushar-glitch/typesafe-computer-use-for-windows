import { describe, expect, it } from "vitest";
import {
  afterNamingClause,
  afterPrefix,
  asDomain,
  looksLikeDomain,
  normalize,
  splitOnTarget,
  stripFiller,
  writeSpokenPunctuation,
} from "../../src/application/parsing/utterance.js";

describe("normalize", () => {
  it("lowercases, collapses space and drops terminal punctuation", () => {
    expect(normalize("  Open   Chrome, please! ")).toBe("open chrome please");
  });
});

describe("stripFiller", () => {
  it("removes stacked openers", () => {
    expect(stripFiller("Hey, can you please open chrome")).toBe("open chrome");
    expect(stripFiller("ok so now open notepad")).toBe("open notepad");
  });

  it("removes trailing filler", () => {
    expect(stripFiller("open chrome for me please")).toBe("open chrome");
  });

  it("is idempotent", () => {
    const once = stripFiller("hey please open chrome please");
    expect(stripFiller(once)).toBe(once);
  });

  it("returns empty for pure filler, which is not a command", () => {
    expect(stripFiller("hey")).toBe("");
    expect(stripFiller("um, okay")).toBe("");
  });
});

describe("afterPrefix", () => {
  it("returns the remainder after the longest matching prefix", () => {
    expect(afterPrefix("go to youtube", ["go", "go to"])).toBe("youtube");
  });

  it("returns null when a prefix matches but names nothing", () => {
    // "open" alone is not yet a command; the speaker is mid-sentence.
    expect(afterPrefix("open", ["open"])).toBeNull();
  });

  it("returns null when nothing matches", () => {
    expect(afterPrefix("play a song", ["open", "launch"])).toBeNull();
  });
});

describe("splitOnTarget", () => {
  it("splits subject from target", () => {
    expect(splitOnTarget("ride it on youtube")).toEqual({ subject: "ride it", target: "youtube" });
  });

  it("splits at the rightmost separator so the query may contain one", () => {
    expect(splitOnTarget("hold on on youtube")).toEqual({ subject: "hold on", target: "youtube" });
  });

  it("reports no target when there is no separator", () => {
    expect(splitOnTarget("best headphones")).toEqual({ subject: "best headphones", target: null });
  });
});

describe("looksLikeDomain", () => {
  it("accepts things a person would call a website", () => {
    expect(looksLikeDomain("example.com")).toBe(true);
    expect(looksLikeDomain("https://news.ycombinator.com/newest")).toBe(true);
  });

  it("rejects ordinary speech, because a false positive navigates away", () => {
    expect(looksLikeDomain("play ride it")).toBe(false);
    expect(looksLikeDomain("open the browser")).toBe(false);
    expect(looksLikeDomain("e.g")).toBe(false);
  });
});

describe("connectors in continuous speech", () => {
  it("strips the connector that chains one clause to the next", () => {
    // Found by running the real demo: every clause after the first arrives
    // glued to a connector and matched no verb without this.
    expect(stripFiller("and then open youtube")).toBe("open youtube");
    expect(stripFiller("after that play ride it")).toBe("play ride it");
    expect(stripFiller("then also open notepad")).toBe("open notepad");
  });
});

describe("afterNamingClause", () => {
  it("takes the name rather than the description around it", () => {
    expect(afterNamingClause("my favourite song which is ride it")).toBe("ride it");
    expect(afterNamingClause("a film called arrival")).toBe("arrival");
  });

  it("takes the last marker when speech stacks them", () => {
    expect(afterNamingClause("the thing which is the song called hold on")).toBe("hold on");
  });

  it("returns null when nothing is being named", () => {
    expect(afterNamingClause("wireless headphones")).toBeNull();
  });

  it("returns null when the marker ends the phrase mid-sentence", () => {
    expect(afterNamingClause("my favourite song which is")).toBeNull();
  });
});

describe("spoken addresses", () => {
  it("writes out dictated punctuation", () => {
    // Deepgram transcribes what it hears, and nobody says "full stop".
    expect(writeSpokenPunctuation("binance dot com")).toBe("binance.com");
    expect(writeSpokenPunctuation("news dot ycombinator dot com slash newest")).toBe(
      "news.ycombinator.com/newest",
    );
    expect(writeSpokenPunctuation("my dash site dot co dot uk")).toBe("my-site.co.uk");
  });

  it("recognises a dictated address as an address", () => {
    // Found in a real spoken run: "open binance dot com" was not recognised,
    // so it fell through to the screen loop instead of opening a browser.
    expect(asDomain("binance dot com")).toBe("binance.com");
    expect(looksLikeDomain("binance dot com")).toBe(true);
  });

  it("still accepts an address said as one word", () => {
    expect(asDomain("example.com")).toBe("example.com");
  });

  it("leaves ordinary prose containing the word dot alone", () => {
    expect(asDomain("connect the dots for me")).toBeNull();
    expect(asDomain("play dot matrix music")).toBeNull();
  });
});
