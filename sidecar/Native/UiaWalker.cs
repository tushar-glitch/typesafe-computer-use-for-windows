using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Automation;
using JevSidecar.Protocol;

namespace JevSidecar.Native;

/// <summary>
/// The foreground window's controls, read from the UI Automation tree.
///
/// This is the source OCR cannot replace: an icon-only toolbar button carries
/// no text, so it exists here and nowhere else.
///
/// Performance is the whole design. Read naively, every property access is a
/// cross-process call, the equivalent of a network round trip to read one
/// field, and a walk of a browser window takes seconds. So the tree is fetched
/// once with a CacheRequest naming every property up front, and each element is
/// then read from that local snapshot without leaving the process.
/// </summary>
internal static class UiaWalker
{
    /// <summary>Elements past this are dropped; a browser can expose tens of thousands.</summary>
    private const int MaxElements = 4000;

    /// <summary>Narrower than this in either axis is a separator or a clipped sliver, not a target.</summary>
    private const double MinSidePixels = 4.0;

    private const int MaxLabelLength = 120;

    private const int MaxValueLength = 300;

    public static UiaTreeDto Walk(ElementRegistry registry, RectDto display)
    {
        Stopwatch clock = Stopwatch.StartNew();

        IntPtr window = NativeMethods.GetForegroundWindow();
        if (window == IntPtr.Zero)
        {
            throw new SidecarCommandException("no-foreground-window", "nothing currently holds the foreground");
        }

        AutomationElement root = AutomationElement.FromHandle(window)
            ?? throw new SidecarCommandException("no-automation-root", "the foreground window exposes no automation element");

        AutomationElementCollection found = FetchSubtree(root);
        double fetchMs = clock.Elapsed.TotalMilliseconds;

        _ = registry.BeginGeneration();
        List<UiaElementDto> onscreen = [];
        List<UiaElementDto> offscreen = [];
        Rect displayRect = new(display.X, display.Y, display.Width, display.Height);
        int examined = 0;
        int skipped = 0;
        bool truncated = false;

        foreach (AutomationElement element in found)
        {
            if (examined >= MaxElements)
            {
                truncated = true;
                break;
            }

            examined++;

            Classified? classified;
            try
            {
                classified = Classify(element, displayRect);
            }
            catch (Exception)
            {
                // One hostile element must never cost the whole observation.
                // Providers throw all sorts from cached reads under churn.
                skipped++;
                continue;
            }

            if (classified is null)
            {
                continue;
            }

            string handle = registry.Add(element);
            UiaElementDto dto = new(classified.Role, classified.Label, classified.Bounds, classified.Invokable, handle);

            if (classified.Visible)
            {
                onscreen.Add(dto);
            }
            else if (classified.Invokable)
            {
                // Only worth offering when it can actually be activated: there is
                // no pixel to click, so invocation is the only way to reach it.
                offscreen.Add(dto);
            }
        }

        return new UiaTreeDto(
            Onscreen: onscreen,
            Offscreen: offscreen,
            FocusedField: ReadFocusedField(registry),
            Truncated: truncated,
            Examined: examined,
            Skipped: skipped,
            FetchMs: fetchMs,
            ClassifyMs: clock.Elapsed.TotalMilliseconds - fetchMs,
            ElapsedMs: clock.Elapsed.TotalMilliseconds);
    }

    /// <summary>
    /// One bulk fetch of the control view, with every property we will read.
    ///
    /// TreeFilter restricts the walk to the control view, which skips the
    /// layout scaffolding that makes up most of a modern application raw tree.
    /// </summary>
    private static AutomationElementCollection FetchSubtree(AutomationElement root)
    {
        CacheRequest request = new()
        {
            TreeScope = TreeScope.Subtree,
            TreeFilter = Automation.ControlViewCondition,
            AutomationElementMode = AutomationElementMode.Full,
        };

        request.Add(AutomationElement.NameProperty);
        request.Add(AutomationElement.ControlTypeProperty);
        request.Add(AutomationElement.BoundingRectangleProperty);
        request.Add(AutomationElement.IsOffscreenProperty);
        request.Add(AutomationElement.IsEnabledProperty);
        request.Add(AutomationElement.HelpTextProperty);
        request.Add(AutomationElement.IsInvokePatternAvailableProperty);
        request.Add(AutomationElement.IsTogglePatternAvailableProperty);
        request.Add(AutomationElement.IsSelectionItemPatternAvailableProperty);
        request.Add(AutomationElement.IsExpandCollapsePatternAvailableProperty);
        request.Add(AutomationElement.IsValuePatternAvailableProperty);

        // Filter in the provider, not here. An unconditional Subtree FindAll
        // marshals every node of an Electron or Chromium tree across the
        // process boundary, which measured 13 seconds on a single window. The
        // conditions below are evaluated on the far side, so only candidate
        // controls are ever sent.
        System.Windows.Automation.Condition candidates = new AndCondition(
            new PropertyCondition(AutomationElement.IsControlElementProperty, true),
            new PropertyCondition(AutomationElement.IsEnabledProperty, true),
            new PropertyCondition(AutomationElement.IsOffscreenProperty, false));

        using (request.Activate())
        {
            return root.FindAll(TreeScope.Subtree, candidates);
        }
    }

    private sealed record Classified(string Role, string Label, RectDto Bounds, bool Invokable, bool Visible);

    /// <summary>Null for anything not worth offering as a target.</summary>
    private static Classified? Classify(AutomationElement element, Rect display)
    {
        // Every read below can fail even though the values were cached: the
        // provider may have gone away since the fetch, and a UI as lively as a
        // browser guarantees some will. The failure arrives as a raw
        // COMException (UIA_E_ELEMENTNOTAVAILABLE, 0x80040201) rather than the
        // managed ElementNotAvailableException, so all three are caught, and a
        // dead element is simply skipped rather than ending the walk.
        AutomationElement.AutomationElementInformation cached;
        bool enabled;
        Rect bounds;
        string label;
        ControlType? controlType;
        bool offscreen;
        try
        {
            cached = element.Cached;
            enabled = cached.IsEnabled;
            bounds = cached.BoundingRectangle;
            controlType = cached.ControlType;
            offscreen = cached.IsOffscreen;
            label = Label(cached);
        }
        catch (COMException)
        {
            return null;
        }
        catch (ElementNotAvailableException)
        {
            return null;
        }
        catch (InvalidOperationException)
        {
            return null;
        }

        if (!enabled)
        {
            return null;
        }

        if (label.Length == 0)
        {
            // Unlabelled controls cannot be described to the model or told apart.
            return null;
        }

        if (bounds.IsEmpty || double.IsInfinity(bounds.Width) || double.IsInfinity(bounds.Height))
        {
            return null;
        }

        if (bounds.Width < MinSidePixels || bounds.Height < MinSidePixels)
        {
            return null;
        }

        string role = RoleMap.For(controlType);
        bool invokable = Invokable(element);

        // Visible means the provider says it is on screen AND it actually
        // overlaps the display. Providers lie in both directions, so both hold.
        bool visible = !offscreen && display.IntersectsWith(bounds);

        return new Classified(role, label, ToDto(bounds), invokable, visible);
    }

    private static string Label(AutomationElement.AutomationElementInformation cached)
    {
        string name = cached.Name?.Trim() ?? string.Empty;
        if (name.Length > 0)
        {
            return Shorten(name);
        }

        // Icon-only buttons often carry only a tooltip.
        string help = cached.HelpText?.Trim() ?? string.Empty;
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
    /// Pattern availability is not on the cached info struct, so it is read
    /// from the cache by property. Still no cross-process call: these were all
    /// named in the CacheRequest.
    /// </summary>
    private static bool Invokable(AutomationElement element) =>
        CachedFlag(element, AutomationElement.IsInvokePatternAvailableProperty)
        || CachedFlag(element, AutomationElement.IsTogglePatternAvailableProperty)
        || CachedFlag(element, AutomationElement.IsSelectionItemPatternAvailableProperty)
        || CachedFlag(element, AutomationElement.IsExpandCollapsePatternAvailableProperty);

    private static bool CachedFlag(AutomationElement element, AutomationProperty property)
    {
        try
        {
            return element.GetCachedPropertyValue(property) is bool flag && flag;
        }
        catch (COMException)
        {
            return false;
        }
        catch (InvalidOperationException)
        {
            return false;
        }
    }

    private static FocusedFieldDto? ReadFocusedField(ElementRegistry registry)
    {
        AutomationElement? focused;
        try
        {
            focused = AutomationElement.FocusedElement;
        }
        catch (ElementNotAvailableException)
        {
            return null;
        }

        if (focused is null)
        {
            return null;
        }

        try
        {
            // Read live: the focused element was not part of the cached fetch.
            AutomationElement.AutomationElementInformation current = focused.Current;
            string role = RoleMap.For(current.ControlType);

            return new FocusedFieldDto(
                Role: role,
                Label: Shorten(current.Name?.Trim() ?? string.Empty),
                Placeholder: Shorten(current.HelpText?.Trim() ?? string.Empty),
                Value: current.IsPassword ? string.Empty : ReadValue(focused),
                Bounds: ToDto(current.BoundingRectangle),
                Handle: registry.Add(focused),
                IsEditable: RoleMap.IsEditable(role));
        }
        catch (ElementNotAvailableException)
        {
            return null;
        }
        catch (COMException)
        {
            return null;
        }
    }

    private static string ReadValue(AutomationElement element)
    {
        try
        {
            if (!element.TryGetCurrentPattern(ValuePattern.Pattern, out object? pattern) || pattern is not ValuePattern value)
            {
                return string.Empty;
            }

            string text = value.Current.Value ?? string.Empty;
            return text.Length <= MaxValueLength ? text : text[..MaxValueLength];
        }
        catch (COMException)
        {
            return string.Empty;
        }
        catch (ElementNotAvailableException)
        {
            return string.Empty;
        }
    }

    private static RectDto ToDto(Rect rect) => new(rect.X, rect.Y, rect.Width, rect.Height);
}
