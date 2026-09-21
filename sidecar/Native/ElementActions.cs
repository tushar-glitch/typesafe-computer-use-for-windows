using System.Runtime.InteropServices;
using Interop.UIAutomationClient;
using JevSidecar.Protocol;

namespace JevSidecar.Native;

/// <summary>
/// Acting on a control through the accessibility tree rather than the mouse.
///
/// Preferred over a synthetic click wherever a handle exists. The invocation
/// reaches the control itself, so it still lands when a banner, tooltip or
/// sticky header covers the pixels, and it works on controls scrolled entirely
/// out of view, which no click can reach.
/// </summary>
internal static class ElementActions
{
    /// <summary>
    /// Activate a control, trying each pattern it might support.
    ///
    /// Order matters. Invoke is the plain press. Toggle covers checkboxes,
    /// whose providers often expose nothing else. SelectionItem covers list
    /// rows and tabs. ExpandCollapse is last, because opening a menu is a
    /// weaker reading of "activate" than pressing it.
    /// </summary>
    public static bool Invoke(ElementRegistry registry, string handle)
    {
        IUIAutomationElement element = Resolve(registry, handle);

        return TryPattern<IUIAutomationInvokePattern>(element, UIA_PatternIds.UIA_InvokePatternId, p => p.Invoke())
            || TryPattern<IUIAutomationTogglePattern>(element, UIA_PatternIds.UIA_TogglePatternId, p => p.Toggle())
            || TryPattern<IUIAutomationSelectionItemPattern>(
                element,
                UIA_PatternIds.UIA_SelectionItemPatternId,
                p => p.Select())
            || TryPattern<IUIAutomationExpandCollapsePattern>(
                element,
                UIA_PatternIds.UIA_ExpandCollapsePatternId,
                p => p.Expand());
    }

    /// <summary>
    /// Set a field value in one call and confirm it took.
    ///
    /// One message rather than one per character, and it cannot be stolen
    /// half-way by a page that moves focus mid-word. Providers accept the call
    /// and ignore it often enough that the value is read back: only a field
    /// that genuinely holds the text counts as filled, and the caller falls
    /// back to typing when it does not.
    /// </summary>
    public static bool SetValue(ElementRegistry registry, string handle, string text)
    {
        IUIAutomationElement element = Resolve(registry, handle);

        try
        {
            if (element.GetCurrentPattern(UIA_PatternIds.UIA_ValuePatternId) is not IUIAutomationValuePattern pattern)
            {
                return false;
            }

            if (pattern.CurrentIsReadOnly != 0)
            {
                return false;
            }

            pattern.SetValue(text);
            return (pattern.CurrentValue ?? string.Empty).EndsWith(text, StringComparison.Ordinal);
        }
        catch (COMException)
        {
            return false;
        }
    }

    public static bool Focus(ElementRegistry registry, string handle)
    {
        IUIAutomationElement element = Resolve(registry, handle);

        try
        {
            element.SetFocus();
            return true;
        }
        catch (COMException)
        {
            // Plenty of controls are simply not focusable.
            return false;
        }
    }

    public static string? ReadValue(ElementRegistry registry, string handle)
    {
        IUIAutomationElement element = Resolve(registry, handle);

        try
        {
            return element.GetCurrentPattern(UIA_PatternIds.UIA_ValuePatternId) is IUIAutomationValuePattern pattern
                ? pattern.CurrentValue
                : null;
        }
        catch (COMException)
        {
            return null;
        }
    }

    /// <summary>
    /// The live element behind a handle.
    ///
    /// A handle expires once its generation is retired, which happens after two
    /// further walks. Acting on a stale one is a caller mistake worth naming
    /// rather than a silent no-op.
    /// </summary>
    private static IUIAutomationElement Resolve(ElementRegistry registry, string handle) =>
        registry.Resolve(handle)
        ?? throw new SidecarCommandException(
            "unknown-element",
            $"no live element for handle '{handle}'; it likely belongs to an earlier observation");

    private static bool TryPattern<TPattern>(IUIAutomationElement element, int patternId, Action<TPattern> act)
        where TPattern : class
    {
        try
        {
            if (element.GetCurrentPattern(patternId) is not TPattern pattern)
            {
                return false;
            }

            act(pattern);
            return true;
        }
        catch (COMException)
        {
            // The control advertises the pattern but refuses the call, which is
            // ordinary. Let the next pattern have a turn.
            return false;
        }
    }
}
