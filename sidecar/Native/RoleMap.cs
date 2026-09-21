using Interop.UIAutomationClient;

namespace JevSidecar.Native;

/// <summary>
/// UI Automation control types as the one short word the decision model reads.
///
/// The model compares options as text, so "button" must mean the same thing in
/// every app. Anything unmapped becomes "other" rather than leaking a raw
/// control-type id into the criteria.
/// </summary>
internal static class RoleMap
{
    private static readonly Dictionary<int, string> ByControlTypeId = new()
    {
        [UIA_ControlTypeIds.UIA_ButtonControlTypeId] = "button",
        [UIA_ControlTypeIds.UIA_SplitButtonControlTypeId] = "button",
        [UIA_ControlTypeIds.UIA_HyperlinkControlTypeId] = "link",
        [UIA_ControlTypeIds.UIA_EditControlTypeId] = "field",
        [UIA_ControlTypeIds.UIA_DocumentControlTypeId] = "field",
        [UIA_ControlTypeIds.UIA_CheckBoxControlTypeId] = "checkbox",
        [UIA_ControlTypeIds.UIA_RadioButtonControlTypeId] = "radio",
        [UIA_ControlTypeIds.UIA_TabItemControlTypeId] = "tab",
        [UIA_ControlTypeIds.UIA_MenuItemControlTypeId] = "menu",
        [UIA_ControlTypeIds.UIA_ListItemControlTypeId] = "list item",
        [UIA_ControlTypeIds.UIA_TreeItemControlTypeId] = "list item",
        [UIA_ControlTypeIds.UIA_DataItemControlTypeId] = "cell",
        [UIA_ControlTypeIds.UIA_ImageControlTypeId] = "image",
        [UIA_ControlTypeIds.UIA_SliderControlTypeId] = "slider",
        [UIA_ControlTypeIds.UIA_ComboBoxControlTypeId] = "combo",
    };

    /// <summary>Roles whose contents the user types into.</summary>
    private static readonly HashSet<string> EditableRoles = ["field", "combo"];

    public static string For(int controlTypeId) =>
        ByControlTypeId.TryGetValue(controlTypeId, out string? word) ? word : "other";

    public static bool IsEditable(string role) => EditableRoles.Contains(role);
}
