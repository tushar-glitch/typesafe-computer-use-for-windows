using System.Diagnostics;
using System.Runtime.InteropServices;
using Interop.UIAutomationClient;
using JevSidecar.Protocol;

namespace JevSidecar.Native;

/// <summary>
/// The foreground window controls, read from the UI Automation tree.
///
/// This is the source OCR cannot replace: an icon-only toolbar button carries
/// no text, so it exists here and nowhere else.
///
/// The design is dictated by one measured fact. Asking a provider for an entire
/// subtree costs roughly 12 seconds on a Chromium or Electron window, through
/// the native COM API and the managed wrapper alike, and repeating it wedges
/// the UIA service outright. Reading cached properties, by contrast, is
/// essentially free: 2,720 elements in 14ms.
///
/// So the tree is never requested whole. It is descended one level at a time,
/// each level fetched with all its properties in a single cached call, subtrees
/// that cannot contain anything visible are never entered, and the walk
/// abandons itself at a deadline and returns what it has. A partial tree is
/// useful; a walk that blows the step budget is not.
/// </summary>
internal static class UiaWalker
{
    /// <summary>Elements past this are dropped; a browser can expose tens of thousands.</summary>
    private const int MaxElements = 3000;

    /// <summary>
    /// Wall-clock ceiling for the whole walk. Perception has to fit inside one
    /// step alongside capture and OCR, so the tree gets what is left over.
    /// </summary>
    private const int DefaultBudgetMs = 400;

    /// <summary>Narrower than this in either axis is a separator or a clipped sliver, not a target.</summary>
    private const double MinSidePixels = 4.0;

    private const int MaxLabelLength = 120;

    private const int MaxValueLength = 300;

    /// <summary>Guards against a pathological or cyclic tree.</summary>
    private const int MaxDepth = 40;

    public static UiaTreeDto Walk(ElementRegistry registry, RectDto display, int budgetMs = DefaultBudgetMs)
    {
        Stopwatch clock = Stopwatch.StartNew();

        IntPtr window = NativeMethods.GetForegroundWindow();
        if (window == IntPtr.Zero)
        {
            throw new SidecarCommandException("no-foreground-window", "nothing currently holds the foreground");
        }

        IUIAutomation automation = new CUIAutomation8();
        IUIAutomationElement root;
        try
        {
            root = automation.ElementFromHandle(window);
        }
        catch (COMException error)
        {
            throw new SidecarCommandException(
                "no-automation-root",
                $"the foreground window exposes no automation element: {error.Message}");
        }

        IUIAutomationCacheRequest cache = BuildCacheRequest(automation);
        IUIAutomationCondition anyChild = automation.CreateTrueCondition();

        double setupMs = clock.Elapsed.TotalMilliseconds;

        _ = registry.BeginGeneration();
        List<UiaElementDto> onscreen = [];
        List<UiaElementDto> offscreen = [];
        int examined = 0;
        int skipped = 0;
        bool truncated = false;

        // Level by level, breadth-first, rather than one descendants query.
        //
        // Both were measured. A single FindAllBuildCache over TreeScope_Descendants
        // exceeded 400ms even on File Explorer and returned nothing usable,
        // because the provider still walks its entire tree before applying the
        // condition; unfiltered on a Chromium window it takes twelve seconds.
        // Descending a level at a time costs a round trip per parent, but each
        // one is cheap, results accumulate as they arrive, and the walk can be
        // abandoned at any point with everything found so far still useful.
        //
        // Breadth-first because the controls a user can reach sit near the top
        // of the tree: when the budget runs out, the useful ones are already in.
        Queue<(IUIAutomationElement Element, int Depth)> frontier = new();
        frontier.Enqueue((root, 0));

        while (frontier.Count > 0)
        {
            if (clock.Elapsed.TotalMilliseconds > budgetMs || examined >= MaxElements)
            {
                truncated = true;
                break;
            }

            (IUIAutomationElement parent, int depth) = frontier.Dequeue();
            if (depth >= MaxDepth)
            {
                continue;
            }

            IUIAutomationElementArray level;
            int count;
            try
            {
                // Every child, not only control elements: filtering here would
                // also remove the plain wrappers that real controls hang
                // beneath, and the walk would stop at the first such layer.
                // What is worth OFFERING is decided in Classify; what is worth
                // WALKING THROUGH is a separate question.
                level = parent.FindAllBuildCache(TreeScope.TreeScope_Children, anyChild, cache);
                count = level.Length;
            }
            catch (COMException)
            {
                // A provider that will not answer for one node is no reason to
                // abandon its siblings.
                skipped++;
                continue;
            }

            for (int i = 0; i < count && examined < MaxElements; i++)
            {
                examined++;

                IUIAutomationElement child;
                Classified classified;
                try
                {
                    child = level.GetElement(i);
                    classified = Classify(child, display);
                }
                catch (COMException)
                {
                    // Elements vanish mid-walk constantly in a live UI. The
                    // failure arrives as a raw COMException, commonly
                    // UIA_E_ELEMENTNOTAVAILABLE (0x80040201).
                    skipped++;
                    continue;
                }

                if (classified.Offered)
                {
                    string handle = registry.Add(child);
                    UiaElementDto dto = new(
                        classified.Role,
                        classified.Label,
                        classified.Bounds,
                        classified.Invokable,
                        handle);

                    if (classified.Visible)
                    {
                        onscreen.Add(dto);
                    }
                    else
                    {
                        // No pixel points at it, so invocation is the only route.
                        offscreen.Add(dto);
                    }
                }

                if (classified.Descend)
                {
                    frontier.Enqueue((child, depth + 1));
                }
            }
        }

        return new UiaTreeDto(
            Onscreen: onscreen,
            Offscreen: offscreen,
            FocusedField: ReadFocusedField(automation, registry),
            Truncated: truncated,
            Examined: examined,
            Skipped: skipped,
            FetchMs: setupMs,
            ClassifyMs: clock.Elapsed.TotalMilliseconds - setupMs,
            ElapsedMs: clock.Elapsed.TotalMilliseconds);
    }

    /// <summary>
    /// Every property the walk reads, named once so each level arrives complete.
    ///
    /// AutomationElementMode_Full rather than None: these elements are kept in
    /// the registry and invoked later, which a lightweight element cannot do.
    /// </summary>
    private static IUIAutomationCacheRequest BuildCacheRequest(IUIAutomation automation)
    {
        IUIAutomationCacheRequest cache = automation.CreateCacheRequest();
        cache.AddProperty(UIA_PropertyIds.UIA_NamePropertyId);
        cache.AddProperty(UIA_PropertyIds.UIA_ControlTypePropertyId);
        cache.AddProperty(UIA_PropertyIds.UIA_BoundingRectanglePropertyId);
        cache.AddProperty(UIA_PropertyIds.UIA_IsOffscreenPropertyId);
        cache.AddProperty(UIA_PropertyIds.UIA_IsEnabledPropertyId);
        cache.AddProperty(UIA_PropertyIds.UIA_HelpTextPropertyId);
        cache.AddProperty(UIA_PropertyIds.UIA_IsInvokePatternAvailablePropertyId);
        cache.AddProperty(UIA_PropertyIds.UIA_IsTogglePatternAvailablePropertyId);
        cache.AddProperty(UIA_PropertyIds.UIA_IsSelectionItemPatternAvailablePropertyId);
        cache.AddProperty(UIA_PropertyIds.UIA_IsExpandCollapsePatternAvailablePropertyId);
        cache.TreeScope = TreeScope.TreeScope_Element;
        cache.TreeFilter = automation.ControlViewCondition;
        cache.AutomationElementMode = AutomationElementMode.AutomationElementMode_Full;
        return cache;
    }

    /// <param name="Offered">Worth showing to the decision model as a target.</param>
    /// <param name="Descend">Worth walking into for more controls.</param>
    private sealed record Classified(
        string Role,
        string Label,
        RectDto Bounds,
        bool Invokable,
        bool Visible,
        bool Offered,
        bool Descend);

    private static readonly Classified Container =
        new("other", string.Empty, new RectDto(0, 0, 0, 0), false, false, Offered: false, Descend: true);

    private static Classified Classify(IUIAutomationElement element, RectDto display)
    {
        tagRECT raw = element.CachedBoundingRectangle;
        double width = raw.right - raw.left;
        double height = raw.bottom - raw.top;

        // An element reporting no rectangle is usually a layout container: not a
        // target itself, but its children may well be, so the walk goes in.
        if (width <= 0 || height <= 0)
        {
            return Container;
        }

        RectDto bounds = new(raw.left, raw.top, width, height);
        bool overlapsDisplay = Overlaps(bounds, display);

        // The pruning rule that makes the walk affordable: a subtree wholly off
        // the display cannot contain anything the user can see. Chromium parks
        // scrolled-out content far outside the viewport, which is most of a page.
        bool descend = overlapsDisplay;

        string label = Label(element);
        bool enabled = element.CachedIsEnabled != 0;

        if (label.Length == 0 || !enabled || width < MinSidePixels || height < MinSidePixels)
        {
            return new Classified("other", label, bounds, false, false, Offered: false, Descend: descend);
        }

        bool invokable = Invokable(element);

        // Providers misreport visibility in both directions, so the claim and
        // the geometry must agree.
        bool visible = element.CachedIsOffscreen == 0 && overlapsDisplay;

        return new Classified(
            RoleMap.For(element.CachedControlType),
            label,
            bounds,
            invokable,
            visible,
            // Off-screen entries earn their place only if they can be activated
            // without a pixel to aim at.
            Offered: visible || invokable,
            Descend: descend);
    }

    private static bool Overlaps(RectDto a, RectDto b) =>
        a.X < b.X + b.Width && b.X < a.X + a.Width && a.Y < b.Y + b.Height && b.Y < a.Y + a.Height;

    private static string Label(IUIAutomationElement element)
    {
        string name = (element.CachedName ?? string.Empty).Trim();
        if (name.Length > 0)
        {
            return Shorten(name);
        }

        // Icon-only buttons often carry only a tooltip.
        string help = (element.CachedHelpText ?? string.Empty).Trim();
        return help.Length > 0 ? Shorten(help) : string.Empty;
    }

    /// <summary>Labels go into model criteria; a paragraph-long one is noise.</summary>
    private static string Shorten(string text)
    {
        string collapsed = string.Join(" ", text.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));
        return collapsed.Length <= MaxLabelLength ? collapsed : collapsed[..MaxLabelLength];
    }

    /// <summary>
    /// Whether the control can be activated without a mouse.
    ///
    /// The COM interface exposes no named accessor for pattern availability, so
    /// these are read by property id. Still no cross-process call: all four
    /// were named in the cache request.
    /// </summary>
    private static bool Invokable(IUIAutomationElement element) =>
        CachedFlag(element, UIA_PropertyIds.UIA_IsInvokePatternAvailablePropertyId)
        || CachedFlag(element, UIA_PropertyIds.UIA_IsTogglePatternAvailablePropertyId)
        || CachedFlag(element, UIA_PropertyIds.UIA_IsSelectionItemPatternAvailablePropertyId)
        || CachedFlag(element, UIA_PropertyIds.UIA_IsExpandCollapsePatternAvailablePropertyId);

    /// <summary>A cached BOOL, which marshals back as either a bool or an int.</summary>
    private static bool CachedFlag(IUIAutomationElement element, int propertyId)
    {
        try
        {
            return element.GetCachedPropertyValue(propertyId) switch
            {
                bool flag => flag,
                int number => number != 0,
                _ => false,
            };
        }
        catch (COMException)
        {
            return false;
        }
    }

    /// <summary>Exposed so the focused element can be read without walking the tree.</summary>
    public static FocusedFieldDto? ReadFocusedField(IUIAutomation automation, ElementRegistry registry)
    {
        try
        {
            IUIAutomationElement? focused = automation.GetFocusedElement();
            if (focused is null)
            {
                return null;
            }

            string role = RoleMap.For(focused.CurrentControlType);
            tagRECT raw = focused.CurrentBoundingRectangle;

            return new FocusedFieldDto(
                Role: role,
                Label: Shorten((focused.CurrentName ?? string.Empty).Trim()),
                Placeholder: Shorten((focused.CurrentHelpText ?? string.Empty).Trim()),
                Value: focused.CurrentIsPassword != 0 ? string.Empty : ReadValue(focused),
                Bounds: new RectDto(raw.left, raw.top, raw.right - raw.left, raw.bottom - raw.top),
                Handle: registry.Add(focused),
                IsEditable: RoleMap.IsEditable(role));
        }
        catch (COMException)
        {
            return null;
        }
    }

    private static string ReadValue(IUIAutomationElement element)
    {
        try
        {
            if (element.GetCurrentPattern(UIA_PatternIds.UIA_ValuePatternId) is not IUIAutomationValuePattern pattern)
            {
                return string.Empty;
            }

            string text = pattern.CurrentValue ?? string.Empty;
            return text.Length <= MaxValueLength ? text : text[..MaxValueLength];
        }
        catch (COMException)
        {
            return string.Empty;
        }
    }
}
